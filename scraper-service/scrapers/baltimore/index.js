"use strict";

/**
 * Baltimore Accela — wraps accela-scraper.js (Baltimore branches are internal).
 */

module.exports = {
  login: require("./login.js"),
  scrape: require("./scrape.js"),
  mapper: require("./mapper.js"),
  /** Full legacy module surface if needed */
  legacy: require("../../accela-scraper.js"),
};
