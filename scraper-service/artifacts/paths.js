"use strict";

const path = require("path");

/** scraper-service/ directory (parent of this folder) */
const SCRAPER_SERVICE_ROOT = path.join(__dirname, "..");

function getDownloadsDir() {
  return path.join(SCRAPER_SERVICE_ROOT, "downloads");
}

function getDebugDir() {
  return path.join(SCRAPER_SERVICE_ROOT, "debug");
}

function getPgcDownloadsRoot() {
  return path.join(SCRAPER_SERVICE_ROOT, "pgc-downloads");
}

function getPgcReportsRoot() {
  return path.join(SCRAPER_SERVICE_ROOT, "pgc-reports");
}

/** Montgomery local report exports (see scrapers/montgomery/projectdox-scraper.js). */
function getMdcReportsRoot() {
  return path.join(SCRAPER_SERVICE_ROOT, "mdc-reports");
}

function getPublicDir() {
  return path.join(SCRAPER_SERVICE_ROOT, "public");
}

module.exports = {
  SCRAPER_SERVICE_ROOT,
  getDownloadsDir,
  getDebugDir,
  getPgcDownloadsRoot,
  getPgcReportsRoot,
  getMdcReportsRoot,
  getPublicDir,
};
