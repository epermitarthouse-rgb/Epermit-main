"use strict";

const howard = require("./projectdox-scraper.js");

module.exports = {
  runHowardProductionPipeline: howard.runHowardProductionPipeline,
  resolveHowardWebUiBases: howard.resolveHowardWebUiBases,
  buildHowardProjectTabUrl: howard.buildHowardProjectTabUrl,
  isHowardProjectDoxHost: howard.isHowardProjectDoxHost,
};
