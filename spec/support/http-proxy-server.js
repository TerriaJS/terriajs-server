const express = require("express");
const httpProxy = require("http-proxy");
const http = require("node:http");
const net = require("node:net");
const url = require("node:url");

const createProxyServer = (port, connectCallback) => {
  const app = express();
  const proxy = httpProxy.createProxyServer({});

  // Handle regular HTTP proxying
  app.use((req, res) => {
    const targetUrl = req.url;
    // Call the callback to track that proxy was used
    if (connectCallback && targetUrl.startsWith("http://")) {
      connectCallback();
    }

    proxy.web(req, res, { target: `http://${req.headers.host}` }, (err) => {
      console.error("Proxy error:", err);
      res.status(502).send("Bad Gateway");
    });
  });

  const server = http.createServer(app);

  server.on("connect", (req, clientSocket, head) => {
    connectCallback();
    const { hostname, port } = new url.URL(`https://${req.url}`);
    const serverSocket = net.connect(parseInt(port) || 443, hostname, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("error", (err) => {
      console.error("HTTPS CONNECT error:", err);
      clientSocket.end();
    });
  });

  // Start server
  server.listen(port, () => {
    console.log(`Proxy server running on port ${port}`);
  });

  return {
    close: () => {
      server.close();
    }
  };
};

module.exports = {
  createProxyServer
};
