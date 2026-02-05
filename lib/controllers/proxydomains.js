/* jshint node: true */
"use strict";
import express from "express";
const router = express.Router();

export default function (options) {
  router.get("/", function (req, res, next) {
    res.status(200).send(options);
  });
  return router;
}
