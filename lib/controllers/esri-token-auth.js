import express from "express";
import bodyParser from "body-parser";
import url from "url";

const router = express.Router();

export default function (options) {
  if (!options || !options.servers) {
    return;
  }

  // The maximum size of the JSON data.
  let postSizeLimit = options.postSizeLimit || "1024";

  let tokenServers = parseUrls(options.servers);
  tokenServers = validateServerConfig(tokenServers);

  router.use(
    bodyParser.json({ limit: postSizeLimit, type: "application/json" })
  );
  router.post("/", async function (req, res, next) {
    let parameters = req.body;

    if (!parameters.url) {
      return res.status(400).send("No URL specified.");
    }

    let targetUrl = parseUrl(parameters.url);
    if (!targetUrl || targetUrl.length === 0 || typeof targetUrl !== "string") {
      return res.status(400).send("Invalid URL specified.");
    }

    let tokenServer = tokenServers[targetUrl];
    if (!tokenServer) {
      return res.status(400).send("Unsupported URL specified.");
    }

    try {
      // Create form-encoded body
      const formBody = new URLSearchParams({
        username: tokenServer.username,
        password: tokenServer.password,
        f: "JSON"
      });

      const response = await fetch(tokenServer.tokenUrl, {
        method: "POST",
        headers: {
          "User-Agent": "TerriaJSESRITokenAuth",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formBody
      });

      if (response.status < 200 || response.status >= 300) {
        return res.status(502).send("Token server failed.");
      }

      const body = await response.json();
      res.set("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify(body));
    } catch (error) {
      return res.status(500).send("Error processing server response.");
    }
  });

  return router;
}

function parseUrls(servers) {
  let result = {};

  Object.keys(servers).forEach((server) => {
    let parsedUrl = parseUrl(server);
    if (parsedUrl) {
      result[parsedUrl] = servers[server];
    } else {
      console.error(
        "Invalid configuration. The URL: '" + server + "' is not valid."
      );
    }
  });

  return result;
}

function parseUrl(urlString) {
  try {
    return url.format(url.parse(urlString));
  } catch (error) {
    return "";
  }
}

function validateServerConfig(servers) {
  let result = {};

  Object.keys(servers).forEach((serverUrl) => {
    let server = servers[serverUrl];
    if (server.username && server.password && server.tokenUrl) {
      result[serverUrl] = server;

      // Note: We should really only validate URLs that are HTTPS to save us from ourselves, but the current
      // servers we need to support don't support HTTPS :( so the best that we can do is warn against it.
      if (!isHttps(server.tokenUrl)) {
        console.error(
          "All communications should be TLS but the URL '" +
            server.tokenUrl +
            "' does not use https."
        );
      }
    } else {
      console.error(
        "Bad Configuration. '" +
          serverUrl +
          "' does not supply all of the required properties."
      );
    }
  });

  return result;
}

function isHttps(urlString) {
  try {
    return url.parse(urlString).protocol === "https:";
  } catch (error) {
    return false;
  }
}
