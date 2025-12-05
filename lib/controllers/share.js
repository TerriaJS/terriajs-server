/* jshint node: true, esnext: true */
"use strict";

var bodyParser = require("body-parser");

var gistAPI = "https://api.github.com/gists";

var prefixSeparator = "-"; // change the regex below if you change this
var splitPrefixRe = /^(([^-]+)-)?(.*)$/;

//You can test like this with httpie:
//echo '{ "test": "me" }' | http post localhost:3001/api/v1/share
async function makeGist(serviceOptions, body) {
  var gistFile = {};
  gistFile[serviceOptions.gistFilename || "usercatalog.json"] = {
    content: body
  };

  var headers = {
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
  var headers = {
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
function shortId(body, length) {
  var hmac = require("crypto").createHmac("sha1", body).digest();
  var base62 = require("base-x").default(
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  );
  var fullkey = base62.encode(hmac);
  return fullkey.slice(0, length); // if length undefined, return the whole thing
}

var _S3;

function S3(serviceOptions) {
  if (_S3) {
    return _S3;
  } else {
    var aws = require("aws-sdk");
    aws.config.update({
      endpoint: serviceOptions.endpoint ?? undefined,
      region: serviceOptions.region
    });
    // if no credentials provided, we assume that they're being provided as environment variables or in a file
    if (serviceOptions.accessKeyId) {
      aws.config.update({
        accessKeyId: serviceOptions.accessKeyId,
        secretAccessKey: serviceOptions.secretAccessKey
      });
    }
    _S3 = new aws.S3();
    return _S3;
  }
}

// We append some pseudo-dir prefixes into the actual object ID to avoid thousands of objects in a single pseudo-directory.
// MyRaNdoMkey => M/y/MyRaNdoMkey
const idToObject = (id) => id.replace(/^(.)(.)/, "$1/$2/$1$2");

function saveS3(serviceOptions, body) {
  var id = shortId(body, serviceOptions.keyLength);
  const params = {
    Bucket: serviceOptions.bucket,
    Key: idToObject(id),
    Body: body
  };

  return S3(serviceOptions)
    .putObject(params)
    .promise()
    .then(function (result) {
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
    })
    .catch(function (e) {
      console.error(e);
      return e;
    });
}

function resolveS3(serviceOptions, id) {
  const params = {
    Bucket: serviceOptions.bucket,
    Key: idToObject(id)
  };
  return S3(serviceOptions)
    .getObject(params)
    .promise()
    .then(function (data) {
      return data.Body;
    })
    .catch(function (e) {
      throw {
        response: e,
        error: e.message
      };
    });
}

module.exports = function (hostName, port, options) {
  if (!options.shareUrlPrefixes) {
    return;
  }

  var router = require("express").Router();
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
    var serviceOptions = options.shareUrlPrefixes[options.newShareUrlPrefix];
    var minter = {
      gist: makeGist,
      s3: saveS3
    }[serviceOptions.service.toLowerCase()];

    minter(serviceOptions, req.body)
      .then(function (id) {
        id = options.newShareUrlPrefix + prefixSeparator + id;
        var resPath = req.baseUrl + "/" + id;
        // these properties won't behave correctly unless "trustProxy: true" is set in user's options file.
        // they may not behave correctly (especially port) when behind multiple levels of proxy
        var resUrl =
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
        var errorMessage =
          (reason.cause && reason.cause.message) ||
          reason.error ||
          "An error occurred";
        res.status(500).json({ message: errorMessage });
      });
  });

  // Resolve an existing ID. We break off the prefix and use it to work out which resolver to use.
  router.get("/:id", function (req, res, next) {
    var prefix = req.params.id.match(splitPrefixRe)[2] || "";
    var id = req.params.id.match(splitPrefixRe)[3];
    var resolver;

    var serviceOptions = options.shareUrlPrefixes[prefix];
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
};
