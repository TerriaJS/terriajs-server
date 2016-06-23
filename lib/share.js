/* jshint node: true */
'use strict';

var bodyParser = require('body-parser');
var url = require('url');
var requestp = require('request-promise');
var rperrors = require('request-promise/errors');

var gistAPI = 'https://api.github.com/gists';
var googleUrlShortenerAPI = 'https://www.googleapis.com/urlshortener/v1';

var prefixSeparator = '-'; // change the regex below if you change this
var splitPrefixRe = /^(([^-]+)-)?(.*)$/;

//You can test like this with httpie:
//echo '{ "test": "me" }' | http post localhost:3001/share
function makeGist(serviceOptions, body, callback) {
    var gistFile = {};
    console.log(body);
    gistFile[serviceOptions.gistFilename || 'usercatalog.json'] = { content: body };

    return requestp({
        url: gistAPI,
        method: 'POST',
        headers: {
            'User-Agent': serviceOptions.userAgent || 'TerriaJS-Server',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': 'token ' + serviceOptions.accessToken
        },
        json: true,
        body: {
            files: gistFile,
            description: (serviceOptions.gistDescription || 'User-created catalog'),
            public: false
        }, transform: function(body, response) {
            return response.statusCode === 201 ? response.body.id : response;
        }
    });
}

// Test: http localhost:3001/share/g-98e01625db07a78d23b42c3dbe08fe20
function resolveGist(serviceOptions, id) {
    return requestp({
        url: gistAPI + '/' + id,
        headers: {            
            'User-Agent': serviceOptions.userAgent || 'TerriaJS-Server',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': 'token ' + serviceOptions.accessToken
        },
        json: true,
        transform: function(body, response) {
            if (response.statusCode >= 300) { 
                return response;
            } else {
                return body.files[Object.keys(body.files)[0]].content; // find the contents of the first file in the gist
            }
        }
    });
}

// Test: http localhost:3001/share/resolve/q3nxPd
function resolveGoogleUrl(serviceOptions, id) {
    var shortUrl = 'http://goo.gl/' + id;
    console.log(shortUrl);
    return requestp({
        url: googleUrlShortenerAPI + '/url?key=' + serviceOptions.apikey + '&shortUrl=' + shortUrl,
        headers: {            
            'User-Agent': serviceOptions.userAgent || 'TerriaJS-Server',
        },
        json: true,
        transform: function(body, response) {
            if (response.statusCode >= 300) { 
                return response;
            } else {
                // Our Google URLs look like "http://nationalmap.gov.au/#share=%7B...%7D" but there might be other URL parameters before or after
                // We just want the encoded JSON (%7B..%7D), not the whole URL.
                return decodeURIComponent(body.longUrl.match(/(%7B.*%7D)(&.*)$/)[1]);
            }
        }
    });
}

module.exports = function(shareUrlPrefixes, newShareUrlPrefix) {
    if (!shareUrlPrefixes) {
        return;
    }

    var router = require('express').Router();
    router.use(bodyParser.text({type: '*/*'}));
    
    // Requested creation of a new short URL.
    router.post('/', function(req, res, next) {
        if (newShareUrlPrefix === undefined || !shareUrlPrefixes[newShareUrlPrefix]) {
            return res.status(404).json({ message: "This server has not been configured to generate new share URLs." });
        }
        // we don't have any other URL minters implemented, so let's not overcomplicate.
        console.log('---' + JSON.stringify(req.body) + '---');
        makeGist(shareUrlPrefixes[newShareUrlPrefix], req.body).then(function(id) {
            id = newShareUrlPrefix + prefixSeparator + id;
            console.log('Created ID ' + id + ' using Gist service');
            res.json({ id: id, path: req.baseUrl + '/' + id });
        }).catch(rperrors.TransformError, function (reason) {
            console.error(JSON.stringify(reason, null, 2));
            res.status(500).json({ message: reason.cause.message });
        }).catch(function(reason) {
            console.warn(JSON.stringify(reason, null, 2));
            res.status(500) // probably safest if we always return a consistent error code
                .json({ message: reason.error }); 
        }); 
    });

    // Resolve an existing ID. We break off the prefix and use it to work out which resolver to use.
    router.get('/:id', function(req, res, next) {
        var prefix = req.params.id.match(splitPrefixRe)[2];
        var id = req.params.id.match(splitPrefixRe)[3];
        var resolver, serviceOptions = {};
        if (!prefix) {
            prefix = '';
        }

        if (!shareUrlPrefixes[prefix]) {
            console.error('Share: Unknown prefix to resolve "' + prefix + '", id "' + id + '"');
            return res.status(400).send('Unknown share prefix "' + prefix + '"');
        } else {
            serviceOptions = shareUrlPrefixes[prefix];
            resolver = {
                'gist': resolveGist,
                'googleurlshortener': resolveGoogleUrl
            }[serviceOptions.service.toLowerCase()];
        }
        resolver(serviceOptions, id).then(function(content) {
            res.send(content);
        }).catch(rperrors.TransformError, function (reason) {
            console.error(JSON.stringify(reason, null, 2));
            res.status(500).send(reason.cause.message);
        }).catch(function(reason) {
            console.warn(JSON.stringify(reason.response, null, 2));
            res.status(404) // probably safest if we always return 404 rather than whatever the upstream provider sets.
                .send(reason.error);
        }); 
    });
    return router;
};
