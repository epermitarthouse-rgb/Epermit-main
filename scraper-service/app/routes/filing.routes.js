"use strict";

const { Router } = require("express");

const router = Router();

/**
 * Surface area map for e-permit filing modules (parallel documentation only).
 */
router.get("/plan/filing", (req, res) => {
  res.json({
    kind: "filing-surface",
    modules: [
      { name: "permitwizard", paths: ["permitwizard-auth.js", "permitwizard-filer.js", "permitwizard-submit.js"] },
      { name: "momentum", paths: ["momentum-auth.js", "momentum-filer.js", "momentum-submit.js"] },
      {
        name: "montgomery-permitting-site",
        paths: [
          "scrapers/montgomery/auth.js",
          "scrapers/montgomery/filer.js",
          "scrapers/montgomery/submit.js",
        ],
      },
      { name: "energov", paths: ["energov-auth.js", "energov-filer.js", "energov-submit.js"] },
    ],
    note:
      "Route registration for filing remains in server.js until migration. This list is documentation-only.",
  });
});

module.exports = router;
