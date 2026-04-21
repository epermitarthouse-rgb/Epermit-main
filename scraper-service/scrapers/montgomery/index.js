"use strict";

/**
 * Montgomery County Avolve ProjectDox — package entry.
 */

module.exports = {
  login: require("./login.js"),
  discovery: require("./discovery.js"),
  scrape: require("./scrape.js"),
  mapper: require("./mapper.js"),
  legacy: require("./projectdox-scraper.js"),
};
