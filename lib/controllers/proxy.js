/* jshint node: true */
"use strict";

const express = require("express");
const undici = require("undici");
const bodyParser = require("body-parser");
const rangeCheck = require("range_check");
const createSecureAgent = require("./proxy/secure-agent");
const { hostnameInterceptor } = require("./proxy/hostname-interceptor");
const { interceptors } = require("undici");
const {
  DEFAULT_MAX_AGE_SECONDS,
  DEFAULT_MAX_SIZE,
  DEFAULT_BLACKLIST,
  DEFAULT_HEADERS_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  MAX_REDIRECTS
} = require("./proxy/constants");
const { processDuration } = require("./proxy/process-duration");
const { processHeaders } = require("./proxy/process-headers");
const { filterHeaders } = require("./proxy/filter-headers");
const { processTargetUrl } = require("./proxy/process-target-url");
const { buildRemoteUrl } = require("./proxy/build-remote-url");
const { buildAuthStrategies } = require("./proxy/build-auth-strategies");
const { executeWithRetry } = require("./proxy/execute-with-retry");
/**
 * Creates an express middleware that proxies calls to '/proxy/http://example' to 'http://example', while forcing them
 * to be cached by the browser and overrwriting CORS headers. A cache duration can be added with a URL like
 * /proxy/_5m/http://example which causes 'Cache-Control: public,max-age=300' to be added to the response headers.
 *
 * @param {Object} options
 * @param {Array<String>} options.proxyableDomains An array of domains to be proxied
 * @param {boolean} options.proxyAllDomains A boolean indicating whether or not we should proxy ALL domains - overrides
 *                      the configuration in options.proxyDomains
 * @param {String} options.proxyAuth A map of domains to tokens that will be passed to those domains via basic auth
 *                      when proxying through them.
 * @param {String} options.upstreamProxy Url of a standard upstream proxy that will be used to retrieve data.
 * @param {Record<string, true>} options.bypassUpstreamProxyHosts An object of hosts (as strings) to 'true' values.
 * @param {String} options.proxyPostSizeLimit The maximum size of a POST request that the proxy will allow through,
                        in bytes if no unit is specified, or some reasonable unit like 'kb' for kilobytes or 'mb' for megabytes.
 * @param {import('./proxy/types').AppendParamToQueryString} options.appendParamToQueryString An object of query string parameters to append to the proxied URL.
 * @param {Array<String>} options.blacklistedAddresses An array of IP addresses or CIDR ranges that should not be proxied to.
 * @param {Object} options.basicAuthentication Basic authentication configuration for terriajs-server itself.
 * @param {String} options.basicAuthentication.username Username for basic authentication.
 * @param {String} options.basicAuthentication.password Password for basic authentication.
 * @param {boolean} options.rejectUnauthorized Whether to reject unauthorized TLS certificates (default: true)
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
  const rejectUnauthorized = options.rejectUnauthorized ?? true;

  // Timeout configurations (in milliseconds)
  const headersTimeout = options.headersTimeout || DEFAULT_HEADERS_TIMEOUT_MS; // 30 seconds default
  const connectTimeout = options.connectTimeout || DEFAULT_CONNECT_TIMEOUT_MS; // 10 seconds default
  // If you change this, also change the same list in serverconfig.json.example.
  // This page is helpful: https://en.wikipedia.org/wiki/Reserved_IP_addresses
  const blacklistedAddresses =
    options.blacklistedAddresses || DEFAULT_BLACKLIST;

  /**
   *
   * @param {string} hostname
   * @param {string | undefined} port
   * @returns {boolean}
   */
  function proxyAllowedHost(hostname, port) {
    // Exclude hosts that are really IP addresses and are in our blacklist.
    if (
      rangeCheck.inRange(hostname, blacklistedAddresses) ||
      rangeCheck.inRange(`${hostname}:${port}`, blacklistedAddresses)
    ) {
      return false;
    }

    if (proxyAllDomains) {
      return true;
    }

    const lowercaseHostname = hostname.toLowerCase();
    //check that host is from one of whitelisted domains
    return proxyDomains.some((domain) => {
      const domainLower = domain.toLowerCase();
      // Exact match OR subdomain match (with leading dot)
      return (
        rangeCheck.inRange(lowercaseHostname, domainLower) ||
        rangeCheck.inRange(`${lowercaseHostname}:${port}`, domainLower) ||
        `${lowercaseHostname}:${port}` === domainLower ||
        lowercaseHostname === domainLower ||
        lowercaseHostname.endsWith("." + domainLower)
      );
    });
  }

  /**
   *
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   * @returns
   */
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

      const userAuthHeader = filteredReqHeaders["authorization"];

      let upstreamProxy = undefined;
      if (
        options.upstreamProxy &&
        !(options.bypassUpstreamProxyHosts || {})[remoteUrl.host]
      ) {
        upstreamProxy = options.upstreamProxy;
      }

      const secureAgent = createSecureAgent(blacklistedAddresses, {
        rejectUnauthorized: rejectUnauthorized,
        upstreamProxy: upstreamProxy,
        connectTimeout: connectTimeout,
        headersTimeout: headersTimeout
      });

      const dispatcher = secureAgent.compose(
        interceptors.responseError(),
        hostnameInterceptor({
          validateHost: proxyAllowedHost
        }),
        interceptors.redirect({ maxRedirections: MAX_REDIRECTS })
      );

      const authStrategies = buildAuthStrategies({
        userAuth: userAuthHeader,
        proxyAuth: proxyAuth,
        host: remoteUrl.host
      });

      const response = await executeWithRetry({
        strategies: authStrategies,
        requestOptions: {
          headers: filteredReqHeaders
        },
        fetchFn: (opts) =>
          undici.request(remoteUrl.href, {
            headers: opts.headers,
            method: req.method,
            body: req.body,
            dispatcher
          })
      });
      const { statusCode, headers, body } = response;

      // Handle success responses
      res.set(processHeaders(headers, maxAgeSeconds));
      res.status(statusCode);

      // Pipe the streams
      body.pipe(res);

      body.on("error", (streamErr) => {
        console.error("Stream error:", streamErr);
        if (!res.headersSent) {
          res.status(502).send("Stream error");
        } else {
          res.destroy();
        }
      });
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
      if (err.statusCode) {
        return res.status(err.statusCode).send(err.body ?? "Error");
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

  router.get(/^\/_([^/]+)(?:\/(.*))?$/, (req, res) => {
    req.params.duration = req.params[0];
    req.params.target = req.params[1];
    return doProxy(req, res);
  });

  router.get("/*", (req, res) => {
    req.params.target = req.params[0];
    return doProxy(req, res);
  });

  router.post(
    /^\/_([^/]+)(?:\/(.*))?$/,
    bodyParser.raw({
      type: function () {
        return true;
      },
      limit: proxyPostSizeLimit
    }),
    (req, res) => {
      req.params.duration = req.params[0];
      req.params.target = req.params[1];
      return doProxy(req, res);
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
    (req, res) => {
      req.params.target = req.params[0];
      return doProxy(req, res);
    }
  );

  router.use((err, _req, res, next) => {
    if (err.status === 413 || err.type === "entity.too.large") {
      res.status(413).send("Proxy POST body too large.");
    } else {
      next(err);
    }
  });

  return router;
};
