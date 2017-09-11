/* jshint node: true, esnext: true */
"use strict";
var express = require('express');

// Expose a whitelisted set of configuration attributes to the world. This definitely doesn't include authorisation tokens, local file paths, etc.
// It mirrors the structure of the real config file.
module.exports = function(options) {
    var router = express.Router();
    var settings = Object.assign({}, options.settings), safeSettings = {};
    var safeAttributes = ['allowProxyFor', 'maxConversionSize', 'newShareUrlPrefix', 'proxyAllDomains'];
    safeAttributes.forEach(key => safeSettings[key] = settings[key]);
    safeSettings.version = require('../../package.json').version;
    if (typeof settings.shareUrlPrefixes === 'object') {
        safeSettings.shareUrlPrefixes = {};
        Object.keys(settings.shareUrlPrefixes).forEach(function(key) {
            safeSettings.shareUrlPrefixes[key] = { service: settings.shareUrlPrefixes[key].service };
        });
    }

    router.post('/', function(req, res, next) {
        res.status(200).send(safeSettings);


        var parameters = req.body;

                request({
                    url: 'http://services.ga.gov.au/site_13/rest/services/PSMA_Land_Tenure_Boundaries_ACT_Secure/MapServer',
                    method: 'POST',
                    headers: {
                        'User-Agent': options.userAgent || 'TerriaESRITokenAuth',
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    body: JSON.stringify({
                        title: parameters.title ? parameters.title : 'User Feedback',
                        body: formatBody(req, parameters)
                    })
                }, function(error, response, body) {
                    res.set('Content-Type', 'application/json');
                    if (response.statusCode < 200 || response.statusCode >= 300) {
                        res.status(response.statusCode).send(JSON.stringify({result: 'FAILED'}));
                    } else {
                        res.status(200).send(JSON.stringify({result: 'SUCCESS'}));
                    }
                });
    });
    return router;
};