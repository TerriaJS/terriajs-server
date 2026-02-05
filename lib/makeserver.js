import express from "express";
import compression from "compression";
import path from "node:path";
import cors from "cors";
import exists from "./exists.js";
import basicAuth from "basic-auth";
import fs from "node:fs";
import https from "node:https";
import ExpressBruteFlexible from "rate-limiter-flexible/lib/ExpressBruteFlexible.js";
import morgan from "morgan";
import proxy from "./controllers/proxy.js";
import esriTokenAuth from "./controllers/esri-token-auth.js";
import proj4lookup from "./controllers/proj4lookup.js";
import proxydomains from "./controllers/proxydomains.js";
import serverconfig from "./controllers/serverconfig.js";
import * as errorPage from "./errorpage.js";
import initfile from "./controllers/initfile.js";
import feedback from "./controllers/feedback.js";
import share from "./controllers/share.js";
import singlePageRouting from "./controllers/single-page-routing.js";

/* Creates and returns a single express server. */
export default function (options) {
  function endpoint(endpointPath, router) {
    if (options.verbose) {
      console.log(
        "http://" +
          options.hostName +
          ":" +
          options.port +
          "/api/v1" +
          endpointPath,
        true
      );
    }
    if (endpointPath !== "proxyabledomains") {
      // deprecated endpoint that isn't part of V1
      app.use("/api/v1" + endpointPath, router);
    }
    // deprecated endpoint at `/`
    app.use(endpointPath, router);
  }

  // initialise app with standard middlewares
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use(cors());
  app.disable("etag");
  if (options.verbose) {
    app.use(morgan("dev"));
  }

  if (typeof options.settings.trustProxy !== "undefined") {
    app.set("trust proxy", options.settings.trustProxy);
  }

  if (options.verbose) {
    console.log("Listening on these endpoints:", true);
  }
  endpoint("/ping", function (req, res) {
    res.status(200).send("OK");
  });

  // We do this after the /ping service above so that ping can be used unauthenticated and without TLS for health checks.

  if (options.settings.redirectToHttps) {
    const httpAllowedHosts = options.settings.httpAllowedHosts || ["localhost"];
    app.use(function (req, res, next) {
      if (httpAllowedHosts.indexOf(req.hostname) >= 0) {
        return next();
      }

      if (req.protocol !== "https") {
        const url = "https://" + req.hostname + req.url;
        res.redirect(301, url);
      } else {
        if (options.settings.strictTransportSecurity) {
          res.setHeader(
            "Strict-Transport-Security",
            options.settings.strictTransportSecurity
          );
        }
        next();
      }
    });
  }

  const auth = options.settings.basicAuthentication;
  if (auth && auth.username && auth.password) {
    const rateLimitOptions = {
      freeRetries: 2,
      minWait: 200,
      maxWait: 60000
    };
    if (
      options.settings.rateLimit &&
      options.settings.rateLimit.freeRetries !== undefined
    ) {
      rateLimitOptions.freeRetries = options.settings.rateLimit.freeRetries;
      rateLimitOptions.minWait = options.settings.rateLimit.minWait;
      rateLimitOptions.maxWait = options.settings.rateLimit.maxWait;
    }
    const bruteforce = new ExpressBruteFlexible(
      ExpressBruteFlexible.LIMITER_TYPES.MEMORY,
      rateLimitOptions
    );
    app.use(bruteforce.prevent, function (req, res, next) {
      const user = basicAuth(req);
      if (user && user.name === auth.username && user.pass === auth.password) {
        // Successful authentication, reset rate limiting.
        req.brute.reset(next);
      } else {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="terriajs-server"');
        res.end("Unauthorized");
      }
    });
  }

  if (options.pingauth) {
    // used only in tests as an endpoint to test authentication and rate limiting
    // this should appear after brute force middleware is loaded
    endpoint("/pingauth", function (_req, res) {
      res.status(200).send("OK");
    });
  }

  // Serve the bulk of our application as a static web directory.
  const serveWwwRoot =
    exists(options.wwwroot + "/index.html") ||
    (options.settings.singlePageRouting &&
      exists(
        options.wwwroot +
          options.settings.singlePageRouting.resolvePathRelativeToWwwroot
      ));
  if (serveWwwRoot) {
    app.use(
      express.static(options.wwwroot, {
        setHeaders: function (res, filePath) {
          const ext = path.extname(filePath);
          if (ext === ".czml") {
            res.setHeader("Content-Type", "application/json");
          } else if (ext === ".glsl") {
            res.setHeader("Content-Type", "text/plain");
          }
        }
      })
    );
  }

  // Proxy for servers that don't support CORS
  const bypassUpstreamProxyHostsMap = (
    options.settings.bypassUpstreamProxyHosts || []
  ).reduce(function (map, host) {
    if (host !== "") {
      map[host.toLowerCase()] = true;
    }
    return map;
  }, {});

  endpoint(
    "/proxy",
    proxy({
      proxyableDomains: options.settings.allowProxyFor,
      proxyAllDomains: options.settings.proxyAllDomains,
      proxyAuth: options.proxyAuth,
      proxyPostSizeLimit: options.settings.proxyPostSizeLimit,
      upstreamProxy: options.settings.upstreamProxy,
      bypassUpstreamProxyHosts: bypassUpstreamProxyHostsMap,
      basicAuthentication: options.settings.basicAuthentication,
      blacklistedAddresses: options.settings.blacklistedAddresses,
      appendParamToQueryString: options.settings.appendParamToQueryString,
      rejectUnauthorized: options.settings.rejectUnauthorized,
      headersTimeout: options.settings.proxyHeadersTimeout,
      connectTimeout: options.settings.proxyConnectTimeout,
      clearAuthHeaders: options.settings.clearAuthHeaders
    })
  );

  const esriTokenAuthRouter = esriTokenAuth(options.settings.esriTokenAuth);
  if (esriTokenAuthRouter) {
    endpoint("/esri-token-auth", esriTokenAuthRouter);
  }

  endpoint("/proj4def", proj4lookup); // Proj4def lookup service, to avoid downloading all definitions into the client.
  endpoint(
    "/proxyabledomains",
    proxydomains({
      // Returns JSON list of domains we're willing to proxy for
      proxyableDomains: options.settings.allowProxyFor,
      proxyAllDomains: !!options.settings.proxyAllDomains
    })
  );
  endpoint("/serverconfig", serverconfig(options));
  const show404 = serveWwwRoot && exists(options.wwwroot + "/404.html");
  const error404 = errorPage.error404(show404, options.wwwroot, serveWwwRoot);
  const show500 = serveWwwRoot && exists(options.wwwroot + "/500.html");
  const error500 = errorPage.error500(show500, options.wwwroot);
  const initPaths = options.settings.initPaths || [];

  if (serveWwwRoot) {
    initPaths.push(path.join(options.wwwroot, "init"));
  }

  app.use("/init", initfile(initPaths, error404, options.configDir));

  const feedbackService = feedback(options.settings.feedback);
  if (feedbackService) {
    endpoint("/feedback", feedbackService);
  }
  const shareService = share(options.hostName, options.port, {
    shareUrlPrefixes: options.settings.shareUrlPrefixes,
    newShareUrlPrefix: options.settings.newShareUrlPrefix,
    shareMaxRequestSize: options.settings.shareMaxRequestSize
  });
  if (shareService) {
    endpoint("/share", shareService);
  }

  if (options.settings && options.settings.singlePageRouting) {
    const singlePageRoutingService = singlePageRouting(
      options,
      options.settings.singlePageRouting
    );
    if (singlePageRoutingService) {
      endpoint("{*splat}", singlePageRoutingService);
    }
  }

  app.use(error404);
  app.use(error500);
  let server = app;
  const osh = options.settings.https;
  if (osh && osh.key && osh.cert) {
    console.log("Launching in HTTPS mode.");
    server = https.createServer(
      {
        key: fs.readFileSync(osh.key),
        cert: fs.readFileSync(osh.cert)
      },
      app
    );
  }

  return server;
}
