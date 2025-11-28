const { PROTOCOL_REGEX } = require("./constants");
const url = require("url");

/**
 *
 * @param {string} target - The target URL string from the request
 * @returns {string}
 */
function processTargetUrl(target) {
  if (!target || target.length === 0) {
    const error = new Error("No url specified.");
    error.code = "NO_URL_SPECIFIED";
    throw error;
  }

  const protocolMatch = PROTOCOL_REGEX.exec(target);
  let resultUrl = target;

  // Add http:// if no protocol is specified.
  if (!protocolMatch || protocolMatch.length < 1) {
    resultUrl = `http://${target}`;
  } else {
    const matchedPart = protocolMatch[0];
    // If the protocol portion of the URL only has a single slash after it, the extra slash was probably stripped off by someone
    // along the way (NGINX will do this).  Add it back.
    if (resultUrl[matchedPart.length] !== "/") {
      resultUrl = matchedPart + "/" + resultUrl.substring(matchedPart.length);
    }
  }

  return resultUrl;
}

module.exports = { processTargetUrl };
