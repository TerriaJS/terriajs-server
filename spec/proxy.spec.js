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

    describe('on get,', function() {
        doCommonTests('get');
    });

    describe('on post,', function() {
        doCommonTests('post');
    });

    function doCommonTests(verb) {
        it('should proxy through to the path that is is given', function(done) {
            request(buildApp({}))
                [verb]('/https://example.com/blah?query=value&otherQuery=otherValue')
                .expect(200)
                .expect(function() {
                    expect(nodeRequest[verb].calls.argsFor(0)[0].url).toBe('https://example.com/blah?query=value&otherQuery=otherValue');
                })
                .end(assert(done));
        });

        it('should add http if it isn\'t provided', function(done) {
            request(buildApp({}))
                [verb]('/example.com/')
                .expect(200)
                .expect(function(err) {
                    expect(nodeRequest[verb].calls.argsFor(0)[0].url).toBe('http://example.com/');
                })
                .end(assert(done));
        });

        it('should add a trailing slash if it isn\'t provided', function(done) {
            request(buildApp({}))
                [verb]('/example.com')
                .expect(200)
                .expect(function() {
                    expect(nodeRequest[verb].calls.argsFor(0)[0].url).toBe('http://example.com/');
                })
                .end(assert(done));
        });

        it('should return 400 if no url is specified', function(done) {
            request(buildApp({}))
                [verb]('/')
                .expect(400)
                .end(assert(done))
        });

        it('should overwrite cache-control header to two weeks if no max age is specified in req', function(done) {
            request(buildApp({}))
                [verb]('/example.com')
                .set('Cache-Control', 'no-cache')
                .expect(200)
                .expect('Cache-Control', 'public,max-age=1209600')
                .end(assert(done));
        });

        describe('when specifying max age', function() {
            describe('should return 400 for', function() {
                it('a max-age specifying url with no actual url specified', function(done) {
                    request(buildApp({}))
                        [verb]('/_3000ms')
                        .expect(400)
                        .end(assert(done));
                });

                it('a max-age specifying url with just \'/\' as a url', function(done) {
                    request(buildApp({}))
                        [verb]('/_3000ms/')
                        .expect(400)
                        .end(assert(done));
                });

                it('a max-age specifying url with an invalid max-age value', function(done) {
                    request(buildApp({}))
                        [verb]('/_FUBAR/example.com')
                        .expect(400)
                        .end(assert(done));
                });

                it('a max-age specifying url with an invalid unit for a max-age value', function(done) {
                    request(buildApp({}))
                        [verb]('/_3000q/example.com')
                        .expect(400)
                        .end(assert(done));
                });
            });

            describe('should correctly interpret', function() {
                it('ms (millisecond)', function(done) {
                    request(buildApp({}))
                        [verb]('/_3000ms/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=3')
                        .end(assert(done));
                });

                it('s (second)', function(done) {
                    request(buildApp({}))
                        [verb]('/_3s/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=3')
                        .end(assert(done));
                });

                it('m (minute)', function(done) {
                    request(buildApp({}))
                        [verb]('/_2m/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=120')
                        .end(assert(done));
                });

                it('h (hour)', function(done) {
                    request(buildApp({}))
                        [verb]('/_2h/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=7200')
                        .end(assert(done));
                });

                it('d (day)', function(done) {
                    request(buildApp({}))
                        [verb]('/_2d/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=172800')
                        .end(assert(done));
                });

                it('w (week)', function(done) {
                    request(buildApp({}))
                        [verb]('/_2w/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=1209600')
                        .end(assert(done));
                });

                it('y (year)', function(done) {
                    request(buildApp({}))
                        [verb]('/_2y/example.com')
                        .set('Cache-Control', 'no-cache')
                        .expect(200)
                        .expect('Cache-Control', 'public,max-age=63072000')
                        .end(assert(done));
                });
            });
        });

        describe('upstream proxy', function() {
            it('is used when one is specified', function(done) {
                request(buildApp({upstreamProxy: 'http://proxy/'}))
                    [verb]('/https://example.com/blah')
                    .expect(200)
                    .expect(function() {
                        expect(nodeRequest[verb].calls.argsFor(0)[0].proxy).toBe('http://proxy/');
                    })
                    .end(assert(done));
            });

            it('is not used when none is specified', function(done) {
                request(buildApp({}))
                    [verb]('/https://example.com/blah')
                    .expect(200)
                    .expect(function() {
                        expect(nodeRequest[verb].calls.argsFor(0)[0].proxy).toBeUndefined();
                    })
                    .end(assert(done));
            });

            it('is not used when host is in bypassUpstreamProxyHosts', function(done) {
                request(buildApp({
                    upstreamProxy: 'http://proxy/',
                    bypassUpstreamProxyHosts: {'example.com': true}
                }))[verb]('/https://example.com/blah')
                    .expect(200)
                    .expect(function() {
                        expect(nodeRequest[verb].calls.argsFor(0)[0].proxy).toBeUndefined();
                    })
                    .end(assert(done));
            });

            it('is still used when bypassUpstreamProxyHosts is defined but host is not in it', function(done) {
                request(buildApp({
                    upstreamProxy: 'http://proxy/',
                    bypassUpstreamProxyHosts: {'example2.com': true}
                }))[verb]('/https://example.com/blah')
                    .expect(200)
                    .expect(function() {
                        expect(nodeRequest[verb].calls.argsFor(0)[0].proxy).toBe('http://proxy/');
                    })
                    .end(assert(done));
            });
        });

        describe('when specifying an allowed list of domains to proxy', function() {
            it('should proxy a domain on that list', function(done) {
                request(buildApp({
                    proxyDomains: ['example.com']
                }))[verb]('/example.com/blah')
                    .expect(function() {
                        expect(nodeRequest[verb].calls.argsFor(0)[0].url).toBe('http://example.com/blah');
                    })
                    .expect(200)
                    .end(assert(done));
            });

            it('should block a domain on that list', function(done) {
                request(buildApp({
                    proxyDomains: ['example.com']
                }))[verb]('/example2.com/blah')
                    .expect(403)
                    .end(assert(done))
            });

            it('should not block a domain on the list if proxyAllDomains is true', function(done) {
                request(buildApp({
                    proxyDomains: ['example.com'],
                    proxyAllDomains: true
                }))[verb]('/example2.com/blah')
                    .expect(200)
                    .end(assert(done))
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

    function assert(done) {
        return function(err) {
            if (err) {
                fail(err);
            }
            done();
        }
    }
});