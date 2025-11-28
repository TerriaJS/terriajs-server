/* jshint node: true */
"use strict";

const express = require("express");
const undici = require("undici");
const bodyParser = require("body-parser");
const rangeCheck = require("range_check");
const createSecureAgent = require("../undici/secure-agent");
const { hostnameInterceptor } = require("../undici/hostname-interceptor");
const { interceptors } = require("undici");
const {
  DEFAULT_MAX_AGE_SECONDS,
  DEFAULT_MAX_SIZE,
  DEFAULT_BLACKLIST
} = require("./proxy/constants");
const { processDuration } = require("./proxy/process-duration");
const { processHeaders } = require("./proxy/process-headers");
const { filterHeaders } = require("./proxy/filter-headers");
const { processTargetUrl } = require("./proxy/process-target-url");
const { buildRemoteUrl } = require("./proxy/build-remote-url");
const { buildAuthStrategies } = require("./proxy/build-auth-strategies");
const { buildRequestHeaders } = require("./proxy/build-request-headers");
const { executeWithRetry } = require("./proxy/execute-with-retry");
const { redirect: redirectInterceptor } = interceptors;
/**
 * Creates an express middleware that proxies calls to '/proxy/http://example' to 'http://example', while forcing them
 * to be cached by the browser and overrwriting CORS headers. A cache duration can be added with a URL like
 * /proxy/_5m/http://example which causes 'Cache-Control: public,max-age=300' to be added to the response headers.
 *
 * @param {Object} options
 * @param {Array[String]} options.proxyableDomains An array of domains to be proxied
 * @param {boolean} options.proxyAllDomains A boolean indicating whether or not we should proxy ALL domains - overrides
 *                      the configuration in options.proxyDomains
 * @param {String} options.proxyAuth A map of domains to tokens that will be passed to those domains via basic auth
 *                      when proxying through them.
 * @param {String} options.upstreamProxy Url of a standard upstream proxy that will be used to retrieve data.
 * @param {String} options.bypassUpstreamProxyHosts An object of hosts (as strings) to 'true' values.
 * @param {String} options.proxyPostSizeLimit The maximum size of a POST request that the proxy will allow through,
                        in bytes if no unit is specified, or some reasonable unit like 'kb' for kilobytes or 'mb' for megabytes.
 * @param {Number} options.headersTimeout Timeout in ms for receiving response headers (default: 30000)
 * @param {Number} options.connectTimeout Timeout in ms for establishing connection (default: 10000)
 *
 * @returns {*} A middleware that can be used with express.
 */
module.exports = function (options) {
  const proxyAllDomains = options.proxyAllDomains;
  const proxyDomains = options.proxyableDomains || [];
  const proxyAuth = options.proxyAuth || {};
  const proxyPostSizeLimit = options.proxyPostSizeLimit || DEFAULT_MAX_SIZE;
  const appendParamToQueryString = options.appendParamToQueryString || {};

  // Timeout configurations (in milliseconds)
  const headersTimeout = options.headersTimeout || 30_000; // 30 seconds default
  const connectTimeout = options.connectTimeout || 10_000; // 10 seconds default
  // If you change this, also change the same list in serverconfig.json.example.
  // This page is helpful: https://en.wikipedia.org/wiki/Reserved_IP_addresses
  const blacklistedAddresses =
    options.blacklistedAddresses || DEFAULT_BLACKLIST;

  //Non CORS hosts and domains we proxy to
  function proxyAllowedHost(host) {
    // Exclude hosts that are really IP addresses and are in our blacklist.
    if (rangeCheck.inRange(host, blacklistedAddresses)) {
      return false;
    }

    if (proxyAllDomains) {
      return true;
    }

    const lowercaseHost = host.toLowerCase();
    //check that host is from one of whitelisted domains
    return proxyDomains.some((domain) => {
      const domainLower = domain.toLowerCase();
      // Exact match OR subdomain match (with leading dot)
      return (
        lowercaseHost === domainLower ||
        lowercaseHost.endsWith("." + domainLower)
      );
    });
  }

  async function doProxy(req, res) {
    try {
      const duration = req.params.duration;
      let maxAgeSeconds = duration
        ? processDuration(duration)
        : DEFAULT_MAX_AGE_SECONDS;

      const target = processTargetUrl(req.params.target);
      const requestUrl = new URL(req.url, target);
      const remoteUrl = buildRemoteUrl(
        target,
        requestUrl,
        appendParamToQueryString
      );

      const filteredReqHeaders = filterHeaders(req.headers, req.socket);

      // Remove the Authorization header if we used it to authenticate the request to terriajs-server.
      if (
        options.basicAuthentication &&
        options.basicAuthentication.username &&
        options.basicAuthentication.password
      ) {
        delete filteredReqHeaders["authorization"];
      }

      // After removing terriajs-server auth, check if there's user auth for the proxied server
      const userAuthHeader = filteredReqHeaders["authorization"];

      let upstreamProxy = undefined;
      if (
        options.upstreamProxy &&
        !(options.bypassUpstreamProxyHosts || {})[remoteUrl.host]
      ) {
        upstreamProxy = options.upstreamProxy;
      }

      const secureAgent = createSecureAgent(blacklistedAddresses, {
        rejectUnauthorized: options.rejectUnauthorized,
        upstreamProxy: upstreamProxy,
        connectTimeout: connectTimeout,
        headersTimeout: headersTimeout
      });

      const dispatcher = secureAgent.compose(
        hostnameInterceptor({
          validateHost: proxyAllowedHost
        }),
        redirectInterceptor({ maxRedirections: 5 })
      );

      const authStrategies = buildAuthStrategies({
        userAuth: userAuthHeader,
        proxyAuth: proxyAuth,
        host: remoteUrl.host
      });

      const response = await executeWithRetry({
        strategies: authStrategies,
        requestOptions: {
          url: remoteUrl.href,
          method: req.method,
          headers: filteredReqHeaders,
          body: req.body
        },
        fetchFn: (opts) =>
          undici.request(opts.url, {
            ...opts,
            dispatcher
          })
      });
      const { statusCode, headers, body } = response;

      // Handle error responses
      if (statusCode >= 400) {
        res.set(processHeaders({}, undefined));
        try {
          const errorBody = await body.json();
          res.status(statusCode).send(errorBody);
        } catch {
          res.status(statusCode).send("Error");
          await body.dump();
        }
        return response;
      }

      // Handle success responses
      res.set(processHeaders(headers, maxAgeSeconds));
      res.status(statusCode);

      // Handle errors on the source stream (upstream response body)
      body.on("error", (err) => {
        console.error("Upstream stream error:", err);
        // Destroy the upstream to stop reading
        body.destroy();
        // End the response (headers likely already sent at this point)
        if (!res.writableEnded) {
          res.end();
        }
      });

      // Handle errors on the destination stream (client response)
      res.on("error", (err) => {
        console.error("Client stream error:", err);
        // Client disconnected, clean up the upstream stream
        if (!body.destroyed) {
          body.destroy();
        }
      });
      res.on("close", () => {
        // Client disconnected or server closed early
        try {
          body.destroy();
        } catch {
          // Ignore errors during cleanup
        }
      });

      // Pipe the streams
      body.pipe(res);
    } catch (err) {
      if (res.headersSent) {
        return res.end();
      }
      if (err.code === "INVALID_PROTOCOL") {
        return res.status(400).send(err.message);
      }

      if (err.code === "NO_URL_SPECIFIED") {
        return res.status(400).send(err.message);
      }

      if (err.code === "INVALID_DURATION") {
        return res.status(400).send(err.message);
      }

      // Handle timeout errors
      if (err.code === "UND_ERR_HEADERS_TIMEOUT") {
        return res
          .status(504)
          .send("Gateway timeout: Headers not received in time");
      }

      if (err.code === "UND_ERR_CONNECT_TIMEOUT") {
        return res
          .status(504)
          .send("Gateway timeout: Could not connect to upstream server");
      }

      if (err.code === "BLACKLISTED_IP") {
        return res
          .status(403)
          .send(`IP address is not allowed: ${err.address}`);
      }

      if (err.code === "BLOCKED_HOST") {
        return res
          .status(403)
          .send(`Host is not in list of allowed hosts: ${err.host}`);
      }

      console.error("Proxy error:", err);
      res.status(500).send({
        error: "Proxy error",
        code: err.code || "UNKNOWN",
        ...(process.env.NODE_ENV === "development" && {
          message: err.message,
          stack: err.stack
        })
      });
    }
  }

  const router = express.Router();

  router.get(/^\/_([^/]+)(?:\/(.*))?$/, (req, res, next) => {
    req.params.duration = req.params[0];
    req.params.target = req.params[1];
    return doProxy(req, res, next);
  });

  router.get("/*", (req, res, next) => {
    req.params.target = req.params[0];
    return doProxy(req, res, next);
  });

  router.post(
    /^\/_([^/]+)(?:\/(.*))?$/,
    bodyParser.raw({
      type: function () {
        return true;
      },
      limit: proxyPostSizeLimit
    }),
    (req, res, next) => {
      req.params.duration = req.params[0];
      req.params.target = req.params[1];
      return doProxy(req, res, next);
    }
  );

  router.post(
    "/*",
    bodyParser.raw({
      type: function () {
        return true;
      },
      limit: proxyPostSizeLimit
    }),
    (req, res, next) => {
      req.params.target = req.params[0];
      return doProxy(req, res, next);
    }
  );

  router.use(function (err, req, res, next) {
    if (err.status === 413 || err.type === "entity.too.large") {
      res.status(413).send("Proxy POST body too large.");
    } else {
      next(err);
    }
  });

  return router;
};
