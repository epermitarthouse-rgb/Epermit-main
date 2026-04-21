"use strict";

const pgc = require("../../pgc-eplan-scraper.js");

/**
 * PGC production pipeline entry points — delegates to pgc-eplan-scraper.js (unchanged).
 */

module.exports = {
  runPgcProductionPipeline: pgc.runPgcProductionPipeline,
  scrapeSingleProjectDetails: pgc.scrapeSingleProjectDetails,
};
