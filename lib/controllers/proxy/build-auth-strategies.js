/**
 * @typedef {Object} AuthStrategy
 * @property {'user' | 'proxy' | 'none'} type
 * @property {string} [authorization]
 * @property {Array<{name: string, value: string}>} [headers]
 */

/**
 * Pure function: builds list of auth strategies to try in order
 * @param {Object} options
 * @param {string|null} options.userAuth - User-provided auth header
 * @param {Record<string, {authorization?: string, headers?: Array<{name: string, value: string}>}|undefined>} options.proxyAuth - Proxy auth configuration
 * @param {string} options.host - Target host
 * @returns {Array<AuthStrategy>} Immutable array of auth strategies
 */
function buildAuthStrategies({ userAuth, proxyAuth = {}, host }) {
  /**
   * @type {Array<AuthStrategy>}
   */
  const strategies = [];

  // User auth first (if provided)
  if (userAuth) {
    strategies.push({
      type: "user",
      authorization: userAuth
    });
  }

  // Proxy auth second (if configured for this host)
  const hostAuth = proxyAuth[host];
  if (hostAuth && (hostAuth.authorization || hostAuth.headers)) {
    strategies.push({
      type: "proxy",
      authorization: hostAuth.authorization,
      headers: hostAuth.headers
    });
  }

  // No auth as final fallback
  strategies.push({ type: "none" });

  return strategies;
}

module.exports = { buildAuthStrategies };
