import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { LocalstackContainer } from "@testcontainers/localstack";
import { setTimeout } from "node:timers/promises";
import supertestReq from "supertest";

import makeServer from "../lib/makeserver.js";
import options from "../lib/options.js";

// in this test we can't mock file system as it will break down the testcontainers setup and tests won't work
describe("Share Module (e2e) - S3", () => {
  let localstackContainer;

  function buildApp() {
    const opts = options.init(true);
    const mergedOptions = Object.assign(opts, {
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
        shareMaxRequestSize: "200kb"
      }
    });
    return makeServer(mergedOptions);
  }

  beforeAll(async () => {
    localstackContainer = await new LocalstackContainer(
      "localstack/localstack:s3-latest"
    ).start();

    const endpoint = localstackContainer.getConnectionUri();

    await setTimeout(5000);

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

  it("should save share via s3 provider", async () => {
    const response = await supertestReq(buildApp())
      .post("/share")
      .send({ data: "test content" })
      .expect(201);

    expect(JSON.parse(response.text)).toEqual(
      jasmine.objectContaining({
        id: "s3-aqJr26G16vOvgbBGgrfzSYLIcy"
      })
    );
  }, 60000);

  it("should resolve share via s3 provider", async () => {
    await supertestReq(buildApp())
      .get("/share/s3-aqJr26G16vOvgbBGgrfzSYLIcy")
      .expect(200, Buffer.from(JSON.stringify({ data: "test content" })));
  }, 60000);

  afterAll(async () => {
    await localstackContainer.stop();
  });
});
