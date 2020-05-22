/* jshint node: true */
"use strict";

var request = require('request');
const express = require("express");
const URI = require("urijs");

module.exports = function(options) {
  const router = express.Router();

  router.get("/:token/:assetId", function(req, res, next) {
    res.statusCode
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
      res.redirect(302, uri.toString());
    });
  });

  return router;
};
