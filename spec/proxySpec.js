"use strict";

var express = require('express');
var proxy = require('../lib/proxy');
var request = require('supertest');
var nodeRequest = require('request');
var Stream = require('stream').Writable;

describe('proxy', function() {
    beforeEach(function() {
        spyOn(nodeRequest, 'get').and.callFake(requestFake);
        spyOn(nodeRequest, 'post').and.callFake(requestFake);
    });

    describe('on get', function() {
        doCommonTests('get');
    });

    describe('on post', function() {
       doCommonTests('post');
    });

    function doCommonTests(verb) {
        it('should proxy through to the path that is is given', function(done) {
            request(buildApp({}))
                [verb]('/http://example.com')
                .expect(200)
                .end(function() {
                    expect(nodeRequest[verb]).toHaveBeenCalled();
                    expect(nodeRequest[verb].calls.argsFor(0)[0].url).toBe('http://example.com/');
                    done();
                });
        });
    }

    function requestFake(params, cb) {
        cb(null, {
            statusCode: 200,
            headers: []
        }, '');
        return new Stream();
    }

    function buildApp(options) {
        var app = express();
        app.use(proxy(options));
        app.use(function(err, req, res, next) {
            console.error(err.stack);
            res.status(500).send('Something broke!');
        });
        return app;
    }
});