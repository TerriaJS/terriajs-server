/* jshint node: true */
'use strict';
var router = require('express').Router();
var exists = require('./exists');
var path = require('path');
/**
 * Special handling for /init/foo.json requests: look in initPaths, not just wwwroot/init
 * @param  {String[]} initPaths      Paths to look in, can be relative.
 * @param  {function} error404       Error page handler.
 * @param  {String} configFileBase   Directory to resolve relative paths from.
 * @return {Router} 
 */
module.exports = function(initPaths, error404, configFileBase) {
    router.get('/:filename.json', function(req, res, next) {
        var initFilename = req.params.filename + '.json';
        var initFile;
        if (!initPaths.some(function(pathname) {
            initFile = path.resolve(configFileBase, pathname, initFilename);
            if (exists(initFile)) {
                //console.log('200 ' + initFile);
                res.status(200).sendFile(initFile);        
                return true;
            }
        })) {
            error404(req, res, next);
            //console.log('404 Couldn\'t find any ' + initFilename + ' in ' + configFileBase + ' + ' + JSON.stringify(initPaths));
        }
    });
    return router;
};