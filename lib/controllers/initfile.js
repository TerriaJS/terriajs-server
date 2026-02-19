import express from "express";
import path from "node:path";
const router = express.Router();
/**
 * Special handling for /init/foo.json requests: look in initPaths, not just wwwroot/init
 * @param  {string[]} initPaths      Paths to look in, can be relative.
 * @param  {function} error404       Error page handler.
 * @param  {string} configFileBase   Directory to resolve relative paths from.
 * @returns {Router}
 */
export default function (initPaths, _error404, configFileBase) {
  initPaths.forEach((initPath) => {
    router.use(express.static(path.resolve(configFileBase, initPath)));
  });
  return router;
}
