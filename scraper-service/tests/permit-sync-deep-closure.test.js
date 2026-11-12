"use strict";

/**
 * The additive dcDeep export of the manual scraper closure (D-055, D-060, D-062), loaded in a child process
 * (tests/helpers/dc-deep-closure-probe.js):
 *   - the HTTP route list is identical to the committed version (HEAD)
 *   - syncPortalDataToSupabase with { forbidInsert, skipCredentialRepoint } never inserts a project and never
 *     re-points portal_credentials; the manual default still does
 *   - DC /api/login refuses with 409 while the worker holds the login
 *   - full-page dashboard discovery and paging back to a permit's page (real Chromium, offline pages)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PROBE = path.join(__dirname, "helpers", "dc-deep-closure-probe.js");

function probe(args, env = {}, timeout = 120000) {
  const r = spawnSync(process.execPath, [PROBE, ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("PROBE_RESULT ") || l.startsWith("PROBE_ERROR "));
  if (!line) throw new Error(`probe ${args[0]} printed no result (exit ${r.status})`);
  if (line.startsWith("PROBE_ERROR ")) throw new Error(JSON.parse(line.slice(12)));
  return JSON.parse(line.slice(13));
}

/** The committed file before the dcDeep export existed (HEAD while the change is uncommitted). */
function headSource() {
  const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const file = "scraper-service/app/register-execution-routes.js";
  try {
    const added = git(["log", "--format=%H", "--reverse", "-S", "dcDeep: {", "--", `:(top)${file}`]).split("\n").filter(Boolean)[0];
    return git(["show", `${added ? `${added}^` : "HEAD"}:${file}`]);
  } catch (_) {
    return null;
  }
}

test("HTTP routes are identical to the version before dcDeep; the only new export is dcDeep", (t) => {
  const src = headSource();
  if (!src) return t.skip("git HEAD not available");
  const headFile = path.join(ROOT, "app", `.routes-head-${process.pid}.js`);
  fs.writeFileSync(headFile, src);
  try {
    const head = probe(["routes", headFile]);
    const now = probe(["routes", path.join(ROOT, "app", "register-execution-routes.js")]);
    assert.ok(head.routes.length > 100);
    assert.deepEqual(now.routes, head.routes);
    assert.deepEqual(now.keys.filter((k) => !head.keys.includes(k)), ["dcDeep"]);
  } finally {
    fs.rmSync(headFile, { force: true });
  }
});

test("deep portal sync writes only to an existing linked project and never re-points the credential", () => {
  const r = probe(["sync"]);
  assert.deepEqual(r.keys, [
    "DEFAULT_DASHBOARD_URL", "TAB_DEFS", "collectDcPlanReviewDashboardAllPages", "collectDcPlanReviewDashboardProjects",
    "deriveWebUiBase", "downloadProjectDoxFile", "hashPortalData", "openDcPlanReviewProjectPopup", "performLogin",
    "reinitializeBrowser", "scrapeAll", "shouldMiniResetFilesPage", "stripPortalSyncTransientFields", "supabase", "syncPortalDataToSupabase",
  ]);
  assert.deepEqual(r.miniReset, { manual_10_0: true, manual_9_1: false, manual_20_2: true, deep_10_3: false, deep_20_4: false },
    "manual scrapes keep the every-10 Files page reset; deep runs never close the live Files page (D-091)");
  const { deep_missing_project: missing, deep_no_project_id: noId, deep_linked_project: linked, manual_default: manual } = r.results;
  assert.equal(missing.ok, false, "no linked row: the sync fails instead of creating a project");
  assert.deepEqual(missing.requests.map((q) => q.method), ["GET"], "no permit_number lookup, no insert");
  assert.equal(noId.ok, false, "a forbid-insert sync without the linked project id fails");
  assert.deepEqual(noId.requests, [], "before any request: the :3779 insert path is unreachable");
  assert.equal(linked.ok, true);
  assert.deepEqual(linked.requests.filter((q) => q.method !== "GET").map((q) => `${q.method} ${q.table}`), ["PATCH projects"]);
  assert.equal(manual.ok, true);
  assert.deepEqual(manual.requests.filter((q) => q.method !== "GET").map((q) => `${q.method} ${q.table}`), ["PATCH projects", "PATCH portal_credentials"], "manual default unchanged");
});

test("deep sync hashes permit content only: volatile fields never change portal_data_hash (D-072)", () => {
  const r = probe(["contenthash"]);
  const { legacy_row_same_content: legacy, same_content_again: again, real_change: change, after_change_volatile_only: after } = r;
  assert.equal(r.contentHashOfStamps[0], r.contentHashOfStamps[1], "two scrapes differing only in volatile fields hash the same");
  assert.equal(legacy.ok, true);
  assert.equal(legacy.hash, "legacy-full-hash", "a row hashed the old way keeps its hash when the content is the same");
  assert.deepEqual(legacy.patches, [["last_checked_at", "portal_data"]], "only the bookkeeping key and last_checked_at are written");
  assert.equal(again.hash, "legacy-full-hash");
  assert.deepEqual(again.patches, [["last_checked_at", "portal_data"]]);
  assert.equal(change.ok, true);
  assert.notEqual(change.hash, "legacy-full-hash", "a real content change writes a new hash (Realtime and worker trigger once)");
  assert.ok(change.patches[0].includes("portal_data_hash"));
  assert.equal(after.hash, change.hash, "the next scrape with the same content keeps that hash");
  assert.ok(after.patches.every((p) => !p.includes("portal_data_hash")));
  assert.deepEqual(r.bookkeeping, { permit_id: "p1", section_hashes: { files: "h4" } });
});

test("DC /api/login answers 409 while an automated sync holds a live lease on the same login (D-061)", () => {
  const r = probe(["login409"]);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "automated_sync_in_progress");
  assert.deepEqual(r.requests, ["GET portal_credentials", "GET permit_sync_jobs"], "checked before any browser launch");
});

test("3b: during a deep download, a denied request and a POST mutation still reach the transport guard (real Chromium)", (t) => {
  let r;
  try {
    r = probe(["downloadguard"]);
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch/.test(String(e.message))) return t.skip("Chromium not installed");
    throw e;
  }
  assert.deepEqual([...r.violations].sort(), ["GET /File/Upload", "POST /File/ToggleViewed"], "both refused by the guard");
  assert.deepEqual([...r.guardViolations].sort(), ["GET /File/Upload deny_pattern", "POST /File/ToggleViewed deny_pattern"]);
  const reached = r.server.map((s) => s.path);
  assert.equal(reached.includes("/File/Upload"), false, "the denied GET never reached the server");
  assert.equal(reached.includes("/File/ToggleViewed"), false, "the mutation never reached the server");
  const file = r.server.find((s) => s.path === "/File/RetrieveFile");
  assert.ok(file, "allowed file reads still pass through");
  assert.equal(file.cacheControl, "no-cache, no-store, must-revalidate", "the download route's header override is kept (fallback carries it)");
  assert.equal(r.result.success, true);
  assert.deepEqual(r.stored.map((s) => s.fileId), ["700101"]);
});

test("D-089: a blocked or empty viewer popup falls back to RetrieveFile GET; a real viewer config does not", (t) => {
  let r;
  try {
    r = probe(["viewerfallback"], {}, 180000);
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch/.test(String(e.message))) return t.skip("Chromium not installed");
    throw e;
  }
  assert.deepEqual(r.guardViolations, []);
  assert.deepEqual(r.serverPosts, [], "an aborted POST never reaches the fake portal");
  const byName = Object.fromEntries(r.cases.map((c) => [c.name, c]));

  for (const name of ["blocked", "empty"]) {
    const c = byName[name];
    assert.equal(c.success, true, `${name} ${c.reason}`);
    assert.ok(c.openUrls.every((u) => !u.startsWith("chrome-error:") && u !== "about:blank"), `${name} popup stayed open: ${c.openUrls.join(" ")}`);
    const gets = c.apiGets.filter((u) => u.includes("/File/RetrieveFile"));
    assert.ok(gets.length >= 1, name);
    assert.match(gets[0], /\/File\/RetrieveFile\?inline=true&fileID=/);
    assert.equal(gets[0].includes("convertToPDF"), false, "original RetrieveFile is first");
    assert.equal(gets[0].includes("_nocache="), true, "the no-popup fallback, not the viewer-config request");
    const stored = c.records[0];
    assert.equal(stored.accessPath, "viewer");
    assert.equal(stored.magic, "%PDF");
    assert.equal(stored.ok, true);
    assert.equal(stored.sizeMatchesPortal, true);
    assert.equal(stored.endpoint, "retrieve_file_original");
    assert.equal(stored.isRendition, false);
    assert.match(stored.tag, /^%PDF-1\.4 api-/);
  }

  // D-090: on the live layout the fallback still reaches the real Web API with the page's session id,
  // a refusal is reported as an HTTP reason, and no deep case ever fetches a page link (Profile, Log Out).
  const liveCase = byName.live_origin;
  assert.equal(liveCase.success, true, liveCase.reason);
  assert.ok(liveCase.apiGets.length >= 1 && liveCase.apiGets.every((u) => u.startsWith("https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/RetrieveFile?")), liveCase.apiGets.join(" "));
  assert.equal(liveCase.apiSessionIds[0], "probe-page-session");
  assert.equal(liveCase.records[0].endpoint, "retrieve_file_original");
  const refused = byName.api_refused;
  assert.equal(refused.success, false);
  assert.equal(refused.reason, "retrieve_http_403");
  assert.equal(refused.records.length, 0);
  for (const c of r.cases) {
    const linkFetches = c.decisions.filter((d) => /^\/(User\/|WebForms\/SessionEnded)/.test(d.path));
    assert.deepEqual(linkFetches, [], `${c.name} fetched a page link`);
  }

  const blockedPosts = byName.blocked.decisions.filter((d) => d.method === "POST" && d.path === "/File/FileViewer");
  assert.ok(blockedPosts.length >= 1, "viewFile posted the viewer form");
  for (const post of blockedPosts) {
    assert.equal(post.action, "abort");
    assert.equal(post.violation, false);
    assert.equal(post.rule, "method_dropped");
  }

  const viewer = byName.viewer;
  assert.equal(viewer.success, true, viewer.reason);
  const viewerGets = viewer.apiGets.filter((u) => u.includes("/File/RetrieveFile"));
  assert.ok(viewerGets.length >= 1);
  assert.match(viewerGets[0], /\/File\/RetrieveFile\?inline=true&fileID=700301$/);
  assert.equal(viewerGets[0].includes("_nocache="), false, "a loaded WebViewer config keeps the viewer RetrieveFile path");
  assert.equal(viewer.records[0].accessPath, "viewer");
  assert.equal(viewer.records[0].magic, "%PDF");
  assert.match(viewer.records[0].tag, /api-viewer/);

  const truncated = byName.truncated;
  assert.equal(truncated.success, false);
  assert.equal(truncated.records[0].accessPath, "viewer");
  assert.equal(truncated.records[0].magic, "%PDF");
  assert.equal(truncated.records[0].ok, false);
  assert.match(truncated.records[0].error, /^truncated: /);
});

test("3c: a deep session refuses browser re-initialization and flags the session as lost", () => {
  const r = probe(["reinit"]);
  assert.match(r.error, /re-initialization is disabled/);
  assert.equal(r.closed, 0, "the guarded browser is not closed and no unguarded one is launched");
  assert.equal(r.lost, "reinitialize_refused");
  assert.equal(r.cancel, true, "the scraper loop stops at its next cancel check");
});

test("dashboard pager: default reads page 1 only; allPages tags every row; the popup pages back to the permit", (t) => {
  let r;
  try {
    r = probe(["pager"]);
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch/.test(String(e.message))) return t.skip("Chromium not installed");
    throw e;
  }
  assert.deepEqual(r.firstOnly, Array.from({ length: 10 }, (_, i) => `P${String(i + 1).padStart(4, "0")}`));
  assert.equal(r.all.length, 25);
  assert.deepEqual(r.all[14], ["P0015", "9015", 2]);
  assert.deepEqual(r.all[24], ["P0025", "9025", 3]);
  assert.equal(r.popupUrl, "https://session.planreview.dob.dc.gov/Project/Index?tab=projectStatusTab&ProjectID=9015");
  assert.equal(r.origin, "https://session.planreview.dob.dc.gov");
});
