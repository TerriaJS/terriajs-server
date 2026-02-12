import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { LocalstackContainer } from "@testcontainers/localstack";
import supertestReq from "supertest";

import makeServer from "../lib/makeserver.js";
import options from "../lib/options.js";

// in this test we can't mock file system as it will break down the testcontainers setup and tests won't work
describe("Share Module (e2e) - S3", () => {
  let localstackContainer;

  function buildApp(settingsOverrides = {}) {
    const opts = options.init(true);
    const mergedOptions = Object.assign({}, opts, {
      wwwroot: "./spec/mockwwwroot",
      hostName: "localhost",
      port: "3001",
      settings: {
        shareUrlPrefixes: {
          s3: {
            service: "s3",
            region: "us-east-1",
            bucket: "sample-bucket",
            endpoint: localstackContainer.getConnectionUri(),
            accessKeyId: "test",
            secretAccessKey: "test",
            keyLength: 54,
            forcePathStyle: true
          }
        },
        newShareUrlPrefix: "s3",
        shareMaxRequestSize: "200kb",
        ...settingsOverrides
      }
    });
    return makeServer(mergedOptions);
  }

  beforeAll(async () => {
    localstackContainer = await new LocalstackContainer(
      "localstack/localstack:s3-latest"
    ).start();

    const endpoint = localstackContainer.getConnectionUri();

    const client = new S3Client({
      endpoint: endpoint,
      forcePathStyle: true,
      region: "us-east-1",
      credentials: {
        secretAccessKey: "test",
        accessKeyId: "test"
      }
    });

    const createBucketResponse = await client.send(
      new CreateBucketCommand({ Bucket: "sample-bucket" })
    );
    expect(createBucketResponse.$metadata.httpStatusCode).toEqual(200);
  }, 120000);

  it("should save and resolve share via s3 provider", async () => {
    const app = buildApp();
    const response = await supertestReq(app)
      .post("/share")
      .send({ data: "test content" })
      .expect(201);

    expect(JSON.parse(response.text)).toEqual(
      jasmine.objectContaining({
        id: "s3-aqJr26G16vOvgbBGgrfzSYLIcy"
      })
    );

    await supertestReq(app)
      .get("/share/s3-aqJr26G16vOvgbBGgrfzSYLIcy")
      .expect(200, Buffer.from(JSON.stringify({ data: "test content" })));
  });

  it("should return 404 for non-existent share", async () => {
    await supertestReq(buildApp()).get("/share/s3-nonexistentid").expect(404);
  });

  it("should return 500 when saving to non-existent bucket", async () => {
    const app = buildApp({
      shareUrlPrefixes: {
        s3: {
          service: "s3",
          region: "us-east-1",
          bucket: "no-such-bucket",
          endpoint: localstackContainer.getConnectionUri(),
          accessKeyId: "test",
          secretAccessKey: "test",
          keyLength: 54,
          forcePathStyle: true
        }
      }
    });

    const response = await supertestReq(app)
      .post("/share")
      .send({ data: "test content" })
      .expect(500);

    expect(response.body.message).toBeDefined();
  });

  it("should return 400 for unknown share prefix", async () => {
    await supertestReq(buildApp()).get("/share/unknown-someid").expect(400);
  });

  it("should return 404 when newShareUrlPrefix is not configured", async () => {
    const app = buildApp({ newShareUrlPrefix: undefined });

    const response = await supertestReq(app)
      .post("/share")
      .send({ data: "test content" })
      .expect(404);

    expect(response.body.message).toContain(
      "not been configured to generate new share URLs"
    );
  });

  afterAll(async () => {
    await localstackContainer.stop();
  });
});
