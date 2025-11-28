"use strict";
/**
 * Creates an undici interceptor that validates redirect destinations before following them.
 * This provides per-redirect validation to ensure redirects don't go to blacklisted hosts.
 *
 * @param {Object} options
 * @param {Function} options.validateHost - Function(hostname) that returns true if redirect is allowed
 * @returns {Function} Interceptor function for use with dispatcher.compose()
 */
function hostnameInterceptor({ validateHost }) {
  if (typeof validateHost !== "function") {
    throw new Error(
      "createValidatingRedirectInterceptor requires validateHost function"
    );
  }

  return (dispatch) => {
    return function Intercept(opts, handler) {
      // Validate the host before making the request
      const hostname =
        opts.hostname || (opts.origin && new URL(opts.origin).host);

      if (hostname && !validateHost(hostname)) {
        const error = new Error(
          `Connection blocked: Host not allowed: ${hostname}`
        );
        error.code = "BLOCKED_HOST";
        error.host = hostname;

        // Call error handler if available
        if (handler.onError) {
          handler.onError(error);
        }

        throw error;
      }

      // Host is allowed, proceed with the request
      return dispatch(opts, handler);
    };
  };
}

module.exports = { hostnameInterceptor };
