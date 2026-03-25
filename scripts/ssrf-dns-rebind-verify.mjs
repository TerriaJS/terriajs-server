#!/usr/bin/env node

/**
 * SSRF Verification Scripts for terriajs-server
 *
 * Starts a real terriajs-server proxy (via makeServer) and tests it for SSRF
 * vulnerabilities. Each test spins up its own proxy instance with the
 * appropriate configuration plus any target servers needed for the scenario.
 *
 * Usage:
 *   node scripts/ssrf-dns-rebind-verify.mjs [test-name]
 *
 * Available tests:
 *   baseline     - Direct requests to blacklisted IPs
 *   redirect     - Redirect to blacklisted IP
 *   rbndr        - DNS rebinding via rbndr.us (requires internet)
 *   all          - Run all tests (default)
 *
 * External services used:
 *   - rbndr.us (https://github.com/taviso/rbndr)
 *     Format: <hex-ip1>.<hex-ip2>.rbndr.us
 *     Randomly returns one of the two IPs with very short TTL.
 *     Many local DNS resolvers block rbndr.us, so the rbndr test routes
 *     .rbndr.us queries through Google Public DNS (8.8.8.8) via a custom
 *     lookup function passed to the proxy. This is real DNS resolution,
 *     not mocking — it just bypasses the local resolver's block.
 */

import dns from "node:dns";
import http from "node:http";
import makeServer from "../lib/makeserver.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startProxy(settings = {}) {
  const app = makeServer({
    settings: {
      proxyAllDomains: true,
      rejectUnauthorized: false,
      ...settings
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        port,
        proxyUrl: `http://localhost:${port}/proxy`,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

function startTargetServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      const port = server.address().port;
      resolve({
        port,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

async function proxyGet(proxyUrl, targetUrl, { timeout = 10_000 } = {}) {
  const url = `${proxyUrl}/${targetUrl}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    const body = await res.text();
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: `Fetch error: ${err.message}` };
  }
}

function printResult(blocked, status, desc, body) {
  const tag = blocked ? "BLOCKED" : "PASSED ";
  console.log(`  ${tag} [${status}] ${desc}`);
  if (!blocked && body) {
    console.log(`          Body: ${body.slice(0, 200)}`);
  }
}

function ipToHex(ip) {
  return ip
    .split(".")
    .map((n) => parseInt(n).toString(16).padStart(2, "0"))
    .join("");
}

async function verifyRbndrDns(rebindHost) {
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8", "8.8.4.4"]);

  console.log("  Checking DNS via 8.8.8.8 (5 lookups to see alternation):");
  let dnsWorks = false;
  for (let i = 0; i < 5; i++) {
    try {
      const result = await new Promise((resolve, reject) => {
        resolver.resolve4(rebindHost, { ttl: true }, (err, addrs) => {
          if (err) reject(err);
          else resolve(addrs);
        });
      });
      const info = result.map((r) => `${r.address} (ttl=${r.ttl})`).join(", ");
      console.log(`    DNS #${i + 1}: ${info}`);
      dnsWorks = true;
    } catch (err) {
      console.log(`    DNS #${i + 1}: FAILED (${err.code || err.message})`);
    }
  }
  return dnsWorks;
}

// ─── Test 1: Direct blacklisted IP access ─────────────────────────────────────

async function testBaseline() {
  console.log("\n=== Test: Direct blacklisted IP access ===");
  console.log("Verifies that direct requests to blacklisted IPs are blocked");
  console.log(
    "by the hostname interceptor (before a TCP connection is made).\n"
  );

  const proxy = await startProxy(); // uses DEFAULT_BLACKLIST

  const targets = [
    { url: "http://127.0.0.1/", desc: "IPv4 loopback (127.0.0.1)" },
    { url: "http://[::1]/", desc: "IPv6 loopback (::1)" },
    {
      url: "http://[::ffff:127.0.0.1]/",
      desc: "IPv4-mapped IPv6 (::ffff:127.0.0.1)"
    },
    { url: "http://10.0.0.1/", desc: "Private RFC1918 (10.0.0.1)" },
    { url: "http://172.16.0.1/", desc: "Private RFC1918 (172.16.0.1)" },
    { url: "http://192.168.1.1/", desc: "Private RFC1918 (192.168.1.1)" },
    {
      url: "http://169.254.169.254/latest/meta-data/",
      desc: "AWS metadata (169.254.169.254)"
    },
    { url: "http://[fc00::1]/", desc: "Unique-local IPv6 (fc00::1)" },
    { url: "http://[fe80::1]/", desc: "Link-local IPv6 (fe80::1)" },
    { url: "http://0.0.0.1/", desc: "This-network (0.0.0.1)" }
  ];

  for (const { url, desc } of targets) {
    const { status, body } = await proxyGet(proxy.proxyUrl, url);
    printResult(status === 403, status, desc, body);
  }

  await proxy.close();
}

// ─── Test 2: Redirect to blacklisted IP ───────────────────────────────────────

async function testRedirect() {
  console.log("\n=== Test: Redirect to blacklisted IP ===");
  console.log(
    "A reachable target server redirects the proxy to blacklisted IPs."
  );
  console.log(
    "The hostname interceptor should block the redirect destination.\n"
  );

  // Blacklist only 10.x and link-local so the target server on localhost
  // remains reachable while the redirect destinations are blocked.
  const target = await startTargetServer((req, res) => {
    const routes = {
      "/redirect-to-private": "http://10.0.0.1/steal",
      "/redirect-to-metadata": "http://169.254.169.254/latest/meta-data/",
      "/redirect-chain": `http://localhost:${target.port}/redirect-to-private`
    };
    const location = routes[req.url];
    if (location) {
      res.writeHead(302, { Location: location });
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("STOLEN: internal data");
    }
  });

  const proxy = await startProxy({
    blacklistedAddresses: ["10.0.0.0/8", "169.254.0.0/16"]
  });

  const cases = [
    { path: "/redirect-to-private", desc: "302 -> 10.0.0.1 (private)" },
    {
      path: "/redirect-to-metadata",
      desc: "302 -> 169.254.169.254 (cloud metadata)"
    },
    {
      path: "/redirect-chain",
      desc: "302 -> localhost -> 302 -> 10.0.0.1 (chain)"
    }
  ];

  for (const { path, desc } of cases) {
    const { status, body } = await proxyGet(
      proxy.proxyUrl,
      `http://localhost:${target.port}${path}`
    );
    printResult(status === 403, status, desc, body);
  }

  await proxy.close();
  await target.close();
}

// ─── Test 3: DNS rebinding via rbndr.us ───────────────────────────────────────

/**
 * Creates a lookup function that routes .rbndr.us queries through Google
 * Public DNS (8.8.8.8) while using the system resolver for everything else.
 * Many local/corporate DNS resolvers block rbndr.us — this bypasses that.
 * This is real DNS resolution, not mocking.
 */
function createPublicDnsLookup() {
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8", "8.8.4.4"]);

  let lastRbndrAddress = null;

  function lookup(hostname, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (hostname.endsWith(".rbndr.us")) {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err) return callback(err);
        lastRbndrAddress = addresses[0];
        if (options.all) {
          return callback(
            null,
            addresses.map((addr) => ({ address: addr, family: 4 }))
          );
        }
        return callback(null, addresses[0], 4);
      });
      return;
    }
    return dns.lookup(hostname, options, callback);
  }

  return {
    lookup,
    get lastResolvedAddress() {
      return lastRbndrAddress;
    },
    reset() {
      lastRbndrAddress = null;
    }
  };
}

async function testRbndr() {
  console.log("\n=== Test: DNS rebinding via rbndr.us ===");
  console.log(
    "Uses the real rbndr.us service to alternate DNS between a safe IP"
  );
  console.log("and a blacklisted IP. Requires internet access.");
  console.log(
    "Routes .rbndr.us queries through 8.8.8.8 (local resolver may block them).\n"
  );

  // --- Part 1: Direct requests ---
  console.log("  --- Part 1: Direct requests (default blacklist) ---\n");

  const blacklistedIp = "127.0.0.1";
  const safeIp = "1.1.1.1"; // Cloudflare — responds on port 80
  const rebindHost = `${ipToHex(blacklistedIp)}.${ipToHex(safeIp)}.rbndr.us`;

  console.log(`  Rebinding hostname: ${rebindHost}`);
  console.log(
    `  Alternates between: ${blacklistedIp} (blacklisted) and ${safeIp} (safe)\n`
  );

  const dnsWorks = await verifyRbndrDns(rebindHost);
  if (!dnsWorks) {
    console.log("\n  SKIPPED: Could not resolve rbndr.us via 8.8.8.8");
    return;
  }

  const rbndrLookup = createPublicDnsLookup();

  console.log("\n  Sending 10 requests through proxy (default blacklist):");
  const proxy1 = await startProxy({ lookup: rbndrLookup.lookup });

  let blocked = 0;
  let passed = 0;
  let correct = 0;
  let errors = 0;
  const attempts = 10;

  for (let i = 0; i < attempts; i++) {
    rbndrLookup.reset();
    const { status, body } = await proxyGet(
      proxy1.proxyUrl,
      `http://${rebindHost}:80/`,
      { timeout: 8000 }
    );
    const resolved = rbndrLookup.lastResolvedAddress;
    const shouldBlock = resolved === blacklistedIp;
    const wasBlocked = status === 403;

    if (status === 502 && body.includes("DNS lookup failed")) {
      console.log(`    Req ${i + 1}: DNS_ERR [${status}] resolved=${resolved}`);
      errors++;
    } else if (status > 0 || status === 0) {
      const action = wasBlocked ? "BLOCKED" : "PASSED ";
      const ok = shouldBlock === wasBlocked ? "OK" : "FAIL";
      if (ok === "OK") correct++;
      console.log(
        `    Req ${i + 1}: ${action} [${status}] resolved=${resolved} expected=${shouldBlock ? "block" : "pass"} ${ok}`
      );
      if (wasBlocked) blocked++;
      else passed++;
    }
  }

  await proxy1.close();

  console.log(
    `\n  Results: ${blocked} blocked, ${passed} passed, ${errors} errors / ${attempts} (${correct}/${blocked + passed} correct)`
  );
  if (passed > 0 && blocked > 0) {
    console.log(
      "  EXPECTED: Mixed — proxy blocks when DNS resolves to 127.0.0.1,"
    );
    console.log(
      "  but allows when it resolves to 1.1.1.1. The socket lookup hook"
    );
    console.log(
      "  only validates the IP that was actually resolved per-request."
    );
  } else if (blocked === attempts) {
    console.log("  All blocked (DNS always returned 127.0.0.1 this run).");
  } else if (passed === attempts) {
    console.log("  All passed (DNS always returned 1.1.1.1 this run).");
    console.log("  Re-run to see alternation.");
  }

  // --- Part 2: Redirect to rbndr hostname ---
  console.log("\n  --- Part 2: Redirect to rbndr hostname ---\n");

  // Use 10.0.0.1 as the blacklisted IP so localhost remains reachable
  // for the target server that issues the redirect.
  const rebindBlacklistedIp = "10.0.0.1";
  const rebindRedirectHost = `${ipToHex(rebindBlacklistedIp)}.${ipToHex(safeIp)}.rbndr.us`;

  console.log(`  Rebinding hostname: ${rebindRedirectHost}`);
  console.log(
    `  Alternates between: ${rebindBlacklistedIp} (blacklisted) and ${safeIp} (safe)`
  );
  console.log("  Local target server redirects proxy to the rbndr hostname.\n");

  const target = await startTargetServer((req, res) => {
    if (req.url === "/redirect-to-rbndr") {
      res.writeHead(302, {
        Location: `http://${rebindRedirectHost}:80/`
      });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const proxy2 = await startProxy({
    blacklistedAddresses: ["10.0.0.0/8"],
    lookup: rbndrLookup.lookup
  });

  blocked = 0;
  passed = 0;
  correct = 0;
  errors = 0;

  console.log("  Sending 10 requests (localhost -> 302 -> rbndr hostname):");
  for (let i = 0; i < attempts; i++) {
    rbndrLookup.reset();
    const { status, body } = await proxyGet(
      proxy2.proxyUrl,
      `http://localhost:${target.port}/redirect-to-rbndr`,
      { timeout: 8000 }
    );
    const resolved = rbndrLookup.lastResolvedAddress;
    const shouldBlock = resolved === rebindBlacklistedIp;
    const wasBlocked = status === 403;

    if (status === 502 && body.includes("DNS lookup failed")) {
      console.log(`    Req ${i + 1}: DNS_ERR [${status}] resolved=${resolved}`);
      errors++;
    } else if (status > 0 || status === 0) {
      const action = wasBlocked ? "BLOCKED" : "PASSED ";
      const ok = shouldBlock === wasBlocked ? "OK" : "FAIL";
      if (ok === "OK") correct++;
      console.log(
        `    Req ${i + 1}: ${action} [${status}] resolved=${resolved} expected=${shouldBlock ? "block" : "pass"} ${ok}`
      );
      if (wasBlocked) blocked++;
      else passed++;
    }
  }

  await proxy2.close();
  await target.close();

  console.log(
    `\n  Results: ${blocked} blocked, ${passed} passed, ${errors} errors / ${attempts} (${correct}/${blocked + passed} correct)`
  );
  if (passed > 0 && blocked > 0) {
    console.log(
      "  EXPECTED: Mixed — same behavior as direct requests. The redirect"
    );
    console.log(
      "  destination is a hostname (not an IP), so the hostname interceptor"
    );
    console.log(
      "  allows it. The socket lookup hook then checks the resolved IP."
    );
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const tests = {
  baseline: testBaseline,
  redirect: testRedirect,
  rbndr: testRbndr
};

const testName = process.argv[2] || "all";

console.log("========================================================");
console.log("  SSRF Verification for terriajs-server");
console.log("  Tests the real proxy for SSRF attack vectors");
console.log("========================================================");

if (testName === "all") {
  for (const fn of Object.values(tests)) {
    await fn();
  }
} else if (tests[testName]) {
  await tests[testName]();
} else {
  console.error(`Unknown test: ${testName}`);
  console.error(`Available: ${Object.keys(tests).join(", ")}, all`);
  process.exit(1);
}

console.log("\nDone.\n");
