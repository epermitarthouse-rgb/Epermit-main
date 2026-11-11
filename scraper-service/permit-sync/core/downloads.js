"use strict";

/**
 * Document download policy. File bodies are never fetched in the current phase: the decision below
 * is what a future downloader must consult, and it is deny-by-default. DC accounts report
 * DownloadFile=false (Phase 0), so DC is always skipped regardless of flags.
 *
 * @param {{ env?: NodeJS.ProcessEnv, adapterKey: string, settings?: object, accountDownload?: boolean|null }} input
 * @returns {{ download: boolean, reason: string }}
 */
function downloadDecision({ env = process.env, adapterKey, settings = {}, accountDownload = null }) {
  if (adapterKey === "dc-projectdox") return { download: false, reason: "dc_account_download_disabled" };
  if (env.PERMIT_SYNC_DOWNLOADS_ENABLED !== "true") return { download: false, reason: "downloads_flag_off" };
  if (!settings || settings.download_permitted !== true) return { download: false, reason: "source_not_permitted" };
  if (accountDownload !== true) return { download: false, reason: "account_cannot_download" };
  return { download: false, reason: "downloader_not_implemented" };
}

module.exports = { downloadDecision };
