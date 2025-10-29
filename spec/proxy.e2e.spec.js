var { http, HttpResponse, passthrough } = require("msw");
var { setupServer } = require("msw/node");
var request = require("supertest");

var makeServer = require("../lib/makeserver.js");
var { createServer } = require("./support/http-proxy-server.js");

const localRequestHandler = http.all("*", ({ request }) => {
  if (request.url.includes("127.0.0.1")) {
    return passthrough();
  }
});

const handlers = [
  localRequestHandler,

  http.all("https://example.com/redirect", () => {
    return HttpResponse.redirect("https://example.com/response");
  }),

  http.all("https://example.com/redirect2", () => {
    return HttpResponse.redirect("http://202.168.1.1/test");
  }),

  http.all("https://example.com/response", () => {
    return HttpResponse.json({ data: "response success" });
  }),

  http.all("http://example.com/response", () => {
    return HttpResponse.json({ data: "response success" });
  }),

  http.all("https://example.com/error", () => {
    return new HttpResponse(null, { status: 500 });
  }),

  http.all("https://example.com", ({ request }) => {
    if (request.headers.get("Proxy-Connection")) {
      throw new Error("Proxy-Connection header should not be passed");
    }

    return HttpResponse.json(
      { data: "response success root" },
      {
        headers: {
          fakeheader: "fakevalue",
          "Cache-Control": "no-cache",
          Connection: "delete me",
          "Content-Type": "application/json"
        }
      }
    );
  }),

  http.all("http://example.com", ({ request }) => {
    if (request.headers.get("Proxy-Connection")) {
      throw new Error("Proxy-Connection header should not be passed");
    }

    return HttpResponse.json(
      { data: "response success root" },
      {
        headers: {
          fakeheader: "fakevalue",
          "Cache-Control": "no-cache",
          Connection: "delete me",
          "Content-Type": "application/json"
        }
      }
    );
  }),

  http.all("http://example2.com", ({ request }) => {
    if (request.headers.get("Proxy-Connection")) {
      throw new Error("Proxy-Connection header should not be passed");
    }

    return HttpResponse.json(
      { data: "response success root" },
      {
        headers: {
          fakeheader: "fakevalue",
          "Cache-Control": "no-cache",
          Connection: "delete me",
          "Content-Type": "application/json"
        }
      }
    );
  })
];

async function buildApp(settings = {}, proxyAuth = {}) {
  const app = makeServer({ settings, proxyAuth });

  return { app };
}

fdescribe("Proxy (e2e)", () => {
  describe("/ (GET)", () => {
    doCommonTest("get");
  });

  describe("/ (POST)", () => {
    doCommonTest("post");

    describe("POST body handling", () => {
      beforeAll(async () => {
        server = setupServer(
          ...[
            localRequestHandler,
            http.post(
              "https://example.com/post-body-test",
              async ({ request }) => {
                const requestBody = await request.json();
                if (requestBody && requestBody.message === "hello proxy") {
                  return HttpResponse.json({
                    success: true,
                    receivedBody: requestBody
                  });
                }
                return HttpResponse.json(
                  { success: false, error: "Incorrect body received" },
                  { status: 400 }
                );
              }
            )
          ]
        );

        ({ app } = await buildApp({
          proxyAllDomains: true, // Allow proxying to example.com
          postSizeLimit: 1024 * 1024, // Set a specific limit for the size test
          blacklistedAddresses: ["202.168.1.1"] // Keep existing relevant config
        })); // Build the app with this config

        server.listen({
          onUnhandledRequest: "error"
        });
      });

      afterAll(async () => {
        server.close();
      });

      it("should correctly proxy the POST request body", async () => {
        const url = "https://example.com/post-body-test";
        const postBody = { message: "hello proxy" };

        await request(app)
          .post(`/proxy/${url}`)
          .send(postBody)
          .expect(200, { success: true, receivedBody: postBody });
      });

      it("should return 413 if POST body is larger than postSizeLimit (e.g., 1MB)", async () => {
        const url = "https://example.com/post-body-test"; // Target URL doesn't strictly matter as NestJS should reject first
        // Create a body larger than 1MB. A char is 1 byte, 1MB = 1024 * 1024 bytes.
        const largePostBody = { message: "a".repeat(1024 * 1024 + 1) }; // Slightly over 1MB

        await request(app)
          .post(`/proxy/${url}`)
          .send(largePostBody)
          .expect(413); // Payload Too Large
      });
    });
  });
});

function doCommonTest(methodName) {
  describe("default config", () => {
    let app;
    const server = setupServer(...handlers);

    beforeAll(async () => {
      ({ app } = await buildApp());
    });

    it("should not allow proxy by default", () => {
      return request(app)[methodName]("/proxy/example.com").expect(403);
    });

    afterAll(async () => {
      server.close();
    });
  });

  describe("simple config", () => {
    let app;
    const server = setupServer(...handlers);

    beforeAll(async () => {
      ({ app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      }));

      server.listen({
        onUnhandledRequest: "error"
      });
    });

    it("should proxy through to the path that is given", async () => {
      const url = "https://example.com/response";

      await request(app)
        [methodName](`/proxy/${url}`)
        .expect(200, { data: "response success" });
    });

    it("should add protocol if it isn't provided", async () => {
      const url = "example.com/response";
      await request(app)
        [methodName](`/proxy/${url}`)
        .expect(200, { data: "response success" });
    });

    it("should proxy to just domain", async () => {
      const url = "example.com";

      await request(app)
        [methodName](`/proxy/${url}`)
        .expect(200, { data: "response success root" });
    });

    it("should return 400 if no url is specified", async () => {
      await request(app)[methodName]("/proxy/").expect(400);
    });

    it("should return 400 if invalid url is specified", async () => {
      // TODO: change to 400
      await request(app)[methodName]("/proxy/test").expect(500);
    });

    it("should stream back the body and headers of the request made", async () => {
      await request(app)
        [methodName]("/proxy/https://example.com")
        .expect(200, { data: "response success root" })
        .expect("fakeheader", "fakevalue");
    });

    describe("should change headers", () => {
      it("to overwrite cache-control header to two weeks if no max age is specified in req", () => {
        return request(app)
          [methodName]("/proxy/example.com")
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");
      });

      it("to filter out disallowed ones passed in req", async () => {
        await request(app)
          [methodName]("/proxy/example.com")
          .set("Proxy-Connection", "delete me!")
          .set("unfilteredheader", "don't delete me!")
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");
      });

      it("to filter out disallowed ones that come back from the response", async () => {
        const response = await request(app)
          [methodName]("/proxy/example.com")
          .expect(200, { data: "response success root" })
          .expect("Cache-Control", "public,max-age=1209600");

        expect(response.headers.Connection).not.toBeDefined();
      });

      it("should not set max age on error response", async () => {
        await request(app)
          [methodName]("/proxy/https://example.com/error")
          .expect(500);
      });
    });

    describe("when specifying max age", () => {
      describe("should return 400 for", () => {
        it("a max-age specifying url with no actual url specified", async () => {
          await request(app)[methodName]("/proxy/_3000ms").expect(400);
        });

        it("a max-age specifying url with just '/' as a url", async () => {
          await request(app)[methodName]("/proxy/_3000ms/").expect(400);
        });

        it("a max-age specifying url with invalid max age value", async () => {
          await request(app)
            [methodName]("/proxy/_FUBAR/example.com")
            .expect(400);
        });

        it("a max-age specifying url with an invalid unit for a max-age value", async () => {
          await request(app)
            [methodName]("/proxy/_3000q/example.com")
            .expect(400);
        });
      });

      describe("should properly interpret max age", () => {
        it("ms (millisecond)", async () => {
          await request(app)
            [methodName]("/proxy/_3000ms/example.com")
            .expect(200)
            .expect("Cache-Control", "public,max-age=3");
        });

        it("s (second)", async () => {
          await request(app)
            [methodName]("/proxy/_3s/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=3");
        });

        it("m (minute)", async () => {
          await request(app)
            [methodName]("/proxy/_2m/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=120");
        });

        it("h (hour)", async () => {
          await request(app)
            [methodName]("/proxy/_2h/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=7200");
        });

        it("d (day)", async () => {
          await request(app)
            [methodName]("/proxy/_2d/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=172800");
        });

        it("w (week)", async () => {
          await request(app)
            [methodName]("/proxy/_2w/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=1209600");
        });

        it("y (year)", async () => {
          await request(app)
            [methodName]("/proxy/_2y/example.com")
            .set("Cache-Control", "no-cache")
            .expect(200)
            .expect("Cache-Control", "public,max-age=63072000");
        });
      });
    });

    afterAll(async () => {
      server.close();
    });
  });

  xdescribe("with an upstream proxy", () => {
    let PROXY_PORT = 25000;
    let RESPONSE = 200;
    if (methodName === "post") {
      PROXY_PORT = 25001;
      RESPONSE = 201;
    }
    it("should proxy through upstream proxy", async () => {
      const connectSpy = jasmine.createSpy("connectSpy");

      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });
      const { close: closeProxyServer } = createServer(PROXY_PORT, connectSpy);
      const appHttpServer = app.listen(0);

      await request(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/api/test`)
        .expect(RESPONSE);
      expect(connectSpy).toHaveBeenCalledTimes(1);

      closeProxyServer();
      await appHttpServer.close();
    });

    it("is not used when host is in bypassUpstreamProxyHosts", async () => {
      const connectSpy = jasmine.createSpy("connectSpy");

      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        bypassUpstreamProxyHosts: { "127.0.0.1:64900": true },
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });
      const { close: closeProxyServer } = createServer(PROXY_PORT, connectSpy);
      const appHttpServer = app.listen(64900);

      await request(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/api/test`)
        .expect(RESPONSE);
      expect(connectSpy).not.toHaveBeenCalled();

      closeProxyServer();
    });

    it("is still used when bypassUpstreamProxyHosts is defined but host is not in it (HTTP target)", async () => {
      const connectSpy = jasmine.createSpy("connectSpy");

      const { app } = await buildApp({
        upstreamProxy: `http://127.0.0.1:${PROXY_PORT}`,
        bypassUpstreamProxyHosts: ["example2.com"],
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });
      const { close: closeProxyServer } = createServer(PROXY_PORT, connectSpy);
      const appHttpServer = app.listen(64900, "127.0.0.1");

      await request(app)
        [
          methodName
        ](`/proxy/http://127.0.0.1:${appHttpServer.address().port}/api/test`)
        .expect(RESPONSE);
      expect(connectSpy).toHaveBeenCalledTimes(1);

      closeProxyServer();
      appHttpServer.close();
    });
  });

  describe("when specifying an allowed list of domains to proxy", function () {
    const server = setupServer(...handlers);

    beforeAll(() => {
      server.listen({
        onUnhandledRequest: "error"
      });
    });

    it("should proxy a domain on that list", async () => {
      const { app } = await buildApp({
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await request(app)
        [methodName]("/proxy/example.com/response")
        .expect(200, { data: "response success" });
    });

    it("should block a domain not on that list", async () => {
      const { app } = await buildApp({
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await request(app)[methodName]("/proxy/example2.com/blah").expect(403);
    });

    it("should not block a domain on the list if proxyAllDomains is true", async () => {
      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"]
      });

      await request(app)[methodName]("/proxy/example2.com").expect(200);
    });

    afterAll(() => {
      server.close();
    });
  });

  describe("when domain has basic authentication specified", function () {
    let server;
    beforeEach(() => {
      server = setupServer(localRequestHandler);

      server.listen({
        onUnhandledRequest: "error"
      });
    });

    afterEach(() => {
      server.close();
    });

    it("should set an auth header for that domain", async () => {
      server.use(
        http.all("https://example.com/auth", ({ request }) => {
          if (request.headers.get("Authorization") !== "blahfaceauth") {
            return HttpResponse.error();
          }

          return HttpResponse.json({ data: "response success" });
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          allowProxyFor: ["example.com"],
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": {
            authorization: "blahfaceauth"
          }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth")
        .expect(200, { data: "response success" });
    });

    it("should not set auth headers for other domains", async () => {
      server.use(
        http.all("https://example.com/auth", ({ request }) => {
          if (request.headers.get("authorization")) {
            return new HttpResponse(null, { status: 500 });
          }

          return HttpResponse.json({ data: "response success" });
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example2.com": {
            authorization: "blahfaceauth"
          }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth")
        .expect(200, { data: "response success" });
    });

    it("should set other headers for that domain", async () => {
      server.use(
        http.all("https://example.com/auth", ({ request }) => {
          if (
            !request.headers.get("authorization") ||
            request.headers.get("X-Test-Header") !== "testvalue"
          ) {
            return new HttpResponse(null, { status: 500 });
          }

          return HttpResponse.json({ data: "properly set header and auth" });
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          allowProxyFor: ["example.com"],
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": {
            authorization: "blahfaceauth",
            headers: [{ name: "X-Test-Header", value: "testvalue" }]
          }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth")
        .expect(200, { data: "properly set header and auth" });
    });

    it("should retry without auth header if auth fails (Proxy Auth -> No Auth success)", async () => {
      server.use(
        http.all("https://example.com/auth-retry1", ({ request }) => {
          if (request.headers.get("Authorization") === "proxyDefAuthFails") {
            return new HttpResponse(null, { status: 403 });
          }
          if (!request.headers.get("Authorization")) {
            return HttpResponse.json({ data: "success without auth" });
          }
          return HttpResponse.error();
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": {
            authorization: "proxyDefAuthFails"
          }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth-retry1")
        .expect(200, { data: "success without auth" });
    });

    it("should retry with proxy auth when fails with user supplied auth (User Auth -> Proxy Auth -> No Auth all fail)", async () => {
      server.use(
        http.all("https://example.com/auth", ({ request }) => {
          if (request.headers.get("Authorization") === "testUserAuth") {
            new HttpResponse(null, {
              status: 403,
              statusText: "Forbidden 1"
            });
          }

          if (request.headers.get("Authorization") === "blahfaceauth") {
            new HttpResponse(null, {
              status: 403,
              statusText: "Forbidden 2"
            });
          }

          return new HttpResponse(null, {
            status: 403,
            statusText: "Forbidden 3"
          });
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          allowProxyFor: ["example.com"],
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": {
            authorization: "blahfaceauth"
          }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth")
        .set("Authorization", "testUserAuth")
        .expect(403, {
          statusCode: 403,
          message: "Forbidden 3"
        });
    });

    it("User Auth (fails) -> Proxy Auth (succeeds)", async () => {
      server.use(
        http.all("https://example.com/auth-path", ({ request }) => {
          const authHeader = request.headers.get("Authorization");
          if (authHeader === "userSentWrongAuth") {
            return new HttpResponse(null, {
              status: 403,
              statusText: "User Auth Failed"
            });
          }
          if (authHeader === "proxyCorrectAuth") {
            return HttpResponse.json({ data: "success with proxy auth" });
          }
          return new HttpResponse(null, {
            status: 500,
            statusText: "Test Misconfigured"
          });
        })
      );
      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": { authorization: "proxyCorrectAuth" }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth-path")
        .set("Authorization", "userSentWrongAuth")
        .expect(200, { data: "success with proxy auth" });
    });

    it("User Auth (fails) -> No Proxy Auth defined -> No Auth (succeeds)", async () => {
      server.use(
        http.all("https://example.com/auth-path2", ({ request }) => {
          const authHeader = request.headers.get("Authorization");
          if (authHeader === "userSentWrongAuthAgain") {
            return new HttpResponse(null, {
              status: 403,
              statusText: "User Auth Failed Again"
            });
          }
          if (!authHeader) {
            // Expecting retry with no auth
            return HttpResponse.json({ data: "success with no auth retry" });
          }
          return new HttpResponse(null, {
            status: 500,
            statusText: "Test Misconfigured"
          });
        })
      );

      const { app } = await buildApp(
        {
          blacklistedAddresses: ["202.168.1.1"],
          proxyAllDomains: true
        },
        {
          // No proxyAuth defined for example.com
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth-path2")
        .set("Authorization", "userSentWrongAuthAgain")
        .expect(200, { data: "success with no auth retry" });
    });

    it("Proxy Auth (fails) -> No Auth (fails)", async () => {
      server.use(
        http.all("https://example.com/auth-path3", ({ request }) => {
          const authHeader = request.headers.get("Authorization");
          if (authHeader === "proxyAuthWillFail") {
            return new HttpResponse(null, {
              status: 403,
              statusText: "Proxy Auth Failed As Expected"
            });
          }
          if (!authHeader) {
            // Retry with no auth
            return new HttpResponse(null, {
              status: 403,
              statusText: "No Auth Also Failed"
            });
          }
          return new HttpResponse(null, {
            status: 500,
            statusText: "Test Misconfigured"
          });
        })
      );

      const { app } = await buildApp(
        {
          proxyAllDomains: true,
          blacklistedAddresses: ["202.168.1.1"]
        },
        {
          "example.com": { authorization: "proxyAuthWillFail" }
        }
      );

      await request(app)
        [methodName]("/proxy/https://example.com/auth-path3")
        // No client auth sent, so proxy will use its configured 'proxyAuthWillFail'
        .expect(403, { statusCode: 403, message: "No Auth Also Failed" });
    });

    it("No User Auth, No Proxy Auth defined -> First No Auth attempt (fails) -> Final 403 (no retry)", async () => {
      let attempt = 0;
      server.use(
        http.all("https://example.com/auth-path4", ({ request }) => {
          const authHeader = request.headers.get("Authorization");
          attempt += 1;
          if (!authHeader && attempt === 1) {
            // Expecting first attempt with no auth
            return new HttpResponse(null, {
              status: 403,
              statusText: "Initial No Auth Failed"
            });
          }
          // This part should ideally not be reached if calculateDelay works as expected
          return new HttpResponse(null, {
            status: 500,
            statusText: "Test Misconfigured - Retry Occurred Unexpectedly"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      });

      await request(app)
        [methodName]("/proxy/https://example.com/auth-path4")
        // No client auth, no proxy auth defined
        .expect(403, { statusCode: 403, message: "Initial No Auth Failed" });
    });
  });

  describe("append query params", function () {
    let server;
    beforeEach(() => {
      server = setupServer(localRequestHandler);

      server.listen({
        onUnhandledRequest: "error"
      });
    });

    afterEach(() => {
      server.close();
    });
    it("append params to the querystring for a specified domain", async () => {
      server.use(
        http.all("https://example.com", ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("foo") !== "bar") {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have set search params foo=bar"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com")
        .expect(200, { data: "have set search params foo=bar" });
    });

    it("append params to the querystring for a specified domain using specified regex", async () => {
      server.use(
        http.all("https://example.com/something/else", ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("foo") !== "bar") {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have set search params foo=bar"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/something/else")
        .expect(200, { data: "have set search params foo=bar" });
    });

    it('should not append params when path "/nothing/else" does not match regexPattern "something"', async () => {
      server.use(
        http.all("https://example.com/nothing/else", ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("foo")) {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have not set search params foo=bar"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/nothing/else")
        .expect(200, { data: "have not set search params foo=bar" });
    });

    it('should append "yep=works" (from "nothing" regex) and not "foo=bar" (from "something" regex) for path "/nothing/else"', async () => {
      server.use(
        http.all("https://example.com/nothing/else", ({ request }) => {
          const url = new URL(request.url);
          if (
            url.searchParams.get("foo") ||
            url.searchParams.get("yep") !== "works"
          ) {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have set search params yep=works"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: "something",
              params: {
                foo: "bar"
              }
            },
            {
              regexPattern: "nothing",
              params: {
                yep: "works"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/nothing/else")
        .expect(200, { data: "have set search params yep=works" });
    });

    it('should append multiple params "foo=bar" and "another=val" when regexPattern "." matches path "/nothing/else"', async () => {
      server.use(
        http.all("https://example.com/nothing/else", ({ request }) => {
          const url = new URL(request.url);
          if (
            url.searchParams.get("foo") !== "bar" ||
            url.searchParams.get("another") !== "val"
          ) {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have set search params foo=bar and another=val"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: ".",
              params: {
                foo: "bar",
                another: "val"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/nothing/else")
        .expect(200, {
          data: "have set search params foo=bar and another=val"
        });
    });

    it('should append "foo=bar" and preserve existing "already=here" when regexPattern "." matches path "/something"', async () => {
      server.use(
        http.all("https://example.com/something", ({ request }) => {
          const url = new URL(request.url);
          if (
            url.searchParams.get("foo") !== "bar" ||
            url.searchParams.get("already") !== "here"
          ) {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "have extended search params with foo=bar"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example.com": [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/something?already=here")
        .expect(200, {
          data: "have extended search params with foo=bar"
        });
    });

    it('should not append "foo=bar" for "example.com" when config is for "example2.com", preserving existing "already=here"', async () => {
      server.use(
        http.all("https://example.com/something", ({ request }) => {
          const url = new URL(request.url);
          if (
            url.searchParams.get("foo") ||
            url.searchParams.get("already") !== "here"
          ) {
            return HttpResponse.error();
          }

          return HttpResponse.json({
            data: "haven\t set search params"
          });
        })
      );

      const { app } = await buildApp({
        proxyAllDomains: true,
        allowProxyFor: ["example.com"],
        blacklistedAddresses: ["202.168.1.1"],
        appendParamToQueryString: {
          "example2.com": [
            {
              regexPattern: ".",
              params: {
                foo: "bar"
              }
            }
          ]
        }
      });

      await request(app)
        [methodName]("/proxy/https://example.com/something?already=here")
        .expect(200, {
          data: "haven\t set search params"
        });
    });
  });

  describe("redirects", () => {
    let app;
    let server;

    beforeAll(async () => {
      server = setupServer(...handlers);

      ({ app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["202.168.1.1"]
      }));

      server.listen({
        onUnhandledRequest: "error"
      });
    });

    it("should follow redirect", async () => {
      const url = "https://example.com/redirect";
      await request(app)[methodName](`/proxy/${url}`).expect(200);
    });

    xit("should block redirect to blacklisted host", async () => {
      const url = "https://example.com/redirect2";

      await request(app)[methodName](`/proxy/${url}`).expect(403, {
        statusCode: 403,
        error: "Forbidden",
        message: "Host is not in list of allowed hosts: 202.168.1.1"
      });
    });

    afterAll(async () => {
      server.close();
    });
  });

  describe("should block socket connection on blacklisted host", () => {
    let app;
    let server;

    beforeAll(async () => {
      server = setupServer(...handlers);
      ({ app } = await buildApp({
        proxyAllDomains: true,
        blacklistedAddresses: ["127.0.0.1"]
      }));

      server.listen({
        onUnhandledRequest: "error"
      });
    });

    it("should block connection to restricted ip address", async () => {
      const url = "https://127.0.0.1";

      await request(app)[methodName](`/proxy/${url}`).expect(403);
    });

    afterAll(() => {
      server.close();
    });
  });
}
