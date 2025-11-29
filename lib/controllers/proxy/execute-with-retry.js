const { buildRequestHeaders } = require("./build-request-headers");
const { AUTH_STATUS_CODES } = require("./constants");

/**
 * @callback FetchFunction
 * @param {Object} opts
 * @param {import("undici").Dispatcher.DispatchOptions['headers']} opts.headers
 */

/**
 * Executes request with auth retry logic
 * Pure function (side effects isolated to fetchFn)
 * @param {Object} options
 * @param {Array<import('./types').AuthStrategy>} options.strategies - Auth strategies to try
 * @param {Object} options.requestOptions - Base request options
 * @param {import("http").IncomingHttpHeaders} options.requestOptions.headers - Base request headers
 * @param {FetchFunction} options.fetchFn - Function to execute request (undici.request)
 * @returns {Promise<import('undici').Dispatcher.ResponseData<unknown>>} Response object
 */
async function executeWithRetry({ strategies, requestOptions, fetchFn }) {
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    const isLastStrategy = i === strategies.length - 1;

    const headers = buildRequestHeaders(requestOptions.headers, strategy);
    const response = await fetchFn({
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
