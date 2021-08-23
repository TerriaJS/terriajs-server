/* jshint node: true */
"use strict";
var express = require('express');
var router = express.Router();

var proj4 = require('proj4');

//TODO: check if this loads the file into each core and if so then,
require('proj4js-defs/epsg')(proj4);

// GDA2020 proj4 string from https://gis.stackexchange.com/questions/349780/is-there-a-proj4-string-for-gda2020-epsg7844-that-we-use-to-transform-from-38
proj4.defs["EPSG:7844"] = "+proj=longlat +ellps=GRS80 +towgs84=-0.06155,0.01087,0.04019,-0.0394924,-0.0327221,-0.03289790,0.009994 +no_defs";

//provide REST service for proj4 definition strings
router.get('/:crs', function(req, res, next) {
    var epsg = proj4.defs[req.params.crs.toUpperCase()];
    if (epsg !== undefined) {
        res.status(200).send(epsg);
    } else {
        res.status(404).send('No proj4 definition available for this CRS.');
    }
});

module.exports = router;
