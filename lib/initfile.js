/* jshint node: true */
'use strict';
var router = require('express').Router();
var exists = require('./exists');
var path = require('path');
var errorPage = require('./errorpage');
module.exports = function(initPaths, error404) {

    router.get('/:filename.json', function(req, res, next) {
        var initFile;
        console.log('!!!');
        initPaths.some(function(pathname) {
            initFile = path.join(pathname, req.params.filename + '.json');
            console.log('Try ' + initFile);
            if (exists(initFile)) {
                console.log('200 ' + initFile);
                res.status(200).sendFile(path.resolve(initFile) );        
                return true;
            }
        });
        error404(req, res, next);
    });
    return router;
};