import { Agent, request, buildConnector } from "undici";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";

const connector = buildConnector({ rejectUnauthorized: true });

const agent = new Agent({
  async connect(opts, cb) {
    const socket = connector({ ...opts }, (err, socket1) => {
      if (err) {
        cb(err);
      } else {
        cb(null, socket1);
      }
    });

    socket.on("lookup", function (err, address, family, host) {
      // noop default lookup handler
      console.log("1111111ookup event:", { err, address, family, host });
    });
  }
});

(async () => {
  try {
    const res = await request("https://example.com/", {
      dispatcher: agent,
      // the Host header is mandatory for virtual hosts
      headers: { Host: "example.com" }
    });

    console.log("Status:", res.statusCode);
    console.log("First 100 bytes:\n", (await res.body.text()).slice(0, 100));
  } catch (err) {
    console.error("Request failed:", err);
  } finally {
    agent.close();
  }
})();
