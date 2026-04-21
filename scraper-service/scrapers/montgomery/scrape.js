"use strict";

const montgomery = require("./projectdox-scraper.js");

module.exports = {
  runMontgomeryProductionPipeline: montgomery.runMontgomeryProductionPipeline,
  resolveMontgomeryWebUiBases: montgomery.resolveMontgomeryWebUiBases,
  buildMontgomeryProjectTabUrl: montgomery.buildMontgomeryProjectTabUrl,
  isMontgomeryProjectDoxHost: montgomery.isMontgomeryProjectDoxHost,
};
