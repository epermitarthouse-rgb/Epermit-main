"use strict";

/**
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
function logTerritoryResolver(event, fields = {}) {
  const payload = {
    component: "uci-territory-resolver",
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

module.exports = {
  logTerritoryResolver,
};
