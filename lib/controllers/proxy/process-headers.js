const { filterHeaders } = require("./filter-headers");
/**
 * Filters out headers that shouldn't be proxied, overrides caching so files are retained for {@link DEFAULT_MAX_AGE_SECONDS},
 * and sets CORS headers to allow all origins
 *
 * @param headers The original object of headers. This is not mutated.
 * @param maxAgeSeconds the amount of time in seconds to cache for. This will override what the original server
 *          specified because we know better than they do.
 * @returns {Object} The new headers object.
 */
function processHeaders(headers, maxAgeSeconds) {
  const result = filterHeaders(headers);

  if (maxAgeSeconds !== undefined) {
    result["cache-control"] = `public,max-age=${maxAgeSeconds}`;
  }

  result["access-control-allow-origin"] = "*";
  return result;
}

module.exports = { processHeaders };
