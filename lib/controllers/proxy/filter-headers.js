const { DO_NOT_PROXY_REGEX } = require("./constants");

/**
 * Filters headers that are not matched by {@link DO_NOT_PROXY_REGEX} out of an object containing headers. This does not
 * mutate the original list.
 *
 * @param {Record<string, unknown>} headers The headers to filter
 * @param {any?} socket The socket the request is being made on (optional)
 * @returns {Record<string, unknown>} A new object with the filtered headers.
 */
function filterHeaders(headers, socket) {
  /**
   * @type {Record<string, unknown>}
   */
  const result = {};
  // filter out headers that are listed in the regex above
  Object.keys(headers).forEach(function (name) {
    if (!DO_NOT_PROXY_REGEX.test(name)) {
      result[name] = headers[name];
    }
  });

  if (!socket || !socket.remoteAddress) {
    return result;
  }

  // if (result["x-forwarded-for"]) {
  //   result["x-forwarded-for"] =
  //     `${result["x-forwarded-for"]}, ${socket.remoteAddress}`;
  // } else {
  //   result["x-forwarded-for"] = socket.remoteAddress;
  // }

  return result;
}

module.exports = { filterHeaders };
