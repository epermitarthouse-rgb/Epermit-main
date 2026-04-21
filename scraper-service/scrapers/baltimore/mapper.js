"use strict";

/**
 * Accela/Baltimore portal_data shaping is produced inside scrapeAccelaRecord and
 * server-side helpers (e.g. merge/sync). No separate mapper module exists yet.
 */

module.exports = {
  MIGRATION_NOTE:
    "Extract mapper only with fixture tests; preserve keys read by AccelaProjectView and BaltimorePortalDataView.",
};
