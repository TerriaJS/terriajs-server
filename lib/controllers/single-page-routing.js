var fs = require('fs');
var path = require('path');
var router = require('express').Router();
import { memoize } from "lodash";

// Repurposed via magda's `getIndexFileContent.ts`
/**
 * Gets the base index html file.
 *
 * @param clientRoot The root of the client directory to get the file from.
 */
function getIndexHtml(resolvePathRelativeToWwwroot, clientRoot) {
  return fs.readFileSync(
      path.join(clientRoot, resolvePathRelativeToWwwroot),
      {
          encoding: "utf-8"
      }
  );
}
const memoizedGetIndexHtml = memoize(getIndexHtml);
const ROBOTS_METATAG_REGEX = new RegExp(
  /<meta name="robots"(.*)>$/,
  "g"
);
const parseIndexContent = (req, res, resolvePathRelativeToWwwroot, wwwrootPath) => {
  let indexHtmlContent = memoizedGetIndexHtml(resolvePathRelativeToWwwroot, wwwrootPath);
  if (res.locals.mainVhost === req.hostname) {
    // we have the main host, ensure we remove the meta tag
    indexHtmlContent = indexHtmlContent.replace(ROBOTS_METATAG_REGEX, "");
  }
  return indexHtmlContent;
};
// const getIndexContent = throttle(parseIndexContent, 60000);

module.exports = function(options, spaOptions) {
    if (!options || !spaOptions.resolveUnmatchedPathsWithIndexHtml) {
        return;
    }

    const resolvePathRelativeToWwwroot = spaOptions.resolvePathRelativeToWwwroot;

    // throw because a tjs-server user really intended to resolve unmatched paths, but we can't find the file to resolve
    if (!fs.existsSync(options.wwwroot + resolvePathRelativeToWwwroot)) {
      throw new Error("`resolveUnmatchedPathsWithIndexHtml` was true but path specified on `resolvePathRelativeToWwwroot` does not exist");
    }

    router.get('*', function (req, res, next) {
      const indexHtml = parseIndexContent(req, res, resolvePathRelativeToWwwroot, options.wwwroot);

      res.send(indexHtml);
    });
    if (options.verbose) {
        console.log('Resolving unmatched routes to index.html');
    }

    return router;
};
