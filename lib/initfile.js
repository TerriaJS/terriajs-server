/* jshint node: true */
'use strict';
var router = require('express').Router();
var exists = require('./exists');
var path = require('path');
module.exports = function(initPaths, error404, configFileBase) {

    router.get('/:filename.json', function(req, res, next) {
        var initFile;
        console.log('!!!');
        initPaths.some(function(pathname) {
            initFile = path.resolve(configFileBase, pathname, req.params.filename + '.json');
            if (exists(initFile)) {
                console.log('200 ' + initFile);
                res.status(200).sendFile(initFile);        
                return true;
            }
            console.log('Not found in  ' + initFile);
        });
        error404(req, res, next);
    });
    return router;
};