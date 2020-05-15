/* jshint node: true */
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

module.exports = function(options) {
  const router = express.Router();

  router.get("/collections/:id", function(req, res, next) {
    res.sendFile(path.resolve(options.wwwroot, "container-api", "collections", req.params.id, "index.json"));
  });

  router.get("/collections", async function(req, res, next) {
    const bboxString = req.query["bbox"];
    if (!bboxString) {
      res.sendFile(path.resolve(options.wwwroot, "container-api", "collections", "index.json"));
      return;
    }

    let west;
    let south;
    let east;
    let north;
    let minHeight;
    let maxHeight;

    try {
      const bboxParts = bboxString.split(',').map(Number.parseFloat);

      if (bboxParts.length === 4) {
        west = bboxParts[0];
        south = bboxParts[1];
        minHeight = -Number.MAX_VALUE;
        east = bboxParts[2];
        north = bboxParts[3];
        maxHeight = Number.MAX_VALUE;
      } else if (bboxParts.length === 6) {
        west = bboxParts[0];
        south = bboxParts[1];
        minHeight = bboxParts[2];
        east = bboxParts[3];
        north = bboxParts[4];
        maxHeight = bboxParts[5];
      } else {
        throw new Error();
      }
    } catch (e) {
      res.send("Could not understand bbox query parameter.");
      return;
    }

    const collectionsPath = path.resolve(options.wwwroot, "container-api", "collections", "index.json");
    const collections = await fs.promises.readFile(collectionsPath, "utf8");
    const json = JSON.parse(collections);
    json.collections = json.collections.filter(collection => {
      if (!collection.extent || !collection.extent.spatial || !collection.extent.spatial.bbox) {
        return false;
      }

      const bboxes = collection.extent.spatial.bbox;
      return bboxes.some(bbox => overlaps(bbox, west, south, minHeight, east, north, maxHeight));
    });

    res.send(json);
  });

  router.use(express.static(path.resolve(options.wwwroot, "container-api"), {
    index: "index.json"
  }));

  return router;
};

function overlaps(bbox, west, south, minHeight, east, north, maxHeight) {
  let bboxWest, bboxSouth, bboxMinHeight, bboxEast,bboxNorth, bboxMaxHeight;

  if (bbox.length === 4) {
    bboxWest = bbox[0];
    bboxSouth = bbox[1];
    bboxMinHeight = -Number.MAX_VALUE;
    bboxEast = bbox[2];
    bboxNorth = bbox[3];
    bboxMaxHeight = Number.MAX_VALUE;
  } else if (bbox.length === 6) {
    bboxWest = bbox[0];
    bboxSouth = bbox[1];
    bboxMinHeight = bbox[2];
    bboxEast = bbox[3];
    bboxNorth = bbox[4];
    bboxMaxHeight = bbox[5];
  }

  const searchRectangle = new Rectangle.fromDegrees(west, south, east, north);
  const itemRectangle = new Rectangle.fromDegrees(bboxWest, bboxSouth, bboxEast, bboxNorth);
  const intersection = Rectangle.intersection(searchRectangle, itemRectangle);
  if (!intersection) {
    return false;
  }

  return bboxMaxHeight >= minHeight && bboxMinHeight <= maxHeight;
}

function Rectangle(west, south, east, north) {
  this.west = west;
  this.south = south;
  this.east = east;
  this.north = north;
}

Rectangle.fromDegrees = function(west, south, east, north) {
  return new Rectangle(west * Math.PI / 180.0, south * Math.PI / 180.0, east * Math.PI / 180.0, north * Math.PI / 180.0);
};

Rectangle.intersection = function(rectangle, otherRectangle) {
  var rectangleEast = rectangle.east;
  var rectangleWest = rectangle.west;

  var otherRectangleEast = otherRectangle.east;
  var otherRectangleWest = otherRectangle.west;

  if (rectangleEast < rectangleWest && otherRectangleEast > 0.0) {
    rectangleEast += Math.PI * 2.0;
  } else if (otherRectangleEast < otherRectangleWest && rectangleEast > 0.0) {
    otherRectangleEast += Math.PI * 2.0;
  }

  if (rectangleEast < rectangleWest && otherRectangleWest < 0.0) {
    otherRectangleWest += Math.PI * 2.0;
  } else if (otherRectangleEast < otherRectangleWest && rectangleWest < 0.0) {
    rectangleWest += Math.PI * 2.0;
  }

  var west = negativePiToPi(
    Math.max(rectangleWest, otherRectangleWest)
  );
  var east = negativePiToPi(
    Math.min(rectangleEast, otherRectangleEast)
  );

  if (
    (rectangle.west < rectangle.east ||
      otherRectangle.west < otherRectangle.east) &&
    east <= west
  ) {
    return undefined;
  }

  var south = Math.max(rectangle.south, otherRectangle.south);
  var north = Math.min(rectangle.north, otherRectangle.north);

  if (south >= north) {
    return undefined;
  }

  return new Rectangle(west, south, east, north);
};

function negativePiToPi(angle) {
  return zeroToTwoPi(angle + Math.PI) - Math.PI;
}

function zeroToTwoPi(angle) {
  var result = mod(angle, Math.PI * 2.0);
  if (
    Math.abs(result) < 1e-14 &&
    Math.abs(angle) > 1e-14
  ) {
    return 2.0 * Math.PI;
  }
  return result;
}

function mod(m, n) {
  return ((m % n) + n) % n;
}
