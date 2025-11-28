const { buildRequestHeaders } = require("./build-request-headers");
const { AUTH_STATUS_CODES } = require("./constants");

/**
   * Executes request with auth retry logic
   * Pure function (side effects isolated to fetchFn)
   * @param {Object} options
   * @param {Array<import('./build-auth-strategies').AuthStrategy>} options.strategies - Auth strategies to try
   * @param {Object} options.requestOptions - Base request options
   * @param {Function} options.fetchFn - Function to execute request 
  (undici.request)
   * @returns {Promise<Object>} Response object
   */
async function executeWithRetry({ strategies, requestOptions, fetchFn }) {
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const isLastStrategy = i === strategies.length - 1;

    const headers = buildRequestHeaders(requestOptions.headers, strategy);
    const response = await fetchFn({
      ...requestOptions,
      headers
    });

    const shouldRetry =
      AUTH_STATUS_CODES.includes(response.statusCode) && !isLastStrategy;

    if (shouldRetry) {
      // Dump body before retrying
      try {
        await response.body.dump();
      } catch (dumpErr) {
        console.warn(
          "Failed to dump response body before retrying auth:",
          dumpErr
        );
      }
      continue;
    }

    // Either success or last attempt failed - return response
    return response;
  }

  // This shouldn't happen if strategies always includes 'none'
  throw new Error("No auth strategies provided");
}

module.exports = { executeWithRetry };
