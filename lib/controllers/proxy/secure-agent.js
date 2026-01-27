"use strict";

const { Agent, buildConnector, ProxyAgent } = require("undici");
const rangeCheck = require("range_check");

/**
 * Creates an undici Agent that blocks connections to blacklisted IP addresses.
 * The agent intercepts DNS lookups and destroys the socket before connection
 * if the resolved IP is in the blacklist.
 *
 * @param {Array<string>} blacklistedAddresses - Array of IP addresses/ranges to block (e.g., ["127.0.0.0/8", "10.0.0.0/8"])
 * @param {object} options - Additional Agent options (connections, pipelining, etc.)
 * @param {boolean} options.rejectUnauthorized - Whether to reject unauthorized TLS certificates (default: true)
 * @param {string} [options.upstreamProxy] - Upstream proxy URL (e.g., "http://proxy:8080")
 * @param {number} [options.connectTimeout] - Connection timeout in ms (default: 10000)
 * @param {number} [options.headersTimeout] - Headers timeout in ms (default: 30000)
 * @returns {Agent | ProxyAgent} Configured undici Agent with IP blacklisting
 */
function createSecureAgent(
  blacklistedAddresses,
  options = {
    rejectUnauthorized: true,
    connectTimeout: 10000,
    headersTimeout: 30000
  }
) {
  const {
    rejectUnauthorized = true,
    upstreamProxy,
    connectTimeout,
    headersTimeout,
    ...agentOptions
  } = options;

  const SecureAgent = upstreamProxy ? ProxyAgent : Agent;

  // Create connector with rejectUnauthorized and connectTimeout
  const connector = buildConnector({
    rejectUnauthorized,
    timeout: connectTimeout
  });

  return new SecureAgent({
    uri: upstreamProxy,
    headersTimeout,
    ...agentOptions,
    async connect(opts, cb) {
      const socket = connector({ ...opts }, (err, connection) => {
        if (err) {
          cb(err);
        } else {
          cb(null, connection);
        }
      });

      socket.on("lookup", function (_err, address, _family, host) {
        if (rangeCheck.inRange(address, blacklistedAddresses)) {
          const error = new Error(`socket IP address is not allowed: ${host}`);
          error.code = "BLACKLISTED_IP";
          error.address = address;
          error.host = host;
          socket.destroy(error);
        }
      });
    }
  });
}

module.exports = createSecureAgent;
