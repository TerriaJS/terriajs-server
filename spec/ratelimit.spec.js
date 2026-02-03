"use strict";

const makeserver = require("../lib/makeserver");
const supertestReq = require("supertest");

/**
 * Specs for rate limiting when basic auth is enabled
 */
describe("server rate limiting", function () {
  function makeRequest(app, url, auth) {
    return new Promise((resolve, reject) => {
      const req = supertestReq(app).get(url);
      if (auth) {
        req.auth(auth.username, auth.password);
      }
      req.end((err, res) => resolve({ err, res }));
    });
  }

  describe("with basic auth NOT configured", function () {
    it("does not rate limit requests", async function () {
      const app = makeserver({ pingauth: true, settings: {} });

      for (let attempt = 0; attempt < 10; attempt++) {
        const { err, res } = await makeRequest(app, "/pingauth");
        if (err || res.status !== 200) {
          throw new Error(`Unexpected error ${res?.status}`);
        }
      }
    });
  });

  describe("with basic auth configured", function () {
    it("does not rate limit requests when auth succeeds", async function () {
      const rateLimit = {
        freeRetries: 4,
        minWait: 2000,
        maxWait: 60000
      };

      const app = makeserver({
        pingauth: true,
        settings: {
          basicAuthentication: {
            username: "foo",
            password: "bar"
          },
          rateLimit
        }
      });

      for (let attempt = 0; attempt < 10; attempt++) {
        const { res } = await makeRequest(app, "/pingauth", {
          username: "foo",
          password: "bar"
        });
        if (res.status !== 200) {
          throw new Error(`Unexpected error ${res.status}`);
        }
      }
    });

    it("rate limit requests when auth fails", async function () {
      const rateLimit = {
        freeRetries: 4,
        minWait: 2000,
        maxWait: 60000
      };

      const app = makeserver({
        pingauth: true,
        settings: {
          basicAuthentication: {
            username: "foo",
            password: "bar"
          },
          rateLimit
        }
      });

      for (let attempt = 0; attempt < 10; attempt++) {
        const { res } = await makeRequest(app, "/pingauth");
        if (attempt < rateLimit.freeRetries) {
          if (res.status !== 401) {
            throw new Error(
              `Expected only HTTP 401 error before free retries finish`
            );
          }
        } else {
          if (res.status !== 429) {
            throw new Error(
              `Expected only HTTP 429 error after free retries finish`
            );
          }
        }
      }
    });
  });
});
