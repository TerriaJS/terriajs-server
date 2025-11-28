/**
 *
 * @param {string} target
 * @param {URL} requestUrl
 * @param {Record<string, Array<{regexPattern: string, params: Record<string, string>}>>} appendParamToQueryString
 * @returns {URL}
 */
function buildRemoteUrl(target, requestUrl, appendParamToQueryString = {}) {
  const remoteUrl = new URL(target);

  // Copy the query string from the incoming request
  const searchParams = new URLSearchParams(requestUrl.search);

  const hostConfig = appendParamToQueryString[remoteUrl.host];
  const paramsToAppend = hostConfig
    ?.filter((option) => new RegExp(option.regexPattern).test(remoteUrl.href))
    .flatMap((option) => Object.entries(option.params));

  paramsToAppend?.forEach(([key, value]) => {
    searchParams.append(key, value);
  });

  remoteUrl.search = searchParams.toString();

  return remoteUrl;
}

module.exports = { buildRemoteUrl };
