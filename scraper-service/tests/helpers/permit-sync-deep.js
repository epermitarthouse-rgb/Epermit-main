"use strict";

/**
 * Offline stand-ins for the DC deep pass: a replayed migration chain (PGlite) with the worker rpc and the
 * deep repo over it, an in-memory private bucket, and a fake `dcDeep` whose scrapeAll produces the manual
 * scraper's session.data shape and drives the real deepOptions callbacks (lib/dc-deep-options.js).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { replay } = require("./replay-migrations");
const { REPORTS } = require("./dc-fixture-transport");
const dcDeepOptions = require("../../lib/dc-deep-options");
const { portalContentHash } = require("../../lib/portal-content-hash");

/** projects.portal_data exists in production but is not created by any migration in the chain. */
const PRODUCTION_DRIFT = ["ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS portal_data JSONB"];

async function createDeepDb() {
  const { db } = await replay({ extra: PRODUCTION_DRIFT });
  const as = (role, fn) => db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', '', true)`);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  });
  const h = {
    db,
    svc: (sql, params = []) => as("service_role", async (tx) => {
      const r = await tx.query(sql, params);
      return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
    }),
    rpc: (name, arg) => as("service_role", async (tx) => (await tx.query(`SELECT public.${name}($1::jsonb) AS out`, [JSON.stringify(arg)])).rows[0].out),
    count: async (table, where = "TRUE", params = []) => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n,
  };
  return h;
}

/** The deep repo interface (permit-sync/deep/repo.js) over PGlite, as service_role. */
function pgliteDeepRepo(h) {
  const q = async (sql, params) => (await h.db.query(sql, params)).rows;
  return {
    documents: (permitId) => q(`SELECT id, portal_file_id, file_name, size_bytes, download_permitted, download_status, storage_path, sha256 FROM permit_documents WHERE permit_id = $1 AND removed_at IS NULL`, [permitId]),
    reports: (permitId) => q(`SELECT id, report_key, name, content_status FROM permit_reports WHERE permit_id = $1 AND removed_at IS NULL`, [permitId]),
    deepState: async (permitId) => ((await q(`SELECT section_hashes FROM permit_deep_state WHERE permit_id = $1`, [permitId]))[0] || {}).section_hashes || null,
    links: async (permitId) => (await q(
      `SELECT p.id, p.user_id, p.permit_number, p.portal_data_hash, p.portal_data->'permitRepositorySync'->'section_hashes' AS synced
       FROM project_permits pp JOIN projects p ON p.id = pp.project_id WHERE pp.permit_id = $1`, [permitId],
    )).map((x) => ({ projectId: x.id, ownerUserId: x.user_id, permitNumber: x.permit_number, portalDataHash: x.portal_data_hash, syncedHashes: x.synced || null })),
    projectHash: async (projectId) => ((await q(`SELECT portal_data_hash FROM projects WHERE id = $1`, [projectId]))[0] || {}).portal_data_hash || null,
    recordDocument: (a) => h.svc(`SELECT public.record_permit_document_capture($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a.documentId, a.status, a.storagePath || null, a.sha256 || null, a.size ?? null, a.contentType || null, a.error || null, a.runId || null]),
    recordReport: (permitId, key, content, runId) => h.svc(`SELECT public.record_permit_report_content($1, $2, $3::jsonb, $4)`, [permitId, key, JSON.stringify(content), runId || null]),
    recordReportFailure: (permitId, key, error) => h.svc(`SELECT public.record_permit_report_failure($1, $2, $3)`, [permitId, key, error]),
    recordDeepPass: (permitId, hashes, runId) => h.svc(`SELECT public.record_permit_deep_pass($1, $2::jsonb, $3)`, [permitId, JSON.stringify(hashes), runId || null]),
  };
}

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    puts: [],
    async put(objectPath, { buf, sha256, size }, contentType) {
      this.puts.push(objectPath);
      objects.set(objectPath, buf);
      return { bucket: "permit-documents", path: objectPath, sha256, size, contentType };
    },
  };
}

const FILES = { "11105": [{ id: "700101", name: "A-101.pdf", status: "Approved" }, { id: "700102", name: "A-101.pdf", status: "Approved V2" }] };

/**
 * @param {object} [o]
 * @param {Function} [o.onDownload] (file, calls) => void; may throw to simulate a crash mid-pass
 * @param {string} [o.reportsError] the Reports tab fails with this error (e.g. an SSRS postback the guard drops)
 */
function fakeDcDeep(h, o = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dc-deep-"));
  const calls = { scrapes: [], downloads: [], reportExports: 0, syncs: [] };
  const write = (name, body) => {
    const p = path.join(tmp, `${crypto.randomUUID()}_${name}`);
    fs.writeFileSync(p, body);
    return p;
  };
  return {
    calls,
    DEFAULT_DASHBOARD_URL: "https://washington-dc-us.avolvecloud.com",
    deriveWebUiBase: () => "https://washington-dc-us-projectdoxwebui.avolvecloud.com",
    async scrapeAll(session, projects, _sid, tabs, supabaseProjectId, userId, _c, _tf, _tfs, _hint, deepOptions) {
      if (supabaseProjectId !== null || userId !== null) throw new Error("deep scrape must not target a project");
      if (!deepOptions || deepOptions.skipPortalSync !== true) throw new Error("deep scrape must skip the portal sync");
      if (!session.dcReloginDisabled || session.portalSubtype !== "dc-planreview") throw new Error("session is not a deep DC session");
      const project = projects[0];
      calls.scrapes.push({ permit: project.projectNum, tabs: [...tabs] });
      // Like the manual scraper: every scrape carries a new scrape time, signed URLs, temp paths and SSRS render time.
      const n = calls.scrapes.length;
      const data = { name: project.name, projectNum: project.projectNum, description: project.description, location: project.location, dashboardStatus: project.status, portalType: "projectdox", scrapedAt: new Date(Date.now() + n).toISOString(), tabs: {} };
      session.data[project.id] = data;
      for (const t of tabs) {
        if (t === "files") {
          const files = [];
          for (const f of FILES[project.projectId] || []) {
            const gate = dcDeepOptions.fileGateDecision(deepOptions, f);
            if (gate && !gate.download) {
              files.push(dcDeepOptions.gatedFileEntry(f, "Approved Drawings", gate));
              continue;
            }
            calls.downloads.push(f.id);
            if (o.onDownload) await o.onDownload(f, calls);
            const ref = await deepOptions.storeFile({ localPath: write(f.name, `body-${f.id}`), fileId: f.id, fileName: f.name });
            files.push({ name: f.name, fileId: f.id, viewUrl: `https://example.invalid/sign/${f.id}?token=t${n}`, downloadStatus: ref ? "success" : "failed", ...(ref ? { storageRef: ref } : {}) });
          }
          data.tabs.files = { keyValues: [], tables: [], links: [], folders: [{ name: "Approved Drawings", files }] };
        } else if (t === "reports" && o.reportsError) {
          data.tabs.reports = { error: o.reportsError };
        } else if (t === "reports") {
          const pdfs = [];
          for (const r of REPORTS) {
            calls.reportExports += 1;
            const ref = await deepOptions.storeReportArtifact({ localPath: write("r.pdf", `pdf ${r.name}`), kind: "pdf", reportName: r.name });
            pdfs.push({ fileName: r.name, text: `${r.name} for ${project.projectNum}\nGenerated:  11/11/2026 ${(n % 12) + 1}:0${n % 10} PM`, pages: 1, screenshot: `b64-${n}`, pdfPath: `/tmp/wa_report_${n}.pdf`, ...(ref ? { pdfStorageRef: ref } : {}) });
          }
          data.tabs.reports = { keyValues: [], tables: [], links: [], pdfs };
        } else {
          data.tabs[t] = { keyValues: [{ key: "Status", value: project.status }], tables: [], links: [] };
        }
      }
      session.status = "done";
      return { deep: true };
    },
    /** The real sync's contentHash rule (D-072; the real function is covered by the closure probe). */
    async syncPortalDataToSupabase(session, projects, projectId, userId, _tf, opts) {
      if (!opts || opts.forbidInsert !== true || opts.skipCredentialRepoint !== true) throw new Error("deep sync must forbid inserts and credential re-points");
      if (opts.contentHash !== true) throw new Error("deep sync must hash permit content only");
      const data = session.data[projects[0].id];
      calls.syncs.push({ projectId, userId });
      const row = (await h.db.query(`SELECT portal_data, portal_data_hash FROM projects WHERE id = $1`, [projectId])).rows[0];
      if (!row) return false;
      const merged = { ...(row.portal_data || {}), ...data, tabs: { ...((row.portal_data && row.portal_data.tabs) || {}), ...data.tabs } };
      const hash = portalContentHash(merged);
      if (row.portal_data_hash === hash || (row.portal_data && portalContentHash(row.portal_data) === hash)) {
        await h.db.query(`UPDATE projects SET portal_data = jsonb_set(coalesce(portal_data, '{}'::jsonb), '{permitRepositorySync}', $2::jsonb) WHERE id = $1`, [projectId, JSON.stringify(data.permitRepositorySync || null)]);
        return true;
      }
      const r = await h.db.query(`UPDATE projects SET portal_data = $2::jsonb, portal_data_hash = $3 WHERE id = $1 RETURNING id`, [projectId, JSON.stringify(merged), hash]);
      return r.rows.length === 1;
    },
  };
}

/** Transport surface the deep runner uses, over the offline fixture transport. */
function fakeDeepTransport(fixture) {
  const page = { url: () => "https://planreview.dob.dc.gov/", isClosed: () => false };
  return {
    ...fixture,
    mode: "deep",
    context: {},
    assertHealthy() {
      const v = fixture.guard.violations();
      if (v.length) throw Object.assign(new Error("guard violation"), { code: "safety_violation" });
    },
    dashboardPage: async () => page,
    adoptDashboard() {},
    ownsPage: (p) => p === page,
    withAuthPhase: (fn) => fn(),
    close: async () => {},
  };
}

module.exports = { createDeepDb, pgliteDeepRepo, memoryStorage, fakeDcDeep, fakeDeepTransport, FILES };
