/* jshint node: true */
'use strict';
var router = require('express').Router();
var proxy = require('./proxy');

module.exports = function(proxyOptions, keys) {

    router.get('/:keyType/*', function(req, res, next) {
        var keyType = req.params.keyType;
        var keyObjects = keys[keyType];
        if (keyObjects === undefined || keyType === undefined) {
            res.status(404).send('Unknown key type ' + keyType);
            return;
        }
        var paramsString = keyObjects.map(keyObject => (keyObject.key + '=' + keyObject.value)).join('&');
        var joiner = (req.url.indexOf('?') >= 0) ? '&' : '?';
        req.url += joiner + paramsString;
        proxy(proxyOptions).handler('get')(req, res, next);
    });

    return router;
};