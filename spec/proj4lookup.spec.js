import supertestReq from "supertest";
import makeserver from "../lib/makeserver.js";
import options from "../lib/options.js";

let server;

describe("proj4lookup", function () {
  beforeEach(function () {
    const opts = options.init(true);
    server = makeserver(opts);
  });

  describe("on get", function () {
    it("should return a definition for EPSG:4326", function (done) {
      supertestReq(server)
        .get("/api/v1/proj4def/EPSG:4326")
        .expect(200, "+proj=longlat +datum=WGS84 +no_defs")
        .end(assert(done));
    });

    it("should 404 unknown projection", function (done) {
      supertestReq(server)
        .get("/api/v1/proj4def/EPSG:Notarealthing")
        .expect(404)
        .end(assert(done));
    });
  });

  function assert(done) {
    return (err) => (err ? done.fail(err) : done());
  }
});
