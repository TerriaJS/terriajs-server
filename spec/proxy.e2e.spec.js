var supertestReq = require("supertest");

var makeServer = require("../lib/makeserver.js");
var { createTestServer } = require("./support/test-http-server.js");
var { createProxyServer } = require("./support/http-proxy-server.js");

// Test server ports
const TEST_SERVER_PORT = 9876;
const TEST_SERVER_2_PORT = 9877;

async function buildApp(settings = {}, proxyAuth = {}) {
  const app = makeServer({
    settings: {
      ...settings,
      rejectUnauthorized: false // Disable TLS validation in tests
    },
    proxyAuth
  });

  return { app };
}

describe("Proxy (e2e)", () => {
  describe("/ (GET)", () => {
    doCommonTest("get");
  });

  describe("/ (POST)", () => {
    doCommonTest("post");

    describe("POST body handling", () => {
      let testServer;
      let app;

      beforeAll(async () => {
        testServer = await createTestServer(TEST_SERVER_PORT);

        ({ app } = await buildApp({
          proxyAllDomains: true, // Allow proxying to example.com
          postSizeLimit: 1024 * 1024, // Set a specific limit for the size test
          blacklistedAddresses: ["202.168.1.1"] // Keep existing relevant config
        })); // Build the app with this config
      });

      afterAll(async () => {
        await testServer.close();
      });

      beforeEach(async () => {
        testServer.clearRoutes();

        testServer.addRoute("post", "/post-body-test", async (req, res) => {
          if (req.body && req.body.message === "hello proxy") {
            res.json({
              success: true,
              receivedBody: req.body
            });
            return;
          }
          res
            .status(400)
            .json({ success: false, error: "Incorrect body received" });
        });
      });

      it("should correctly proxy the POST request body", async () => {
        const url = `http://localhost:${TEST_SERVER_PORT}/post-body-test`;
        const postBody = { message: "hello proxy" };

        await supertestReq(app)
          .post(`/proxy/${url}`)
          .send(postBody)
          .expect(200, { success: true, receivedBody: postBody });
      });

      it("should return 413 if POST body is larger than postSizeLimit (e.g., 1MB)", async () => {
        const url = "https://example.com/post-body-test"; // Target URL doesn't strictly matter as NestJS should reject first
        // Create a body larger than 1MB. A char is 1 byte, 1MB = 1024 * 1024 bytes.
        const largePostBody = { message: "a".repeat(1024 * 1024 + 1) }; // Slightly over 1MB

        await supertestReq(app)
          .post(`/proxy/${url}`)
          .send(largePostBody)
          .expect(413); // Payload Too Large
      });
    });
  });
});

function doCommonTest(methodName) {
  describe("default config", () => {
    let app;

    beforeAll(async () => {
      ({ app } = await buildApp());
    });

    it("should not allow proxy by default", () => {
      return supertestReq(app)[methodName](`/proxy/example.com`).expect(403);
    });
  });

  describe("simple config", () => {
    let app;
    let testServer;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
      ({ app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        rejectUnauthorized: false
      }));
    });

    afterAll(async () => {
      await testServer.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
    });

    it("should proxy through to the path that is given", async () => {
      // Set up route on test server
      testServer.addRoute(methodName, "/", (req, res) => {
        res.json({ data: "response success" });
      });

      await supertestReq(app)
        [methodName](`/proxy/http://localhost:${TEST_SERVER_PORT}`)
        .expect(200, { data: "response success" });
    });

    it("should add protocol if it isn't provided", async () => {
      testServer.addRoute(methodName, "/response", (req, res) => {
        res.json({ data: "response success" });
      });

      const url = `localhost:${TEST_SERVER_PORT}/response`;
      await supertestReq(app)
        [methodName](`/proxy/${url}`)
        .expect(200, { data: "response success" });
    });

    it("should proxy to just domain", async () => {
      testServer.addRoute(methodName, "/", (req, res) => {
        res.json({ data: "response success root" });
      });

      const url = `localhost:${TEST_SERVER_PORT}`;

      await supertestReq(app)
        [methodName](`/proxy/${url}`)
        .expect(200, { data: "response success root" });
    });

    it("should return 400 if no url is specified", async () => {
      await supertestReq(app)[methodName]("/proxy/").expect(400);
    });

    it("should stream back the body and headers of the request made", async () => {
      testServer.addRoute(methodName, "/", (req, res) => {
        res.set("fakeheader", "fakevalue");
        res.set("Cache-Control", "no-cache");
        res.set("Connection", "delete me");
        res.set("Content-Type", "application/json");
        res.json({ data: "response success root" });
        res.send();
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}`)
        .expect(200, { data: "response success root" })
        .expect("fakeheader", "fakevalue");
    });

    describe("should change headers", () => {
      it("to overwrite cache-control header to two weeks if no max age is specified in req", async () => {
        testServer.addRoute(methodName, "/", (req, res) => {
          res.set("fakeheader", "fakevalue");
          res.set("Cache-Control", "no-cache");
          res.set("Connection", "delete me");
          res.set("Content-Type", "application/json");
          res.json({ data: "response success root" });
        });

        await supertestReq(app)
          [methodName](`/proxy/localhost:${TEST_SERVER_PORT}`)
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");
      });

      it("to filter out disallowed ones passed in req", async () => {
        testServer.addRoute(methodName, "/", (req, res) => {
          // Check that Proxy-Connection header was filtered out
          if (req.headers["proxy-connection"]) {
            return res
              .status(500)
              .json({ error: "Proxy-Connection should be filtered" });
          }
          // Check that unfilteredheader was passed through
          if (!req.headers["unfilteredheader"]) {
            return res
              .status(500)
              .json({ error: "unfilteredheader should be passed" });
          }
          res.set("fakeheader", "fakevalue");
          res.set("Cache-Control", "no-cache");
          res.set("Connection", "delete me");
          res.set("Content-Type", "application/json");
          res.json({ data: "response success root" });
        });

        await supertestReq(app)
          [methodName](`/proxy/localhost:${TEST_SERVER_PORT}`)
          .set("Proxy-Connection", "delete me!")
          .set("unfilteredheader", "don't delete me!")
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");
      });

      it("to filter out disallowed ones that come back from the response", async () => {
        testServer.addRoute(methodName, "/", (req, res) => {
          res.set("fakeheader", "fakevalue");
          res.set("Cache-Control", "no-cache");
          res.set("Connection1", "delete me");
          res.set("Content-Type", "application/json");
          res.json({ data: "response success root" });
        });

        const response = await supertestReq(app)
          [methodName](`/proxy/localhost:${TEST_SERVER_PORT}`)
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");

        expect(response.headers.Connection1).not.toBeDefined();
      });

      it("should not set max age on error response", async () => {
        testServer.addRoute(methodName, "/error", (req, res) => {
          res.set("fakeheader", "fakevalue");
          res.set("Cache-Control", "no-cache");
          res.set("Connection", "delete me");
          res.set("Content-Type", "application/json");
          return res.status(500).json({ error: "server error" });
        });

        const response = await supertestReq(app)
          [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/error`)
          .expect(500);

        expect(response.headers["cache-control"]).not.toBeDefined();
      });
    });

    describe("when specifying max age", () => {
      describe("should return 400 for", () => {
        it("a max-age specifying url with no actual url specified", async () => {
          await supertestReq(app)[methodName]("/proxy/_3000ms").expect(400);
        });

        it("a max-age specifying url with just '/' as a url", async () => {
          await supertestReq(app)[methodName]("/proxy/_3000ms/").expect(400);
        });

        it("a max-age specifying url with invalid max age value", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_FUBAR/localhost:${TEST_SERVER_PORT}`)
            .expect(400);
        });

        it("a max-age specifying url with an invalid unit for a max-age value", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_3000q/localhost:${TEST_SERVER_PORT}`)
            .expect(400);
        });
      });

      describe("should properly interpret max age", () => {
        beforeEach(() => {
          testServer.addRoute(methodName, "/", (req, res) => {
            res.set("fakeheader", "fakevalue");
            res.set("Cache-Control", "no-cache");
            res.set("Connection", "delete me");
            res.set("Content-Type", "application/json");
            res.json({ data: "response success root" });
          });
        });

        it("ms (millisecond)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_3000ms/localhost:${TEST_SERVER_PORT}`)
            .expect(200)
            .expect("Cache-Control", "public,max-age=3");
        });

        it("s (second)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_3s/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=3");
        });

        it("m (minute)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_2m/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=120");
        });

        it("h (hour)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_2h/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=7200");
        });

        it("d (day)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_2d/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=172800");
        });

        it("w (week)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_2w/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=1209600");
        });

        it("y (year)", async () => {
          await supertestReq(app)
            [methodName](`/proxy/_2y/localhost:${TEST_SERVER_PORT}`)
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=63072000");
        });
      });
    });
  });

  describe("with an upstream proxy", () => {
    let PROXY_PORT = 25000;

    let connectSpy = jasmine.createSpy("connectSpy");
    let upstreamProxyServer;

    beforeAll(() => {
      upstreamProxyServer = createProxyServer(PROXY_PORT, connectSpy);
    });
    beforeEach(() => {
      connectSpy.calls.reset();
    });
    afterAll(() => {
      upstreamProxyServer.close();
    });

    it("should proxy through upstream proxy", async () => {
      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      const appHttpServer = app.listen(0);

      await supertestReq(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/ping`)
        .expect(200, "OK");
      expect(connectSpy).toHaveBeenCalledTimes(1);

      await appHttpServer.close();
    });

    it("is not used when host is in bypassUpstreamProxyHosts", async () => {
      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        bypassUpstreamProxyHosts: ["127.0.0.1:64900"],
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      const appHttpServer = app.listen(64900);

      await supertestReq(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/ping`)
        .expect(200, "OK");
      expect(connectSpy).not.toHaveBeenCalled();

      await appHttpServer.close();
    });

    it("is still used when bypassUpstreamProxyHosts is defined but host is not in it (HTTP target)", async () => {
      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        bypassUpstreamProxyHosts: ["example2.com"],
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });
      const appHttpServer = app.listen(64901);

      await supertestReq(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/ping`)
        .expect(200, "OK");
      expect(connectSpy).toHaveBeenCalledTimes(1);

      appHttpServer.close();
    });
  });

  describe("when specifying an allowed list of domains to proxy", function () {
    let testServer;
    let testServer2;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
      testServer2 = await createTestServer(TEST_SERVER_2_PORT);
    });

    afterAll(async () => {
      await testServer.close();
      await testServer2.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
      testServer2.clearRoutes();
    });

    it("should proxy a domain on that list", async () => {
      testServer.addRoute(methodName, "/response", (req, res) => {
        res.set("fakeheader", "fakevalue");
        res.set("Cache-Control", "no-cache");
        res.set("Connection", "delete me");
        res.set("Content-Type", "application/json");
        res.status(200).json({ data: "response success" });
      });

      const { app } = await buildApp({
        allowProxyFor: [`localhost:${TEST_SERVER_PORT}`],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/response`)
        .expect(200, { data: "response success" });
    });

    it("should block a domain not on that list", async () => {
      const { app } = await buildApp({
        allowProxyFor: [`localhost:${TEST_SERVER_PORT}`],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_2_PORT}/blah`)
        .expect(403);
    });

    it("should not block a domain not on the list if proxyAllDomains is true", async () => {
      testServer2.addRoute(methodName, "/", (req, res) => {
        res.set("fakeheader", "fakevalue");
        res.set("Cache-Control", "no-cache");
        res.set("Connection", "delete me");
        res.set("Content-Type", "application/json");
        res.json({ data: "response success root" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: [`localhost:${TEST_SERVER_PORT}`],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_2_PORT}`)
        .expect(200, { data: "response success root" });
    });
  });

  describe("when domain has basic authentication specified", function () {
    let testServer;
    let testServer2;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
      testServer2 = await createTestServer(TEST_SERVER_2_PORT);
    });

    afterAll(async () => {
      await testServer.close();
      await testServer2.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
      testServer2.clearRoutes();
    });

    it("should set an auth header for that domain", async () => {
      testServer.addRoute(methodName, "/auth", (req, res) => {
        // Verify the auth header was set
        if (req.headers.authorization !== "blahfaceauth") {
          return res.status(401).json({ error: "Unauthorized" });
        }
        res.status(200).json({ data: "response success" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "blahfaceauth"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth`)
        .expect(200, { data: "response success" });
    });

    it("should not set auth headers for other domains", async () => {
      testServer.addRoute(methodName, "/auth", (req, res) => {
        // Verify NO auth header was set
        if (req.headers.authorization) {
          return res.status(500).json({ error: "Should not have auth header" });
        }
        res.status(200).json({ data: "response success" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_2_PORT}`]: {
            authorization: "blahfaceauth"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth`)
        .expect(200, { data: "response success" });
    });

    it("should set other headers for that domain", async () => {
      testServer.addRoute(methodName, "/auth", (req, res) => {
        // Verify both auth and custom header were set
        if (req.headers.authorization !== "blahfaceauth") {
          return res.status(401).json({ error: "Missing auth" });
        }
        if (req.headers["x-test-header"] !== "testvalue") {
          return res.status(500).json({ error: "Missing custom header" });
        }
        res.status(200).json({ data: "properly set header and auth" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "blahfaceauth",
            headers: [{ name: "X-Test-Header", value: "testvalue" }]
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth`)
        .expect(200, { data: "properly set header and auth" });
    });

    it("should set other headers for that domain even when authorization is not defined", async () => {
      testServer.addRoute(methodName, "/auth", (req, res) => {
        if (req.headers["x-test-header"] !== "testvalue") {
          return res.status(500).json({ error: "Missing custom header" });
        }
        res.status(200).json({ data: "properly set header and auth" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            headers: [{ name: "X-Test-Header", value: "testvalue" }]
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth`)
        .expect(200, { data: "properly set header and auth" });
    });

    it("should retry without auth header if auth fails (Proxy Auth -> No Auth success)", async () => {
      let attemptCount = 0;
      testServer.addRoute(methodName, "/auth-retry1", (req, res) => {
        attemptCount++;
        if (attemptCount === 1) {
          // First attempt with proxy auth - should fail
          if (req.headers.authorization === "proxyDefAuthFails") {
            return res.status(403).json({ error: "Forbidden" });
          }
        } else if (attemptCount === 2) {
          // Second attempt without auth - should succeed
          if (!req.headers.authorization) {
            return res.status(200).json({ data: "success without auth" });
          }
        }
        res.status(500).json({ error: "Unexpected request" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "proxyDefAuthFails"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth-retry1`)
        .expect(200, { data: "success without auth" });
    });

    it("should retry with proxy auth when fails with user supplied auth (User Auth -> Proxy Auth -> No Auth all fail)", async () => {
      let attemptCount = 0;
      testServer.addRoute(methodName, "/auth", (req, res) => {
        attemptCount++;
        const authHeader = req.headers.authorization;

        if (attemptCount === 1 && authHeader === "testUserAuth") {
          return res
            .status(403)
            .json({ statusCode: 403, message: "Forbidden 1" });
        }
        if (attemptCount === 2 && authHeader === "blahfaceauth") {
          return res
            .status(403)
            .json({ statusCode: 403, message: "Forbidden 2" });
        }
        if (attemptCount === 3 && !authHeader) {
          return res
            .status(403)
            .json({ statusCode: 403, message: "Forbidden 3" });
        }

        res.status(500).json({ error: "Unexpected request" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "blahfaceauth"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth`)
        .set("Authorization", "testUserAuth")
        .expect(403, {
          statusCode: 403,
          message: "Forbidden 3"
        });
    });

    it("User Auth (fails) -> Proxy Auth (succeeds)", async () => {
      let attemptCount = 0;
      testServer.addRoute(methodName, "/auth-path", (req, res) => {
        attemptCount++;
        const authHeader = req.headers.authorization;

        if (attemptCount === 1 && authHeader === "userSentWrongAuth") {
          return res.status(403).json({ error: "User Auth Failed" });
        }
        if (attemptCount === 2 && authHeader === "proxyCorrectAuth") {
          return res.status(200).json({ data: "success with proxy auth" });
        }

        res.status(500).json({ error: "Test Misconfigured" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "proxyCorrectAuth"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth-path`)
        .set("Authorization", "userSentWrongAuth")
        .expect(200, { data: "success with proxy auth" });
    });

    it("User Auth (fails) -> No Proxy Auth defined -> No Auth (succeeds)", async () => {
      let attemptCount = 0;
      testServer.addRoute(methodName, "/auth-path2", (req, res) => {
        attemptCount++;
        const authHeader = req.headers.authorization;

        if (attemptCount === 1 && authHeader === "userSentWrongAuthAgain") {
          return res.status(403).json({ error: "User Auth Failed Again" });
        }
        if (attemptCount === 2 && !authHeader) {
          return res.status(200).json({ data: "success with no auth retry" });
        }

        res.status(500).json({ error: "Test Misconfigured" });
      });

      const { app } = await buildApp(
        {
          blacklistedAddresses: ["202.168.1.1"],
          proxyAllDomains: true
        },
        {
          // No proxyAuth defined
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth-path2`)
        .set("Authorization", "userSentWrongAuthAgain")
        .expect(200, { data: "success with no auth retry" });
    });

    it("Proxy Auth (fails) -> No Auth (fails)", async () => {
      let attemptCount = 0;
      testServer.addRoute(methodName, "/auth-path3", (req, res) => {
        attemptCount++;
        const authHeader = req.headers.authorization;

        if (attemptCount === 1 && authHeader === "proxyAuthWillFail") {
          return res.status(403).json({
            statusCode: 403,
            message: "Proxy Auth Failed As Expected"
          });
        }
        if (attemptCount === 2 && !authHeader) {
          return res
            .status(403)
            .json({ statusCode: 403, message: "No Auth Also Failed" });
        }

        res.status(500).json({ error: "Test Misconfigured" });
      });

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          [`localhost:${TEST_SERVER_PORT}`]: {
            authorization: "proxyAuthWillFail"
          }
        }
      );

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth-path3`)
        .expect(403, { statusCode: 403, message: "No Auth Also Failed" });
    });

    it("No User Auth, No Proxy Auth defined -> First No Auth attempt (fails) -> Final 403 (no retry)", async () => {
      testServer.addRoute(methodName, "/auth-path4", (req, res) => {
        // No auth header expected, request should fail
        if (!req.headers.authorization) {
          return res
            .status(403)
            .json({ statusCode: 403, message: "Initial No Auth Failed" });
        }
        res.status(500).json({ error: "Unexpected request" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/auth-path4`)
        .expect(403, { statusCode: 403, message: "Initial No Auth Failed" });
    });
  });

  describe("timeout configuration", function () {
    let testServer;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
    });

    afterAll(async () => {
      await testServer.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
    });

    it("should timeout when headers take too long (headersTimeout)", async () => {
      testServer.addRoute("get", "/slow-headers", async (req, res) => {
        // Delay before sending headers (longer than timeout)
        await new Promise((resolve) => setTimeout(resolve, 2000));
        res.status(200).json({ data: "too late" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        proxyHeadersTimeout: 500 // 500ms timeout
      });

      await supertestReq(app)
        .get(`/proxy/localhost:${TEST_SERVER_PORT}/slow-headers`)
        .expect(504)
        .expect(/Gateway timeout.*Headers not received/);
    });

    it("should timeout when connection takes too long (connectTimeout)", async () => {
      // Use a non-routable IP that will hang (connection timeout)
      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: [], // Don't blacklist this IP
        proxyConnectTimeout: 500 // 500ms timeout
      });

      await supertestReq(app)
        .get(`/proxy/192.0.2.1:9999/test`) // RFC 5737 TEST-NET-1 (non-routable)
        .expect(504)
        .expect(/Gateway timeout.*Could not connect/);
    });

    it("should use default timeouts when not specified", async () => {
      testServer.addRoute("get", "/normal", (req, res) => {
        res.status(200).json({ data: "success" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
        // No timeout options - should use defaults
      });

      await supertestReq(app)
        .get(`/proxy/localhost:${TEST_SERVER_PORT}/normal`)
        .expect(200, { data: "success" });
    });
  });

  describe("append query params", function () {
    let testServer;
    let testServer2;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
      testServer2 = await createTestServer(TEST_SERVER_2_PORT);
    });

    afterAll(async () => {
      await testServer.close();
      await testServer2.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
      testServer2.clearRoutes();
    });

    it("append params to the querystring for a specified domain", async () => {
      testServer.addRoute(methodName, "/", (req, res) => {
        // Verify query param was appended
        if (req.query.foo === "bar") {
          return res.json({ data: "have set search params foo=bar" });
        }
        res.status(401).json({ error: "Missing query param" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}`)
        .expect(200, { data: "have set search params foo=bar" });
    });

    it("append params to the querystring for a specified domain using specified regex", async () => {
      testServer.addRoute(methodName, "/something/else", (req, res) => {
        // Verify query param was appended
        if (req.query.foo === "bar") {
          return res.json({ data: "have set search params foo=bar" });
        }
        res.status(400).json({ error: "Missing query param" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/something/else`)
        .expect(200, { data: "have set search params foo=bar" });
    });

    it('should not append params when path "/nothing/else" does not match regexPattern "something"', async () => {
      testServer.addRoute(methodName, "/nothing/else", (req, res) => {
        // Verify query param was NOT appended (query should be empty)
        if (Object.keys(req.query).length === 0) {
          return res.json({ data: "have not set search params foo=bar" });
        }
        res.status(400).json({ error: "Unexpected query params" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/nothing/else`)
        .expect(200, { data: "have not set search params foo=bar" });
    });

    it('should append "yep=works" (from "nothing" regex) and not "foo=bar" (from "something" regex) for path "/nothing/else"', async () => {
      testServer.addRoute(methodName, "/nothing/else", (req, res) => {
        // Verify only "yep=works" was appended (from "nothing" regex), not "foo=bar"
        if (req.query.yep === "works" && !req.query.foo) {
          return res.json({ data: "have set search params yep=works" });
        }
        res.status(400).json({ error: "Wrong query params", query: req.query });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            },
            {
              regexPattern: "nothing",
              params: {
                yep: "works"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/nothing/else`)
        .expect(200, { data: "have set search params yep=works" });
    });

    it('should append multiple params "foo=bar" and "another=val" when regexPattern "." matches path "/nothing/else"', async () => {
      testServer.addRoute(methodName, "/nothing/else", (req, res) => {
        // Verify both params were appended
        if (req.query.foo === "bar" && req.query.another === "val") {
          return res.json({
            data: "have set search params foo=bar and another=val"
          });
        }
        res
          .status(400)
          .json({ error: "Missing query params", query: req.query });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: ".",
              params: {
                foo: "bar",
                another: "val"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/nothing/else`)
        .expect(200, {
          data: "have set search params foo=bar and another=val"
        });
    });

    it('should append "foo=bar" and preserve existing "already=here" when regexPattern "." matches path "/something"', async () => {
      testServer.addRoute(methodName, "/something", (req, res) => {
        // Verify both params are present (existing "already=here" + appended "foo=bar")
        if (req.query.foo === "bar" && req.query.already === "here") {
          return res.json({
            data: "have extended search params with foo=bar"
          });
        }
        res
          .status(400)
          .json({ error: "Missing query params", query: req.query });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          [`localhost:${TEST_SERVER_PORT}`]: [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [
          methodName
        ](`/proxy/localhost:${TEST_SERVER_PORT}/something?already=here`)
        .expect(200, {
          data: "have extended search params with foo=bar"
        });
    });

    it('should not append "foo=bar" for "localhost:9876" when config is for "localhost:9877", preserving existing "already=here"', async () => {
      testServer.addRoute(methodName, "/something", (req, res) => {
        // Verify only existing param is present (no "foo=bar" appended)
        if (req.query.already === "here" && !req.query.foo) {
          return res.json({ data: "haven\t set search params" });
        }
        res
          .status(400)
          .json({ error: "Unexpected query params", query: req.query });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          // Config is for TEST_SERVER_2_PORT, but we're calling TEST_SERVER_PORT
          [`localhost:${TEST_SERVER_2_PORT}`]: [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await supertestReq(app)
        [
          methodName
        ](`/proxy/localhost:${TEST_SERVER_PORT}/something?already=here`)
        .expect(200, {
          data: "haven\t set search params"
        });
    });
  });

  describe("redirects", () => {
    let testServer;

    beforeAll(async () => {
      testServer = await createTestServer(TEST_SERVER_PORT);
    });

    afterAll(async () => {
      await testServer.close();
    });

    afterEach(async () => {
      testServer.clearRoutes();
    });

    it("should follow redirect", async () => {
      // Set up redirect endpoint
      testServer.addRoute(methodName, "/redirect", (req, res) => {
        res.redirect(302, `/final-destination`);
      });

      // Set up final destination
      testServer.addRoute("get", "/final-destination", (req, res) => {
        res.status(200).json({ data: "redirected successfully" });
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      await supertestReq(app)
        [methodName](`/proxy/localhost:${TEST_SERVER_PORT}/redirect`)
        .expect(200, { data: "redirected successfully" });
    });

    it("should block redirect to blacklisted host", async () => {
      // Set up redirect endpoint that redirects to blacklisted IP
      testServer.addRoute(methodName, "/redirect-to-blacklist", (req, res) => {
        res.redirect(302, `http://202.168.1.1/malicious`);
      });

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      const response = await supertestReq(app)
        [
          methodName
        ](`/proxy/localhost:${TEST_SERVER_PORT}/redirect-to-blacklist`)
        .expect(403);
      expect(response.text).toContain(
        "Host is not in list of allowed hosts: 202.168.1.1"
      );
    });
  });

  describe("should block socket connection on blacklisted host", () => {
    it("should block connection to restricted ip address", async () => {
      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["127.0.0.1"]
      });

      const response = await supertestReq(app)
        [methodName](`/proxy/localhost`)
        .expect(403);

      expect(response.text).toContain("IP address is not allowed: 127.0.0.1");
    });
  });
}
