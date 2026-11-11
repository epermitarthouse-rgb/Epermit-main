"use strict";

/**
 * Loads the manual scraper closure for the deep pass without starting the HTTP app (D-055): the four
 * background loops are switched off before the module is required, and the routes are registered on an
 * express app that never listens. Returns the additive `dcDeep` export.
 */

const KILL_SWITCHES = Object.freeze([
  "ARLINGTON_DURABLE_WORKER_ENABLED",
  "UCI_DURABLE_WORKER_ENABLED",
  "UCI_GRAPH_INBOUND_POLLER_ENABLED",
  "UCI_LIFECYCLE_SCHEDULER_ENABLED",
]);

let cached = null;

function loadDcDeep(env = process.env) {
  if (cached) return cached;
  for (const k of KILL_SWITCHES) env[k] = "false";
  const express = require("express");
  const { registerExecutionRoutes } = require("../../app/register-execution-routes.js");
  const out = registerExecutionRoutes(express());
  if (!out || !out.dcDeep || typeof out.dcDeep.scrapeAll !== "function") throw new Error("registerExecutionRoutes has no dcDeep export");
  cached = out.dcDeep;
  return cached;
}

module.exports = { loadDcDeep, KILL_SWITCHES };
