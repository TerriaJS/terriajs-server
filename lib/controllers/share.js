import bodyParser from "body-parser";
import express from "express";
import crypto from "node:crypto";
import baseX from "base-x";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";

const gistAPI = "https://api.github.com/gists";

const prefixSeparator = "-"; // change the regex below if you change this
const splitPrefixRe = /^(([^-]+)-)?(.*)$/;

//You can test like this with httpie:
//echo '{ "test": "me" }' | http post localhost:3001/api/v1/share
async function makeGist(serviceOptions, body) {
  const gistFile = {};
  gistFile[serviceOptions.gistFilename || "usercatalog.json"] = {
    content: body
  };

  const headers = {
    "User-Agent": serviceOptions.userAgent || "TerriaJS-Server",
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };
  if (serviceOptions.accessToken !== undefined) {
    headers["Authorization"] = "token " + serviceOptions.accessToken;
  }

  const response = await fetch(gistAPI, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      files: gistFile,
      description: serviceOptions.gistDescription || "User-created catalog",
      public: false
    })
  });

  const responseBody = await response.json();

  if (response.status === 201) {
    console.log("Created ID " + responseBody.id + " using Gist service");
    return responseBody.id;
  } else {
    const error = new Error(responseBody.message || "Failed to create gist");
    error.response = response;
    error.statusCode = response.status;
    throw error;
  }
}

// Test: http localhost:3001/api/v1/share/g-98e01625db07a78d23b42c3dbe08fe20
async function resolveGist(serviceOptions, id) {
  const headers = {
    "User-Agent": serviceOptions.userAgent || "TerriaJS-Server",
    Accept: "application/vnd.github.v3+json"
  };
  if (serviceOptions.accessToken !== undefined) {
    headers["Authorization"] = "token " + serviceOptions.accessToken;
  }

  const response = await fetch(gistAPI + "/" + id, {
    method: "GET",
    headers: headers
  });

  const responseBody = await response.json();

  if (response.status >= 300) {
    throw {
      response: response,
      error: responseBody.message || "Failed to resolve gist"
    };
  } else {
    return responseBody.files[Object.keys(responseBody.files)[0]].content; // find the contents of the first file in the gist
  }
}
/*
  Generate short ID by hashing body, converting to base62 then truncating.
 */
const base62 = baseX(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
);

function shortId(body, length) {
  const hmac = crypto.createHmac("sha1", body).digest();
  const fullkey = base62.encode(hmac);
  return fullkey.slice(0, length); // if length undefined, return the whole thing
}

let _S3;

function S3(serviceOptions) {
  if (_S3) {
    return _S3;
  }

  const config = {
    region: serviceOptions.region,
    forcePathStyle: serviceOptions.forcePathStyle ?? true
  };

  if (serviceOptions.endpoint) {
    config.endpoint = serviceOptions.endpoint;
  }

  // if credentials provided, use them; otherwise SDK will use environment variables or default credential chain
  if (serviceOptions.accessKeyId) {
    config.credentials = {
      accessKeyId: serviceOptions.accessKeyId,
      secretAccessKey: serviceOptions.secretAccessKey
    };
  }

  _S3 = new S3Client(config);
  return _S3;
}

// We append some pseudo-dir prefixes into the actual object ID to avoid thousands of objects in a single pseudo-directory.
// MyRaNdoMkey => M/y/MyRaNdoMkey
const idToObject = (id) => id.replace(/^(.)(.)/, "$1/$2/$1$2");

async function saveS3(serviceOptions, body) {
  const id = shortId(body, serviceOptions.keyLength);
  const params = {
    Bucket: serviceOptions.bucket,
    Key: idToObject(id),
    Body: body
  };

  const client = S3(serviceOptions);
  const command = new PutObjectCommand(params);

  try {
    const result = await client.send(command);
    console.log(
      "Saved key " +
        id +
        " to S3 bucket " +
        params.Bucket +
        ":" +
        params.Key +
        ". Etag: " +
        result.ETag
    );
    return id;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function resolveS3(serviceOptions, id) {
  const params = {
    Bucket: serviceOptions.bucket,
    Key: idToObject(id)
  };

  const client = S3(serviceOptions);
  const command = new GetObjectCommand(params);

  try {
    const data = await client.send(command);
    const bodyBytes = await data.Body.transformToByteArray();
    return Buffer.from(bodyBytes);
  } catch (e) {
    throw {
      response: e,
      error: e.message
    };
  }
}

export default function (hostName, port, options) {
  if (!options.shareUrlPrefixes) {
    return;
  }

  const router = express.Router();
  router.use(
    bodyParser.text({
      type: "*/*",
      limit: options.shareMaxRequestSize || "200kb"
    })
  );

  // Return the 413 error thrown by body-parser to the client
  router.use(function (error, req, res, next) {
    if (error && (error.status === 413 || error.type === "entity.too.large")) {
      res.status(413).send("Payload Too Large");
    } else {
      next(error);
    }
  });

  // Requested creation of a new short URL.
  router.post("/", function (req, res, next) {
    if (
      options.newShareUrlPrefix === undefined ||
      !options.shareUrlPrefixes[options.newShareUrlPrefix]
    ) {
      return res.status(404).json({
        message:
          "This server has not been configured to generate new share URLs."
      });
    }
    const serviceOptions = options.shareUrlPrefixes[options.newShareUrlPrefix];
    const minter = {
      gist: makeGist,
      s3: saveS3
    }[serviceOptions.service.toLowerCase()];

    minter(serviceOptions, req.body)
      .then(function (id) {
        id = options.newShareUrlPrefix + prefixSeparator + id;
        const resPath = req.baseUrl + "/" + id;
        // these properties won't behave correctly unless "trustProxy: true" is set in user's options file.
        // they may not behave correctly (especially port) when behind multiple levels of proxy
        const resUrl =
          req.protocol +
          "://" +
          req.hostname +
          (req.header("X-Forwarded-Port") || port) +
          resPath;
        res
          .location(resUrl)
          .status(201)
          .json({ id: id, path: resPath, url: resUrl });
      })
      .catch(function (reason) {
        console.error(JSON.stringify(reason, null, 2));
        const errorMessage =
          (reason.cause && reason.cause.message) ||
          reason.error ||
          "An error occurred";
        res.status(500).json({ message: errorMessage });
      });
  });

  // Resolve an existing ID. We break off the prefix and use it to work out which resolver to use.
  router.get("/:id", function (req, res, next) {
    const prefix = req.params.id.match(splitPrefixRe)[2] || "";
    const id = req.params.id.match(splitPrefixRe)[3];
    let resolver;

    const serviceOptions = options.shareUrlPrefixes[prefix];
    if (!serviceOptions) {
      console.error(
        'Share: Unknown prefix to resolve "' + prefix + '", id "' + id + '"'
      );
      return res.status(400).send('Unknown share prefix "' + prefix + '"');
    } else {
      resolver = {
        gist: resolveGist,
        s3: resolveS3
      }[serviceOptions.service.toLowerCase()];
    }
    resolver(serviceOptions, id)
      .then(function (content) {
        res.send(content);
      })
      .catch(function (reason) {
        console.warn(JSON.stringify(reason.response, null, 2));
        res
          .status(404) // probably safest if we always return 404 rather than whatever the upstream provider sets.
          .send(reason.error);
      });
  });
  return router;
}
