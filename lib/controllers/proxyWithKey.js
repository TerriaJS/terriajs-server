/* jshint node: true */
'use strict';
var router = require('express').Router();
var proxy = require('./proxy');

module.exports = function(proxyOptions) {

    router.get('/:keyType/*', function(req, res, next) {
        var keyType = req.params.keyType;
        if (req.search === undefined) {
            req.url += '?key=natmapkey';
        } else {
            req.url += '&key=natmapkey';
        }
        proxy(proxyOptions).handler('get')(req, res, next);
    });

    return router;
};