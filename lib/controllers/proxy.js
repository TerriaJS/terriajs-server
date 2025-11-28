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
  PROTOCOL_REGEX,
  DEFAULT_MAX_AGE_SECONDS,
  DEFAULT_MAX_SIZE,
  DEFAULT_BLACKLIST
} = require("./proxy/constants");
const { processDuration } = require("./proxy/process-duration");
const { processHeaders } = require("./proxy/process-headers");
const { filterHeaders } = require("./proxy/filter-headers");
const { processTargetUrl } = require("./proxy/process-target-url");
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
 *
 * @returns {*} A middleware that can be used with express.
 */
module.exports = function (options) {
  const proxyAllDomains = options.proxyAllDomains;
  const proxyDomains = options.proxyableDomains || [];
  const proxyAuth = options.proxyAuth || {};
  const proxyPostSizeLimit = options.proxyPostSizeLimit || DEFAULT_MAX_SIZE;
  const appendParamToQueryString = options.appendParamToQueryString || {};
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

    host = host.toLowerCase();
    //check that host is from one of these domains
    for (let i = 0; i < proxyDomains.length; i++) {
      if (
        host.indexOf(proxyDomains[i], host.length - proxyDomains[i].length) !==
        -1
      ) {
        return true;
      }
    }
    return false;
  }

  async function doProxy(req, res) {
    let duration = req.params.duration;
    let maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS;
    if (duration) {
      try {
        maxAgeSeconds = processDuration(duration);
      } catch (err) {
        if (err.code === "INVALID_DURATION") {
          return res.status(400).send(err.message);
        } else {
          return res.status(500).send("Internal Server Error");
        }
      }
    }

    let target = req.params.target;
    try {
      target = processTargetUrl(target);
    } catch (err) {
      if (err.code === "NO_URL_SPECIFIED") {
        return res.status(400).send(err.message);
      } else {
        return res.status(500).send("Internal Server Error");
      }
    }

    const remoteUrl = new URL(target);
    // Copy the query string from the incoming request
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    remoteUrl.search = requestUrl.search;

    if (appendParamToQueryString[remoteUrl.host]) {
      const appendOptions = appendParamToQueryString[remoteUrl.host];

      for (let i = 0; i < appendOptions.length; i++) {
        const option = appendOptions[i];
        const appendUrlRegexPattern = new RegExp(option.regexPattern, "g");
        const params = option.params;
        if (appendUrlRegexPattern.test(remoteUrl.href)) {
          const paramsString = Object.keys(params)
            .map((key) => key + "=" + params[key])
            .join("&");
          if (remoteUrl.search === "") {
            // URL API automatically adds '?' when setting search
            remoteUrl.search = paramsString;
          } else {
            // remoteUrl.search already includes '?', so append with '&'
            remoteUrl.search += "&" + paramsString;
          }
        }
      }
    }

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

    const targetUrl = remoteUrl.href;
    const httpVerb = req.method;

    const secureAgent = createSecureAgent(blacklistedAddresses, {
      rejectUnauthorized: options.rejectUnauthorized,
      upstreamProxy: upstreamProxy
    });

    const dispatcher = secureAgent.compose(
      hostnameInterceptor({
        validateHost: proxyAllowedHost
      }),
      redirectInterceptor({ maxRedirections: 5 })
    );

    // Build list of auth methods to try
    const authMethods = [];

    // 1. User auth from request (if provided and not used for terriajs-server)
    if (userAuthHeader) {
      authMethods.push({ type: "user", authorization: userAuthHeader });
    }

    // 2. Proxy auth from config (if exists for this host)
    const hostAuth = proxyAuth[remoteUrl.host];
    if (hostAuth && (hostAuth.authorization || hostAuth.headers)) {
      authMethods.push({
        type: "proxy",
        authorization: hostAuth.authorization,
        headers: hostAuth.headers
      });
    }

    // 3. No auth (always as fallback if we have other methods, or as the only method)
    authMethods.push({ type: "none" });

    // Try each auth method in order
    async function tryRequest(authMethodIndex) {
      if (authMethodIndex >= authMethods.length) {
        throw new Error("No auth methods left to try");
      }

      const authMethod = authMethods[authMethodIndex];
      const requestHeaders = { ...filteredReqHeaders };

      // Build request headers based on auth method
      if (authMethod) {
        if (authMethod.type === "none") {
          delete requestHeaders.authorization;
        } else {
          requestHeaders.authorization = authMethod.authorization;
        }

        // Apply any additional headers from proxy config
        if (authMethod.headers) {
          authMethod.headers.forEach((header) => {
            requestHeaders[header.name] = header.value;
          });
        }
      }

      const response = await undici.request(targetUrl, {
        dispatcher: dispatcher,
        method: httpVerb,
        headers: requestHeaders,
        body: req.body
      });

      const { statusCode, headers, body } = response;

      // If we got 401 or 403, try next auth method
      const shouldRetry = authMethodIndex < authMethods.length - 1;
      if ((statusCode === 401 || statusCode === 403) && shouldRetry) {
        await body.dump();
        return tryRequest(authMethodIndex + 1);
      }

      // Handle error responses
      if (statusCode > 400) {
        try {
          const errorBody = await body.json();
          res.status(statusCode).json(errorBody);
        } catch {
          res.status(statusCode).json({
            statusCode: statusCode,
            message: headers["status-message"] || "Error"
          });
          await body.dump();
        }
        return response;
      }

      // Handle success responses
      res.set(processHeaders(headers, maxAgeSeconds));
      res.status(statusCode);
      body.pipe(res);
      return response;
    }

    // Execute request with retry logic
    tryRequest(0).catch((err) => {
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

      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).send("Proxy error");
      }
    });
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
