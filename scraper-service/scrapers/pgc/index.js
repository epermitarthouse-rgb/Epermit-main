"use strict";

/**
 * Prince George's County ePlan / PGC parallel package.
 */

module.exports = {
  login: require("./login.js"),
  scrape: require("./scrape.js"),
  mapper: require("./mapper.js"),
  progress: require("./progress.js"),
  /** Full legacy module surface */
  legacy: require("../../pgc-eplan-scraper.js"),
};
