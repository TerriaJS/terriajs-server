/* jshint node: true */
"use strict";

var request = require('request');
const express = require("express");
const URI = require("urijs");
const Cesium = require("terriajs-cesium/Build/CesiumUnminified/Cesium");
const Matrix4 = Cesium.Matrix4;
const Matrix3 = Cesium.Matrix3;
const defined = Cesium.defined;
const Cartesian3 = Cesium.Cartesian3;

module.exports = function(options) {
  const router = express.Router();

  router.get("/:token/:assetId", function(req, res, next) {
    request({
      url: `https://api.cesium.com/v1/assets/${req.params.assetId}/endpoint?access_token=${req.params.token}`,
      json: true,
      gzip: true
    }, function(error, response, body) {
      if (error) {
        res.status(500).send("Request to ion failed.");
        return;
      }

      if (response.statusCode !== 200) {
        res.status(response.statusCode).send(body);
        return;
      }

      const uri = new URI(body.url);
      uri.setQuery("access_token", body.accessToken);

      request({
        url: uri.toString(),
        json: true,
        gzip: true
      }, function(tilesetError, tilesetResponse, tilesetBody) {
        if (error) {
          res.status(500).send("Request to ion failed.");
          return;
        }

        if (tilesetResponse.statusCode !== 200) {
          res.status(tilesetResponse.statusCode).send(tilesetBody);
          return;
        }

        if (!tilesetBody.extras) {
          tilesetBody.extras = {};
        }
        tilesetBody.extras.ion = body;

        if (tilesetBody.root) {
          // External tilesets can't have children.
          delete tilesetBody.root.children;

          // Don't let the tileset be transformed twice.
          const transform = tilesetBody.root.transform;
          delete tilesetBody.root.transform;

          // Replace any root tile content with the real tileset as an external tileset.
          tilesetBody.root.content = {
            "uri": uri.toString()
          };

          // The geometric error of the fake root tile should match the tileset's
          // geometric error, rather than the real root tile's geometric error.
          tilesetBody.root.geometricError = tilesetBody.geometricError;

          // We need to apply the transform to the bounding volume manually, because we've
          // removed the transform.
          const boundingVolume = tilesetBody.root.boundingVolume;
          if (transform && boundingVolume) {
            tilesetBody.root.boundingVolume = transformBoundingVolume(boundingVolume, transform);
          }

          // Don't use a viewerRequestVolume here.
          delete tilesetBody.root.viewerRequestVolume;
        }

        res.send(tilesetBody);
      });
    });
  });

  return router;
};

function transformBoundingVolume(boundingVolumeHeader, transform) {
  if (defined(boundingVolumeHeader.box)) {
    return transformBox(boundingVolumeHeader.box, transform);
  }
  if (defined(boundingVolumeHeader.region)) {
    // No change required to regions.
    return boundingVolumeHeader;
  }
  if (defined(boundingVolumeHeader.sphere)) {
    return transformSphere(boundingVolumeHeader.sphere, transform);
  }
  return boundingVolumeHeader;
}

function transformBox(box, transform) {
  var center = Cartesian3.fromElements(box[0], box[1], box[2]);
  var halfAxes = Matrix3.fromArray(box, 3);

  // Find the transformed center and halfAxes
  center = Matrix4.multiplyByPoint(transform, center, center);
  var rotationScale = Matrix4.getMatrix3(transform, new Matrix3());
  halfAxes = Matrix3.multiply(rotationScale, halfAxes, halfAxes);

  return {
    box: [
      center.x, center.y, center.z,
      ...Matrix3.toArray(halfAxes)
    ]
  };
}

function transformSphere(sphere, transform, result) {
  var center = Cartesian3.fromElements(
    sphere[0],
    sphere[1],
    sphere[2]
  );
  var radius = sphere[3];

  // Find the transformed center and radius
  center = Matrix4.multiplyByPoint(transform, center, center);
  var scale = Matrix4.getScale(transform, new Matrix4());
  var uniformScale = Cartesian3.maximumComponent(scale);
  radius *= uniformScale;

  return {
    sphere: [center.x, center.y, center.z, radius]
  };
}

