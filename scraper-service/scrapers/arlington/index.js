"use strict";

/**
 * Arlington County Accela — delegates to accela-scraper.js (tenant profile: accela-tenant-profiles.js).
 */

module.exports = {
  login: require("./login.js"),
  scrape: require("./scrape.js"),
  mapper: require("./mapper.js"),
  legacy: require("../../accela-scraper.js"),
};
