"use strict";

const { Agent, buildConnector, ProxyAgent } = require("undici");
const rangeCheck = require("range_check");

/**
 * Creates an undici Agent that blocks connections to blacklisted IP addresses.
 * The agent intercepts DNS lookups and destroys the socket before connection
 * if the resolved IP is in the blacklist.
 *
 * @param {Array<string>} blacklistedAddresses - Array of IP addresses/ranges to block (e.g., ["127.0.0.0/8", "10.0.0.0/8"])
 * @param {Object} options - Additional Agent options (connections, pipelining, etc.)
 * @param {boolean} options.rejectUnauthorized - Whether to reject unauthorized TLS certificates (default: true)
 * @param {string} options.upstreamProxy - Upstream proxy URL  (e.g., "http://proxy:8080")
 * @param {number} options.connectTimeout - Timeout in ms for establishing connection (default: 10000)
 * @returns {Agent} Configured undici Agent with IP blacklisting
 */
function createSecureAgent(blacklistedAddresses, options = {}) {
  const {
    rejectUnauthorized = true,
    upstreamProxy,
    connectTimeout,
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
