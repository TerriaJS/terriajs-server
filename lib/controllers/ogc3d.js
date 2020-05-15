/* jshint node: true */
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const cesium = require("terriajs-cesium");

module.exports = function(options) {
  const router = express.Router();

  router.get("/collections", async function(req, res, next) {
    const bboxString = req.query["bbox"];
    if (!bboxString) {
      next();
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

  const searchRectangle = new cesium.Rectangle.fromDegrees(west, south, east, north);
  const itemRectangle = new cesium.Rectangle.fromDegrees(bboxWest, bboxSouth, bboxEast, bboxNorth);
  const intersection = cesium.Rectangle.intersection(searchRectangle, itemRectangle);
  if (!intersection) {
    return false;
  }

  return bboxMaxHeight >= minHeight && bboxMinHeight <= maxHeight;
}
