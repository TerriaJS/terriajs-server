// TODO: make import statements when tsified
const options = require("./options");
const makeserver = require("./makeserver");

import exists from "./exists";

options.init(false);

console.log(
  'Serving directory "' +
    options.wwwroot +
    '" on port ' +
    options.port +
    " to " +
    (options.listenHost ? options.listenHost : "the world") +
    "."
);
require("./controllers/convert")().testGdal();

function warn(message: string) {
  console.warn("Warning: " + message);
}

if (!exists(options.wwwroot)) {
  warn('"' + options.wwwroot + '" does not exist.');
} else if (!exists(options.wwwroot + "/index.html")) {
  warn('"' + options.wwwroot + '" is not a TerriaJS wwwroot directory.');
} else if (!exists(options.wwwroot + "/build")) {
  warn(
    '"' +
      options.wwwroot +
      '" has not been built. You should do this:\n\n' +
      "> cd " +
      options.wwwroot +
      "/..\n" +
      "> gulp\n"
  );
}

if (typeof options.settings.allowProxyFor === "undefined") {
  warn(
    'The configuration does not contain a "allowProxyFor" list.  The server will proxy _any_ request.'
  );
}

makeserver(options).listen(options.port, options.listenHost);
