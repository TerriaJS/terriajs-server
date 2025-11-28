const { DO_NOT_PROXY_REGEX } = require("./constants");

/**
 * Filters headers that are not matched by {@link DO_NOT_PROXY_REGEX} out of an object containing headers. This does not
 * mutate the original list.
 *
 * @param {Object} headers The headers to filter
 * @param socket The socket the request is being made on (optional)
 * @returns {Object} A new object with the filtered headers.
 */
function filterHeaders(headers, socket) {
  const result = {};
  // filter out headers that are listed in the regex above
  Object.keys(headers).forEach(function (name) {
    if (!DO_NOT_PROXY_REGEX.test(name)) {
      result[name] = headers[name];
    }
  });

  if (!socket) {
    return result;
  }

  if (result["x-forwarded-for"]) {
    result["x-forwarded-for"] =
      `${result["x-forwarded-for"]}, ${socket.remoteAddress}`;
  } else if (socket.remoteAddress) {
    result["x-forwarded-for"] = socket.remoteAddress;
  }

  return result;
}

module.exports = { filterHeaders };
