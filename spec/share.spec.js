"use strict";

const makeServer = require('../lib/makeserver');
const request = require('supertest');
const nock = require('nock');
const path = require('path');

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

describe('share endpoint (integration, real controller)', function() {
    const appOptions = {
        wwwroot: "./spec/mockwwwroot",
        hostName: "localhost",
        port: "3001",
        settings: {
            shareUrlPrefixes: {
                "g": {
                    "service": "gist",
                    "userAgent": "TerriaJS-Server",
                    "gistFilename": "terriajs-server-catalog.json",
                    "gistDescription": "TerriaJS Shared catalog"
                }
            },
            newShareUrlPrefix: "g",
            shareMaxRequestSize: "200kb"
        }
    };

    function buildApp() {
        const options = require('../lib/options').init(true);
        const mergedOptions = Object.assign(options, appOptions);
        return makeServer(mergedOptions);
    }

    beforeEach(() => {
        nock.cleanAll();
    });

    afterAll(() => {
        nock.restore();
    });

    describe('POST /share', function() {
        it('should return 201 and correct response for valid payload', function(done) {
            // Mock GitHub Gist API
            const fakeGistId = "123456";
            nock('https://api.github.com')
                .post('/gists')
                .reply(201, {
                    id: fakeGistId
                });

            const payload = { test: "me" };

            request(buildApp())
                .post('/share')
                .send(payload)
                .expect(201)
                .expect('Content-Type', /json/)
                .expect(res => {
                    const actualUrl = res.body.url;
                    const expectedPath = `/share/g-${fakeGistId}`;
                    expect(res.body.id).toBe(`g-${fakeGistId}`);
                    expect(res.body.path).toBe(expectedPath);
                    expect(actualUrl.endsWith(expectedPath)).toBeTrue();
                })
                .end(function(err) {
                    if (err) return done.fail(err);
                    done();
                });
        });

        it('should return 413 when payload exceeds shareMaxRequestSize', function(done) {
            const largePayload = 'a'.repeat(250000); // 250KB
            request(buildApp())
                .post('/share')
                .set('Content-Type', 'application/json')
                .send(`{"data":"${largePayload}"}`)
                .expect(413)
                .expect('Content-Type', /text|plain/)
                .expect(res => {
                    expect(
                        res.text.includes('Payload Too Large')
                    ).toBeTrue();
                })
                .end(function(err) {
                    if (err) return done.fail(err);
                    done();
                });
        });
    });
});
