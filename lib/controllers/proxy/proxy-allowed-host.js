const rangeCheck = require("range_check");

/**
 *
 * @param {Object} options
 * @param {boolean} options.proxyAllDomains
 * @param {Array<string>} options.proxyableDomains
 * @param {Array<string>} options.blacklistedAddresses
 *
 * @returns {function(string, string=): boolean}
 */
function makeHostnameMatcher(options) {
  const proxyAllDomains = options.proxyAllDomains || false;
  const proxyableDomains = options.proxyableDomains || [];
  const blacklistedAddresses = options.blacklistedAddresses || [];

  /**
   *
   * @param {string} hostname
   * @param {string | undefined} port
   * @returns {boolean}
   */
  return function proxyAllowedHost(hostname, port) {
    // Exclude hosts that are really IP addresses and are in our blacklist.
    if (
      rangeCheck.inRange(hostname, blacklistedAddresses) ||
      rangeCheck.inRange(`${hostname}:${port}`, blacklistedAddresses) ||
      blacklistedAddresses.some(
        (addr) =>
          addr.toLowerCase() === `${hostname}:${port}`.toLowerCase() ||
          addr.toLowerCase() === hostname.toLowerCase()
      )
    ) {
      return false;
    }

    if (proxyAllDomains) {
      return true;
    }

    const lowercaseHostname = hostname.toLowerCase();
    //check that host is from one of whitelisted domains
    return proxyableDomains.some((domain) => {
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
  };
}

module.exports = {
  makeHostnameMatcher
};
