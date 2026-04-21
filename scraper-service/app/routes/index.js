"use strict";

const { Router } = require("express");
const health = require("./health.routes.js");
const session = require("./session.routes.js");
const scrape = require("./scrape.routes.js");
const exportRoutes = require("./export.routes.js");
const filing = require("./filing.routes.js");

const router = Router();

router.use(health);
router.use(session);
router.use(scrape);
router.use(exportRoutes);
router.use(filing);

module.exports = router;
