import fs from "node:fs";
import supertestReq from "supertest";
import singlePageRouting from "../lib/controllers/single-page-routing.js";
import makeServer from "../lib/makeserver.js";
import options from "../lib/options.js";

jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

describe("single-page-routing", function () {
  const appOptions = {
    wwwroot: "./spec/mockwwwroot"
  };
  const badAppOptions = {
    wwwroot: "./spec/nonexistentwwwroot"
  };

  const routingOffOptions = {
    resolveUnmatchedPathsWithIndexHtml: false
  };

  const routingOnOptions = {
    resolvePathRelativeToWwwroot: "/index.html",
    resolveUnmatchedPathsWithIndexHtml: true
  };

  describe("using controller", function () {
    const errorMatcher = (error) => {
      if (
        error.message.indexOf("`resolvePathRelativeToWwwroot` does not exist")
      ) {
        return true;
      }
    };
    describe("should throw", function () {
      it("with bad wwwroot", function () {
        expect(() => {
          const serverOptions = {
            ...badAppOptions,
            settings: {
              singlePageRouting: {
                ...routingOnOptions
              }
            }
          };
          singlePageRouting(serverOptions, routingOnOptions);
        }).toThrow();
      });
      it("with good wwwroot, specifying invalid path", function () {
        expect(() => {
          const serverOptions = {
            ...badAppOptions,
            settings: {
              singlePageRouting: {
                resolvePathRelativeToWwwroot: "/does-not-exist.html",
                resolveUnmatchedPathsWithIndexHtml: true
              }
            }
          };
          singlePageRouting(serverOptions, routingOnOptions);
        }).toThrowMatching(errorMatcher);
      });
    });
    describe("should not throw", function () {
      it("with good wwwroot and routing off", function () {
        expect(() => {
          const serverOptions = {
            ...appOptions,
            settings: {
              singlePageRouting: {
                ...routingOffOptions
              }
            }
          };
          singlePageRouting(serverOptions, routingOffOptions);
        }).not.toThrow();
      });
      it("with good wwwroot", function () {
        expect(() => {
          const serverOptions = {
            ...appOptions,
            settings: {
              singlePageRouting: {
                ...routingOnOptions
              }
            }
          };
          singlePageRouting(serverOptions, routingOnOptions);
        }).not.toThrow();
      });
    });
  });

  describe("on get with routing off,", function () {
    it("should 404 blah route", function (done) {
      supertestReq(buildApp(routingOffOptions))
        .get("/blah")
        .expect(404)
        .end(assert(done));
    });
    it("should resolve an actual html file", function () {
      supertestReq(buildApp(routingOffOptions))
        .get("/actual-html-file.html")
        .expect(200)
        .expect("Content-Type", /html/)
        .then((response) => {
          expect(response.text).toBe(
            fs.readFileSync(
              appOptions.wwwroot + "/actual-html-file.html",
              "utf8"
            )
          );
        });
    });
    it("should resolve an actual json file", function () {
      supertestReq(buildApp(routingOffOptions))
        .get("/actual-json.json")
        .expect(200)
        .expect("Content-Type", /json/)
        .then((response) => {
          expect(response.text).toBe(
            fs.readFileSync(appOptions.wwwroot + "/actual-json.json", "utf8")
          );
        });
    });
  });

  describe("on get with routing on,", function () {
    it("should resolve unmatched route with the optioned path", function () {
      supertestReq(buildApp(routingOnOptions))
        .get("/blah")
        .expect(200)
        .expect("Content-Type", /html/)
        .then((response) => {
          expect(response.text).toBe(
            fs.readFileSync(
              appOptions.wwwroot +
                routingOnOptions.resolvePathRelativeToWwwroot,
              "utf8"
            )
          );
        });
    });
    it("should resolve an actual html file", function () {
      supertestReq(buildApp(routingOnOptions))
        .get("/actual-html-file.html")
        .expect(200)
        .expect("Content-Type", /html/)
        .then((response) => {
          expect(response.text).toBe(
            fs.readFileSync(
              appOptions.wwwroot + "/actual-html-file.html",
              "utf8"
            )
          );
        });
    });
    it("should resolve an actual json file", function () {
      supertestReq(buildApp(routingOnOptions))
        .get("/actual-json.json")
        .expect(200)
        .expect("Content-Type", /json/)
        .then((response) => {
          expect(response.text).toBe(
            fs.readFileSync(appOptions.wwwroot + "/actual-json.json", "utf8")
          );
        });
    });
  });

  describe("on post,", function () {
    it("should error out with routing off", function (done) {
      supertestReq(buildApp(routingOffOptions))
        .post("/mochiRoute")
        .expect(404)
        .end(assert(done));
    });
    it("should error out with routing on", function (done) {
      supertestReq(buildApp(routingOnOptions))
        .post("/mochiRoute")
        .expect(404)
        .end(assert(done));
    });
  });

  function buildApp(spaOptions) {
    const opts = options.init(true);
    const serverOptions = {
      ...appOptions,
      settings: {
        singlePageRouting: {
          ...spaOptions
        }
      }
    };
    const mergedOptions = Object.assign(opts, serverOptions);
    const app = makeServer(mergedOptions);
    app.use(function (err, _req, res) {
      console.error(err.stack);
      res.status(500).send("Something broke!");
    });
    return app;
  }

  function assert(done) {
    return function (err) {
      if (err) {
        fail(err);
      }
      done();
    };
  }
});
