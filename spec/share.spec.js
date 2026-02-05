"use strict";

import makeServer from "../lib/makeserver.js";
import supertestReq from "supertest";
import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import options from "../lib/options.js";

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

const localRequestHandler = http.all("*", ({ request }) => {
  if (request.url.includes("127.0.0.1")) {
    return passthrough();
  }
});

describe("share endpoint (integration, real controller)", function () {
  const server = setupServer(localRequestHandler);

  const appOptions = {
    wwwroot: "./spec/mockwwwroot",
    hostName: "localhost",
    port: "3001",
    settings: {
      shareUrlPrefixes: {
        g: {
          service: "gist",
          userAgent: "TerriaJS-Server",
          gistFilename: "terriajs-server-catalog.json",
          gistDescription: "TerriaJS Shared catalog"
        }
      },
      newShareUrlPrefix: "g",
      shareMaxRequestSize: "200kb"
    }
  };

  function buildApp() {
    const opts = options.init(true);
    const mergedOptions = Object.assign(opts, appOptions);
    return makeServer(mergedOptions);
  }

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe("POST /share", function () {
    it("should return 201 and correct response for valid payload", function (done) {
      // Mock GitHub Gist API
      const fakeGistId = "123456";
      server.use(
        http.post("https://api.github.com/gists", () => {
          return HttpResponse.json({ id: fakeGistId }, { status: 201 });
        })
      );

      const payload = { test: "me" };

      supertestReq(buildApp())
        .post("/share")
        .send(payload)
        .expect(201)
        .expect("Content-Type", /json/)
        .expect((res) => {
          const actualUrl = res.body.url;
          const expectedPath = `/share/g-${fakeGistId}`;
          expect(res.body.id).toBe(`g-${fakeGistId}`);
          expect(res.body.path).toBe(expectedPath);
          expect(actualUrl.endsWith(expectedPath)).toBeTrue();
        })
        .end(function (err) {
          if (err) return done.fail(err);
          done();
        });
    });

    it("should return 413 when payload exceeds shareMaxRequestSize", function (done) {
      const largePayload = "a".repeat(250000); // 250KB
      supertestReq(buildApp())
        .post("/share")
        .set("Content-Type", "application/json")
        .send(`{"data":"${largePayload}"}`)
        .expect(413)
        .expect("Content-Type", /text|plain/)
        .expect((res) => {
          expect(res.text.includes("Payload Too Large")).toBeTrue();
        })
        .end(function (err) {
          if (err) return done.fail(err);
          done();
        });
    });
  });
});
