/* jshint node: true, esnext: true */
"use strict";
var router = require('express').Router();
var request = require('request');
var bodyParser = require('body-parser');
var url = require('url');

module.exports = function(options) {
    if (!options || !options.servers) {
        return;
    }

    // The maximum size of the JSON data.
    let postSizeLimit = options.postSizeLimit || '1024';

    let tokenServers = parseUrls(options.servers);

    router.use(bodyParser.json({limit:postSizeLimit, type:'application/json'}));
    router.post('/', function(req, res, next) {
        let parameters = req.body;

        if (!parameters.url || parameters.url.length === 0) {
            return res.status(400).send('No URL specified.');
        }

        let targetUrl = parseURL(parameters.url);
        if (!targetUrl || targetUrl.length === 0 && (typeof targetUrl === string)) {
            return res.status(400).send('Invalid URL specified.');
        }

        let tokenServer = tokenServers[targetUrl];
        if (!tokenServer) {
            return res.status(400).send('Unsupported URL specified.');
        }

        if (!tokenServer.username || !tokenServer.password || !tokenServer.tokenUrl) {
            console.error("Bad Configuration. " + targetUrl + " does not supply all of the required properties.");
            return res.status(400).send('Invalid server configuration.');
        }

        request({
            url: tokenServer.tokenUrl,
            method: 'POST',
            headers: {
                'User-Agent': 'TerriaJSESRITokenAuth',
            },
            form:{
                username: tokenServer.username,
                password: tokenServer.password,
                expiration: '1', // todo remove this, in place for developer testing.
                f: 'JSON'
            }
        }, function(error, response, body) {
            res.set('Content-Type', 'application/json');

            if (response.statusCode != 200) {
                return res.status(400).send('Token server failed.');
            } else {
                let value = JSON.parse(response.body);
                return res.status(200).send(JSON.stringify(value));
            }
        });
    });

    router.use(function(err, req, res, next) {
        console.error(err.stack);
        res.status(400).send('Unknown error.');
    });

    return router;
};

function parseUrls(servers) {
    let result = {};

    for(var server in servers) {
        // Note: We should really validate here that the URL is HTTPS to save us from ourselves,
        // but the current servers we need to support don't support HTTPS :(.
        result[parseURL(server)] = servers[server];
    }

    return result;
}

function parseURL(urlString) {
    return url.format(url.parse(urlString));
}
