"use strict";

const pgc = require("../../pgc-eplan-scraper.js");

/**
 * PGC ePlan login + grid collection — delegates to pgc-eplan-scraper.js (unchanged).
 */

module.exports = {
  isPgcEplanHost: pgc.isPgcEplanHost,
  resolvePgcLoginUrl: pgc.resolvePgcLoginUrl,
  performPgcLogin: pgc.performPgcLogin,
  waitForProjectGrid: pgc.waitForProjectGrid,
  detectPaginationMode: pgc.detectPaginationMode,
  collectAllProjects: pgc.collectAllProjects,
  resolvePgcWebUiBases: pgc.resolvePgcWebUiBases,
};
