"use strict";

/**
 * Washington / default Avolve ProjectDox — parallel package (logic still in server.js).
 */

module.exports = {
  jurisdictionId: "washington-projectdox",
  login: require("./login.js"),
  scrape: require("./scrape.js"),
  mapper: require("./mapper.js"),
};
