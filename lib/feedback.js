/* jshint node: true */
'use strict';

var bodyParser = require('body-parser');
var router = require('express').Router();
var url = require('url');
var request = require('request');

module.exports = function(options) {
    if (!options || !options.issuesUrl || !options.accessToken) {
        return;
    }

    var parsedCreateIssueUrl = url.parse(options.issuesUrl, true);
    parsedCreateIssueUrl.query.access_token = options.accessToken;
    var createIssueUrl = url.format(parsedCreateIssueUrl);

    router.use(bodyParser.json());
    router.post('/', function(req, res, next) {
        var parameters = req.body;

        if (!parameters.title) {
            res.status(400).send('title is required');
        }

        request({
            url: createIssueUrl,
            method: 'POST',
            headers: {
                'User-Agent': 'TerriaBot (TerriaJS Feedback)',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                title: parameters.title,
                body: formatBody(req, parameters)
            })
        }, function(error, response, body) {
            console.log(response.statusCode);
            console.log(body);
            if (response.statusCode < 200 || response.statusCode >= 300) {
                res.status(response.statusCode).send('Feedback posting failed');
            } else {
                res.status(200).send('Feedback posted');
            }
        });

    });

    return router;
};

function formatBody(request, parameters) {
    var result = '';

    result += '* IP Address: ' + request.ip + '\n';
    result += '* Referrer: ' + request.header('Referrer') + '\n';
    result += '* Email Address: ' + (parameters.email ? parameters.email : 'Not provided') + '\n';
    result += '\n';
    result += parameters.body;

    return result;
}