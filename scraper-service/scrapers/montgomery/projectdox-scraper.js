/**
 * Montgomery County MD — Avolve ProjectDox / ProjectDoxWebUI harvester.
 *
 * Clones the PGC *pipeline shell* (detail → files → reports); reuses PGC SSRS helpers
 * (exportReportFormat, viewer wait, etc.) without changing PGC scraper behavior.
 */

const fs = require("fs");
const path = require("path");
const pgc = require("../../pgc-eplan-scraper");

const MONTGOMERY_HOST_MARKER = "montgomeryco-md-us.avolvecloud.com";

const DEFAULT_MONTGOMERY_WEBUI =
  process.env.MONTGOMERY_WEBUI_BASE?.trim().replace(/\/$/, "") ||
  "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com";

const TASK8_REPORT_POST_NAV_MS = 3500;

/** SSRS report specs (names must match grid labels; paths are MontgomeryCountyProd). */
const MONTGOMERY_REPORT_SPECS = [
  {
    fileSlug: "plan-review-discussion-board",
    reportName: "Plan Review - Discussion Board Plan Review",
    reportPath:
      "/MontgomeryCountyProd/ProjectDox/Plan Review - Discussion Board Plan Review",
  },
  {
    fileSlug: "plan-review-comments",
    reportName: "Plan Review - Review Comments",
    reportPath: "/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments",
  },
  {
    fileSlug: "plan-review-details",
    reportName: "Plan Review - Review Details",
    reportPath: "/MontgomeryCountyProd/ProjectDox/Plan Review - Review Details",
  },
  {
    fileSlug: "workflow-routing-slip",
    reportName: "Plan Review - Workflow Routing Slip",
    reportPath:
      "/MontgomeryCountyProd/ProjectDox/Plan Review - Workflow Routing Slip",
    reportId: "135",
  },
];

const MONTGOMERY_TARGET_REPORT_NAMES = MONTGOMERY_REPORT_SPECS.map(
  (s) => s.reportName,
);

/** Visible Montgomery Status tab summary rows only (excludes merged DOM bleed rows). */
const MONTGOMERY_STATUS_SUMMARY_FIELD_KEYS = [
  "Review Type",
  "Owner",
  "Total Number of Files",
  "Days Calculated as",
  "Time Elapsed",
  "Current Non-Completed Tasks",
];

const DISCUSSION_LEAK = /\b(discuss|discussion\s*board|discussion\s*thread|message\s*thread|forum)\b/i;

/** Task / workflow grid column labels — must never appear as Info metadata keys. */
const MONTGOMERY_INFO_KEY_BLOCKLIST = new Set(
  [
    "action",
    "assignee",
    "assignment type",
    "due",
    "due date",
    "task",
    "tasks",
    "state",
    "workflow",
    "department",
    "coordinator",
    "group",
    "step name",
    "process",
    "integration",
    "changemark",
    "reference",
    "project",
  ].map((s) => s.toLowerCase()),
);

/**
 * @param {string} key
 */
function montgomeryInfoKeyIsNoise(key) {
  const k = String(key || "")
    .replace(/:\s*$/, "")
    .trim()
    .toLowerCase();
  if (!k) return true;
  if (DISCUSSION_LEAK.test(k)) return true;
  if (MONTGOMERY_INFO_KEY_BLOCKLIST.has(k)) return true;
  if (/^report\b/i.test(k)) return true;
  return false;
}

/** PGC-style: single display key (no trailing colon). */
function normalizeMontgomeryInfoKeyLabel(label) {
  return String(label || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/:\s*$/, "")
    .trim();
}

/**
 * Drop mistaken values that repeat the field label (DOM/table bleed).
 * @param {string} keyNorm
 * @param {string} value
 */
function montgomeryInfoSanitizeValue(keyNorm, value) {
  let v = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const k = keyNorm.toLowerCase();
  const stripped = v.replace(/:\s*$/, "").trim().toLowerCase();
  if (stripped === k) return "";
  return v;
}

/**
 * Status cell often includes adjacent "Current Application Info" link text.
 * @param {string} value
 */
function montgomeryInfoCleanStatusValue(value) {
  return String(value || "")
    .replace(/\s*Current Application Info\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge duplicate keys (e.g. table row + label[for]); prefer first non-empty value per key.
 * Same row order as first occurrence of each key.
 * @param {{ label: string, value: string }[]} pairs
 * @returns {{ normalized: { key: string, value: string }[], statusStripped: boolean }}
 */
function normalizeMontgomeryInfoPairs(pairs) {
  /** @type {Map<string, number>} */
  const indexByKey = new Map();
  /** @type {{ key: string, value: string }[]} */
  const out = [];
  let statusStripped = false;

  for (const p of pairs) {
    const key = normalizeMontgomeryInfoKeyLabel(p.label);
    if (!key) continue;
    const kl = key.toLowerCase();
    let val = montgomeryInfoSanitizeValue(key, p.value);

    if (kl === "status") {
      const before = val;
      val = montgomeryInfoCleanStatusValue(val);
      if (before !== val) statusStripped = true;
    }

    if (indexByKey.has(kl)) {
      const idx = indexByKey.get(kl);
      const cur = out[idx].value;
      if (!cur && val) out[idx] = { key: out[idx].key, value: val };
      continue;
    }
    indexByKey.set(kl, out.length);
    out.push({ key, value: val });
  }

  return { normalized: out, statusStripped };
}

/**
 * PGC guarded info pattern: one 2-column table derived only from normalized pairs.
 * @param {{ key: string, value: string }[]} rows
 */
function buildMontgomeryInfoFieldValueTable(rows) {
  if (!rows.length) return [];
  return [
    {
      headers: ["Field", "Value"],
      rows: rows.map((r) => ({
        Field: r.key,
        Value: r.value != null && r.value !== "" ? String(r.value) : "",
      })),
    },
  ];
}

/**
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 */
async function waitForMontgomeryTabProjectInfoHydrated(page, timeoutMs = 28000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const f of frames) {
      try {
        const ok = await f.evaluate(() => {
          const root = document.querySelector("#TabProjectInfo");
          if (!root) return false;
          const st = window.getComputedStyle(root);
          if (st.display === "none" || st.visibility === "hidden") return false;
          const r = root.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return false;
          if (root.querySelector(".ui-iggrid")) return false;
          return !!(
            root.querySelector("label[for], .form-group, dl dt, input:not([type=hidden]), textarea, select") ||
            (root.textContent && root.textContent.trim().length > 40)
          );
        });
        if (ok) return true;
      } catch (_) {}
    }
    await page.waitForTimeout(400);
  }
  return false;
}

/**
 * @param {string} [url]
 */
function isMontgomeryProjectDoxHost(url) {
  if (!url || typeof url !== "string") return false;
  return url.toLowerCase().includes(MONTGOMERY_HOST_MARKER);
}

/**
 * @param {import('playwright').Page} page
 */
async function resolveMontgomeryWebUiBases(page) {
  const out = [];
  const env = process.env.MONTGOMERY_WEBUI_BASE?.trim();
  if (env) out.push(env.replace(/\/$/, ""));
  out.push(DEFAULT_MONTGOMERY_WEBUI);
  let portalOrigin = "";
  try {
    portalOrigin = new URL(page.url()).origin;
  } catch (_) {}
  if (portalOrigin) out.push(portalOrigin.replace(/\/$/, ""));
  return [...new Set(out.filter(Boolean))];
}

function buildMontgomeryProjectTabUrl(webUiBase, projectID, tabName, extraParams = "") {
  const origin = (webUiBase || DEFAULT_MONTGOMERY_WEBUI).replace(/\/$/, "");
  const base = `${origin}/Project/Index?tab=${encodeURIComponent(tabName)}&ProjectID=${encodeURIComponent(String(projectID))}`;
  return extraParams ? `${base}&${extraParams}` : base;
}

/**
 * @param {import('playwright').Page} page
 */
async function getMontgomeryContentTarget(page) {
  await page.waitForTimeout(200);
  const frames = page.frames();
  for (const f of frames) {
    try {
      const u = f.url();
      if (/Project\/Index/i.test(u) && f !== page.mainFrame()) return f;
    } catch (_) {}
  }
  const byMatch = page.frames().filter((fr) => /Frame\.aspx/i.test(fr.url()));
  if (byMatch.length) return byMatch[byMatch.length - 1];
  return page;
}

/**
 * Tab panels (#projectStatusTab / #infoTab / #tasksTab) often live in Frame.aspx, not the top document.
 * Pick the frame whose DOM has the richest tab content for this step.
 * @param {import('playwright').Page} page
 * @param {"status"|"info"|"tasks"} which
 */
async function getMontgomeryDomTarget(page, which) {
  if (which === "info") {
    await page.waitForTimeout(400);
    const frames = page.frames();
    /** @type {{ f: import('playwright').Frame, score: number }[]} */
    const ranked = [];
    for (const f of frames) {
      try {
        const score = await f.evaluate(() => {
          const root = document.querySelector("#TabProjectInfo");
          if (!root) return 0;
          const st = window.getComputedStyle(root);
          if (st.display === "none" || st.visibility === "hidden") return 0;
          const r = root.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return 0;
          if (root.querySelector(".ui-iggrid")) return 0;
          let s = 100;
          s += root.querySelectorAll("label[for]").length * 8;
          s += root.querySelectorAll(".form-group, dl dt").length * 5;
          s += root.querySelectorAll("input:not([type=hidden]), textarea, select").length * 3;
          return s;
        });
        ranked.push({ f, score });
      } catch (_) {
        ranked.push({ f, score: 0 });
      }
    }
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && best.score >= 100) return best.f;
    for (const { f } of ranked) {
      try {
        const has = await f.evaluate(() => !!document.querySelector("#TabProjectInfo"));
        if (has) return f;
      } catch (_) {}
    }
    return page.mainFrame();
  }

  const hints =
    which === "status"
      ? ["#projectStatusTab", "#ProjectStatusTab", "[id*='projectStatus']", "[id*='ProjectStatus']"]
      : ["#tasksTab", "#TasksTab", "[id*='tasksTab']", "[id*='Tasks']"];
  await page.waitForTimeout(400);
  const frames = page.frames();
  /** @type {{ f: import('playwright').Frame, score: number }[]} */
  const ranked = [];
  for (const f of frames) {
    try {
      const score = await f.evaluate((selHints) => {
        function isVisible(el) {
          if (!el || !(el instanceof Element)) return false;
          const st = window.getComputedStyle(el);
          if (!st || st.display === "none" || st.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function pickPanelAny() {
          for (const h of selHints) {
            try {
              const el = document.querySelector(h);
              if (el) return el;
            } catch (_) {}
          }
          return null;
        }
        function pickVisiblePanel() {
          for (const h of selHints) {
            try {
              const el = document.querySelector(h);
              if (el && isVisible(el)) return el;
            } catch (_) {}
          }
          return null;
        }
        // Match extractMontgomeryStatusTab / tasks extract: inactive tab panels stay in the DOM with
        // rows that are not visible. Scoring must not prefer those over a frame with real visible data.
        const panel = pickVisiblePanel() || pickPanelAny() || document.body;
        if (!panel) return 0;
        let tr = 0;
        panel
          .querySelectorAll("tr, .ui-iggrid-table tbody tr, .ui-iggrid-row, [role='row']")
          .forEach((row) => {
            if (isVisible(row)) tr++;
          });
        let dl = 0;
        panel.querySelectorAll("dl dt, .form-group").forEach((el) => {
          if (isVisible(el)) dl++;
        });
        const txt = isVisible(panel) ? (panel.innerText || "").length : 0;
        return tr * 8 + dl * 6 + Math.min(txt, 12000) / 15;
      }, hints);
      ranked.push({ f, score });
    } catch (_) {
      ranked.push({ f, score: 0 });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0]?.f;
  return best || page.mainFrame();
}

/**
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 * @param {string} tabName
 * @param {string} [extraParams]
 */
async function gotoMontgomeryTab(page, webUiBase, projectID, tabName, extraParams = "") {
  const url = buildMontgomeryProjectTabUrl(webUiBase, projectID, tabName, extraParams);
  console.log(`[Montgomery][nav] ${tabName} → ${url.slice(0, 120)}…`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  await page
    .waitForSelector(
      "body, #projectStatusTab, #infoTab, #tasksTab, #filesTab, #reportsTab, .ui-iggrid, table",
      { timeout: 20000 },
    )
    .catch(() => {});
}

function normalizeMontgomeryStatusSummaryKey(key) {
  return String(key || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/:\s*$/, "")
    .trim();
}

function isMontgomeryMergedStatusReviewTypeBlob(value) {
  const v = String(value || "");
  return /\bOwner:\s*/i.test(v) && /Total Number of Files/i.test(v);
}

function cleanMontgomeryStatusSummaryValue(keyLower, value) {
  let v = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (keyLower === "review type" && isMontgomeryMergedStatusReviewTypeBlob(v)) {
    const m = v.match(/^(.+?)(?=\s+Owner:\s+)/i);
    if (m) return m[1].trim();
  }
  return v;
}

/**
 * Keep only the six real summary fields; drop noisy/extra rows and fix merged "Review Type" bleed.
 * @param {{ key: string, value: string }[]} rows
 */
function filterMontgomeryStatusSummaryKeyValues(rows) {
  const allow = MONTGOMERY_STATUS_SUMMARY_FIELD_KEYS;
  const allowLc = new Set(allow.map((k) => k.toLowerCase()));
  /** @type {Map<string, { key: string, value: string }>} */
  const best = new Map();
  for (const kv of rows) {
    const nk = normalizeMontgomeryStatusSummaryKey(kv.key);
    const kl = nk.toLowerCase();
    if (!allowLc.has(kl)) continue;
    const canon = allow.find((a) => a.toLowerCase() === kl) || nk;
    const value = cleanMontgomeryStatusSummaryValue(kl, String(kv.value || ""));
    const cur = best.get(kl);
    if (!cur) {
      best.set(kl, { key: canon, value });
      continue;
    }
    const preferNew =
      (isMontgomeryMergedStatusReviewTypeBlob(cur.value) &&
        !isMontgomeryMergedStatusReviewTypeBlob(value)) ||
      (!cur.value && value) ||
      (cur.value &&
        value &&
        isMontgomeryMergedStatusReviewTypeBlob(cur.value) &&
        value.length < cur.value.length);
    if (preferNew) best.set(kl, { key: canon, value });
  }
  return allow
    .map((label) => best.get(label.toLowerCase()))
    .filter((x) => x != null && String(x.value ?? "").trim().length > 0);
}

/**
 * Status first: summary fields + routing slip hooks + WFlowInstanceID from DOM.
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {{ projectID: string, webUiBase: string }} ctx
 */
async function extractMontgomeryStatusTab(target, ctx) {
  const projectID = String(ctx?.projectID || "");
  const webUiBase = String(ctx?.webUiBase || "");

  const fromPanel = await target.evaluate(() => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function addKv(key, value, seen, keyValues) {
      const k = norm(key).replace(/:\s*$/, "");
      const v = norm(value);
      if (!k || k.length > 220 || v.length > 4000) return;
      const sig = `${k}::${v}`.toLowerCase();
      if (seen.has(sig)) return;
      seen.add(sig);
      keyValues.push({ key: k, value: v });
    }
    const panel =
      document.querySelector("#projectStatusTab") ||
      document.querySelector("#ProjectStatusTab") ||
      document.querySelector("[id*='projectStatus']") ||
      document.querySelector("[id*='ProjectStatus']") ||
      document.body;

    /** @type {{ key: string, value: string }[]} */
    const keyValues = [];
    const seen = new Set();

    panel.querySelectorAll("table tr").forEach((tr) => {
      if (!isVisible(tr)) return;
      const cells = tr.querySelectorAll("td, th");
      if (cells.length < 2) return;
      const key = norm(cells[0].textContent).replace(/:\s*$/, "");
      const value = norm(
        Array.from(cells)
          .slice(1)
          .map((c) => c.textContent)
          .join(" "),
      );
      addKv(key, value, seen, keyValues);
    });

    panel.querySelectorAll("dl dt").forEach((dt) => {
      let dd = dt.nextElementSibling;
      if (dd && dd.tagName.toLowerCase() !== "dd") dd = dd.querySelector("dd");
      if (!dd || dd.tagName.toLowerCase() !== "dd") return;
      addKv(dt.textContent, dd.textContent, seen, keyValues);
    });

    panel.querySelectorAll(".form-group, .row").forEach((row) => {
      if (!isVisible(row)) return;
      const lab = row.querySelector("label, .control-label, span.label");
      const inp = row.querySelector(
        "input:not([type=hidden]), textarea, select, .form-control, span:not(.label)",
      );
      if (lab && inp) {
        const v =
          inp.tagName === "INPUT" || inp.tagName === "TEXTAREA" || inp.tagName === "SELECT"
            ? (/** @type {HTMLInputElement} */ (inp)).value || inp.textContent || ""
            : norm(inp.textContent);
        addKv(lab.textContent, v, seen, keyValues);
      }
    });

    /** @type {{ text: string, href: string, onclick: string }[]} */
    const links = [];
    panel.querySelectorAll("a[href], a[onclick], span[onclick], button[onclick]").forEach((a) => {
      if (!isVisible(a)) return;
      const href = a.getAttribute("href") || "";
      const onclick = a.getAttribute("onclick") || "";
      const pool = `${href} ${onclick}`;
      if (
        /viewRoutingSlip|ReportViewer|Frame\.aspx|Workflow Routing/i.test(pool) ||
        /routing slip|view report/i.test(norm(a.textContent))
      ) {
        links.push({
          text: norm(a.textContent).slice(0, 200),
          href,
          onclick,
        });
      }
    });

    let inlineWf = null;
    try {
      const w = window;
      const cand = w.WFlowInstanceID ?? w.wFlowInstanceID;
      if (cand != null && String(cand).trim() !== "") inlineWf = String(cand).trim();
    } catch (_) {}

    let hiddenWf = null;
    panel.querySelectorAll('input[type="hidden"]').forEach((inp) => {
      if (hiddenWf) return;
      const nm = `${inp.getAttribute("name") || ""} ${inp.getAttribute("id") || ""}`;
      if (!/wflow/i.test(nm)) return;
      const val = (inp.value || "").trim();
      if (/^\d{3,}$/.test(val)) hiddenWf = val;
    });

    return { keyValues, links, inlineWf, hiddenWf };
  });

  const bodyHtml = await target
    .evaluate(() => document.documentElement?.innerHTML || "")
    .catch(() => "");
  const fromHtml = extractWFlowInstanceIdsFromHtml(bodyHtml);
  let wflowFromDom =
    fromPanel.inlineWf ||
    fromPanel.hiddenWf ||
    fromHtml[0] ||
    null;
  if (!wflowFromDom) {
    const pool = `${bodyHtml} ${JSON.stringify(fromPanel.links)}`;
    const m = pool.match(/WFlowInstanceID[=](\d+)/i) || pool.match(/WFlowInstanceID%3D(\d+)/i);
    if (m) wflowFromDom = m[1];
  }

  const kvsRaw = fromPanel.keyValues.map((kv) => ({
    key: String(kv.key || ""),
    value: String(kv.value || ""),
  }));
  console.log(`[Montgomery][status] extracted kv count=${kvsRaw.length}`);
  const kvsDeduped = dedupeMontgomeryStatusKeyValues(kvsRaw);
  const kvs = filterMontgomeryStatusSummaryKeyValues(kvsDeduped);
  console.log(`[Montgomery][status] deduped kv count=${kvs.length}`);

  /** @type {object[]} */
  const linksFlat = [];
  for (const L of fromPanel.links) {
    const text = String(L.text || "");
    const pool = `${L.href || ""} ${L.onclick || ""}`;
    const matchesAction =
      /viewRoutingSlip/i.test(pool) ||
      /workflow routing slip/i.test(text) ||
      /view report/i.test(text);
    if (!matchesAction) continue;
    const base = {
      text: text.slice(0, 200),
      href: L.href && !/^javascript:/i.test(L.href) ? L.href : "",
      ...(L.onclick && String(L.onclick).trim() ? { onclick: String(L.onclick) } : {}),
    };
    const extras = {
      hasResolved: false,
      ...(wflowFromDom ? { linkWflowInstanceID: wflowFromDom } : {}),
    };
    if (/workflow routing slip/i.test(text)) {
      linksFlat.push({
        ...base,
        ...extras,
        reportName: "Plan Review - Workflow Routing Slip",
      });
    } else if (/view report/i.test(text)) {
      linksFlat.push({
        ...base,
        ...extras,
        reportName: "View Report",
      });
    } else if (/viewRoutingSlip/i.test(pool)) {
      linksFlat.push({
        ...base,
        ...extras,
        reportName: /routing slip/i.test(text)
          ? "Plan Review - Workflow Routing Slip"
          : "View Report",
      });
    }
  }

  const hasRoutingSlipControl = fromPanel.links.some(
    (L) =>
      /viewRoutingSlip/i.test(L.onclick || "") ||
      /viewRoutingSlip/i.test(L.href || "") ||
      /Workflow Routing Slip|routing slip/i.test(L.text || ""),
  );

  const statusTables =
    kvs.length > 0
      ? [
          {
            headers: ["Field", "Value"],
            rows: kvs.map((kv) => ({ Field: kv.key, Value: kv.value })),
          },
        ]
      : [];

  const metaWf = wflowFromDom;

  console.log(`[Montgomery][status] links count=${linksFlat.length}`);
  console.log(`[Montgomery][status] resolved wflowInstanceID = ${metaWf || "(none)"}`);

  return {
    keyValues: kvs,
    tables: statusTables,
    sections: [],
    links: linksFlat,
    meta: {
      wflowInstanceID: metaWf || undefined,
      routingSlipAvailable: false,
      initialStatusCaptured: true,
    },
  };
}

/**
 * Project metadata only: scoped to `#TabProjectInfo` (final ProjectInfo state). No page-level scrape.
 * @param {import('playwright').Page | import('playwright').Frame} target
 * @param {{ finalStateConfirmed?: boolean, frameUrlShort?: string }} [ctx]
 */
async function extractMontgomeryInfoTab(target, ctx = {}) {
  const raw = await target.evaluate(() => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function pushPair(pairs, seen, label, value) {
      const lab = norm(label).replace(/:\s*$/, "");
      const val = norm(value);
      if (!lab || lab.length > 220 || val.length > 8000) return;
      const sig = `${lab}::${val}`.toLowerCase();
      if (seen.has(sig)) return;
      seen.add(sig);
      pairs.push({ label: lab, value: val });
    }

    const root = document.querySelector("#TabProjectInfo");
    if (!root) {
      return {
        pairs: [],
        rootFound: false,
        rootVisible: false,
      };
    }
    const st = window.getComputedStyle(root);
    const r = root.getBoundingClientRect();
    const rootVisible =
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      r.width > 1 &&
      r.height > 1;

    /** @type {{ label: string, value: string }[]} */
    const pairs = [];
    const seen = new Set();

    root.querySelectorAll("table").forEach((table) => {
      if (!isVisible(table) || table.closest(".ui-iggrid")) return;
      table.querySelectorAll("tr").forEach((tr) => {
        if (!isVisible(tr)) return;
        const cells = tr.querySelectorAll("td, th");
        if (cells.length < 2) return;
        const label = norm(cells[0].textContent);
        const value = norm(
          Array.from(cells)
            .slice(1)
            .map((c) => c.textContent)
            .join(" "),
        );
        pushPair(pairs, seen, label, value);
      });
    });

    root.querySelectorAll("dl dt").forEach((dt) => {
      if (!isVisible(dt)) return;
      let dd = dt.nextElementSibling;
      if (dd && dd.tagName.toLowerCase() !== "dd") dd = dd.querySelector("dd");
      if (dd && dd.tagName.toLowerCase() === "dd" && isVisible(dd)) {
        pushPair(pairs, seen, dt.textContent, dd.textContent);
      }
    });

    root
      .querySelectorAll(
        ".form-group, .row, .field, [class*='form-group'], [class*='FormGroup']",
      )
      .forEach((row) => {
        if (!isVisible(row) || row.closest(".ui-iggrid")) return;
        const lab = row.querySelector("label, .control-label, span.label");
        const inp = row.querySelector(
          "input:not([type=hidden]), textarea, select, .form-control, span.form-control, .readonly-display, [class*='display-field']",
        );
        if (lab && inp && isVisible(lab)) {
          const v =
            inp.tagName === "INPUT" ||
            inp.tagName === "TEXTAREA" ||
            inp.tagName === "SELECT"
              ? (/** @type {HTMLInputElement} */ (inp)).value ||
                inp.getAttribute("value") ||
                inp.textContent ||
                ""
              : norm(inp.textContent);
          pushPair(pairs, seen, lab.textContent, v);
        }
      });

    root.querySelectorAll("label[for]").forEach((lab) => {
      if (!isVisible(lab)) return;
      const fid = lab.getAttribute("for");
      if (!fid) return;
      let inp = null;
      try {
        inp = root.querySelector(`#${CSS.escape(fid)}`);
      } catch (_) {}
      if (!inp) inp = document.getElementById(fid);
      if (!inp || !(inp instanceof Element) || !isVisible(inp)) return;
      let v = "";
      if (
        inp instanceof HTMLInputElement ||
        inp instanceof HTMLTextAreaElement ||
        inp instanceof HTMLSelectElement
      ) {
        v = inp.value || inp.getAttribute("value") || "";
      } else {
        v = norm(inp.textContent);
      }
      pushPair(pairs, seen, lab.textContent, v);
    });

    return { pairs, rootFound: true, rootVisible };
  });

  let filteredNoise = 0;
  const filteredPairs = raw.pairs.filter((p) => {
    const blob = `${p.label} ${p.value}`;
    if (DISCUSSION_LEAK.test(blob)) {
      filteredNoise++;
      return false;
    }
    if (montgomeryInfoKeyIsNoise(p.label)) {
      filteredNoise++;
      return false;
    }
    return true;
  });

  const { normalized, statusStripped } = normalizeMontgomeryInfoPairs(filteredPairs);
  const projectInfo = normalized.map((r) => ({ key: r.key, value: r.value }));
  const keyValues = projectInfo.map((kv) => ({ key: kv.key, value: kv.value }));
  const tablesOut = buildMontgomeryInfoFieldValueTable(normalized);

  console.log(`[Montgomery][info] normalized pairs count=${normalized.length}`);
  console.log(`[Montgomery][info] wrote clean tables count=${tablesOut.length}`);
  console.log(
    `[Montgomery][info] status cleaned from link text: ${statusStripped ? "yes" : "no"}`,
  );

  return {
    projectInfo,
    keyValues,
    tables: tablesOut,
    info_debug: {
      infoRoot: "#TabProjectInfo",
      rootFound: !!raw.rootFound,
      rootVisible: !!raw.rootVisible,
      finalStateConfirmed: !!ctx.finalStateConfirmed,
      filteredNoiseCount: filteredNoise,
      statusLinkStripped: statusStripped,
      frameUrlShort: ctx.frameUrlShort || null,
    },
  };
}

/**
 * @param {import('playwright').Page | import('playwright').Frame} target
 */
async function extractMontgomeryTasksTab(target) {
  const pack = await target.evaluate(() => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function classifyTitle(headers) {
      const hj = headers.join(" ").toLowerCase();
      if (
        /workflow|department|coordinator|integration|step name|process/i.test(hj) &&
        !/\btask\b.*\bassignee\b/i.test(hj)
      ) {
        return "Workflows";
      }
      if (/\btask\b|\bassignee\b|\bstate\b|\bdue\b|due date/i.test(hj)) return "Tasks";
      if (/workflow/i.test(hj)) return "Workflows";
      return "Tasks";
    }
    function extractFromTable(table) {
      const thead = table.querySelector("thead tr, .ui-iggrid-headtable tr");
      let headers = thead
        ? Array.from(thead.querySelectorAll("th, td")).map((c) => norm(c.textContent))
        : [];
      let bodyRows = Array.from(
        table.querySelectorAll("tbody tr, .ui-iggrid-table tbody tr"),
      ).filter(isVisible);
      if (!bodyRows.length) {
        bodyRows = Array.from(table.querySelectorAll("tr")).filter(
          (tr) => isVisible(tr) && tr.querySelector("td"),
        );
      }
      if (!headers.length && bodyRows.length) {
        const first = bodyRows[0];
        const cells = Array.from(first.querySelectorAll("th, td")).map((c) => norm(c.textContent));
        if (first.querySelector("th") || cells.every((c) => c.length < 40)) {
          headers = cells;
          bodyRows = bodyRows.slice(1);
        }
      }
      if (!headers.some(Boolean)) return null;
      const title = classifyTitle(headers);
      const rows = [];
      for (const tr of bodyRows) {
        if (tr.querySelector("th") && !tr.querySelector("td")) continue;
        const cells = Array.from(tr.querySelectorAll("td, th")).map((c) => norm(c.textContent));
        if (!cells.some(Boolean)) continue;
        /** @type {Record<string,string>} */
        const row = {};
        headers.forEach((h, i) => {
          row[h || `col${i}`] = cells[i] ?? "";
        });
        rows.push(row);
      }
      return rows.length ? { title, headers, rows } : null;
    }

    const panel =
      document.querySelector("#tasksTab") ||
      document.querySelector("#TasksTab") ||
      document.querySelector("[id*='tasksTab']") ||
      document.body;

    /** @type {{ title: string, headers: string[], rows: Record<string,string>[] }[]} */
    const out = [];

    panel.querySelectorAll("table, .ui-iggrid-table").forEach((table) => {
      if (!isVisible(table)) return;
      const block = extractFromTable(table);
      if (block) out.push(block);
    });

    const grids = panel.querySelectorAll(".ui-iggrid");
    grids.forEach((grid) => {
      if (!isVisible(grid)) return;
      const inner = grid.querySelector(".ui-iggrid-table") || grid;
      const block = extractFromTable(inner);
      if (block) out.push(block);
    });

    const uniq = [];
    const sigs = new Set();
    for (const b of out) {
      const s = `${b.title}::${b.headers.join("|")}::${b.rows.length}`;
      if (sigs.has(s)) continue;
      sigs.add(s);
      uniq.push(b);
    }
    return uniq;
  });

  const workflowTables = pack.filter((t) => t.title === "Workflows");
  const taskTables = pack.filter((t) => t.title === "Tasks");

  const tasksTables = [];
  for (const t of taskTables) {
    tasksTables.push({ headers: t.headers, rows: t.rows, title: "Tasks" });
  }
  for (const t of workflowTables) {
    tasksTables.push({ headers: t.headers, rows: t.rows, title: "Workflows" });
  }

  /** Map first tasks grid to legacy `tasks` array for mapper fallback */
  const primaryTasks = taskTables[0];
  const tasks = primaryTasks
    ? primaryTasks.rows.map((r) => {
        const keys = Object.keys(r);
        const lower = keys.map((k) => k.toLowerCase());
        const pick = (pred) => {
          const i = lower.findIndex(pred);
          return i >= 0 ? String(r[keys[i]] ?? "") : "";
        };
        return {
          taskName: pick((k) => /task|name|description/i.test(k)) || pick(() => true),
          assignee: pick((k) => /assign|owner|user/i.test(k)),
          state: pick((k) => /state|status/i.test(k)),
          dueDate: pick((k) => /due|date/i.test(k)),
        };
      })
    : [];

  return {
    tasks,
    tables: tasksTables,
    workflowKeyValues: [],
    workflowState: null,
  };
}

/**
 * @param {any} statusTab
 */
/**
 * Click Workflow Routing Slip / View Report in the status frame; capture popup or main-frame ReportViewer URL.
 * Mutates statusTab.links and statusTab.meta in place.
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 * @param {any} statusTab
 */
async function enrichMontgomeryStatusTabWithViewerUrls(page, webUiBase, projectID, statusTab) {
  if (!statusTab?.links?.length) return;
  const slipIndices = [];
  statusTab.links.forEach((L, i) => {
    if (/viewRoutingSlip/i.test(String(L.onclick || ""))) slipIndices.push(i);
  });
  if (!slipIndices.length) return;

  for (let j = 0; j < slipIndices.length; j++) {
    const i = slipIndices[j];
    const L = statusTab.links[i];
    const label = String(L.text || "").trim();
    console.log(`[Montgomery][status-pdf] clicked status action: ${label || `link[${j}]`}`);

    await gotoMontgomeryTab(page, webUiBase, projectID, "projectStatusTab");
    await page.waitForTimeout(700);
    const frame = await getMontgomeryDomTarget(page, "status");
    const context = page.context();
    const popupPromise = context.waitForEvent("page", { timeout: 18000 }).catch(() => null);

    const clicked = await frame
      .evaluate((routingSlipIndex) => {
        const nodes = Array.from(
          document.querySelectorAll("a[onclick], span[onclick], button[onclick]"),
        ).filter((el) => /viewRoutingSlip/i.test(el.getAttribute("onclick") || ""));
        if (routingSlipIndex < 0 || routingSlipIndex >= nodes.length) return false;
        /** @type {HTMLElement} */ (nodes[routingSlipIndex]).click();
        return true;
      }, j)
      .catch(() => false);

    if (!clicked) {
      console.log("[Montgomery][status-pdf] popup detected: no");
      const orphan = await popupPromise;
      if (orphan && !orphan.isClosed()) await orphan.close().catch(() => {});
      console.log("[Montgomery][status-pdf] final viewerUrl = (none)");
      console.log("[Montgomery][status-pdf] wflowInstanceID = (none)");
      L.hasResolved = false;
      continue;
    }

    const popup = await popupPromise;
    let finalUrl = "";

    if (popup && !popup.isClosed()) {
      console.log("[Montgomery][status-pdf] popup detected: yes");
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 18000 }).catch(() => {});
        await page.waitForTimeout(1200);
        finalUrl = popup.url();
      } catch (_) {}
      await popup.close().catch(() => {});
    } else {
      console.log("[Montgomery][status-pdf] popup detected: no");
      await page.waitForURL(/ReportViewer\.aspx/i, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1200);
      finalUrl = page.url();
      if (!/ReportViewer\.aspx/i.test(finalUrl)) {
        for (const f of page.frames()) {
          try {
            const u = f.url();
            if (/ReportViewer\.aspx/i.test(u)) {
              finalUrl = u;
              break;
            }
          } catch (_) {}
        }
      }
    }

    const short = finalUrl.length > 220 ? `${finalUrl.slice(0, 220)}…` : finalUrl;
    console.log(`[Montgomery][status-pdf] final viewerUrl = ${short || "(none)"}`);

    if (/ReportViewer\.aspx/i.test(finalUrl)) {
      const wf = pgc.extractWFlowInstanceIdFromViewerUrl(finalUrl);
      L.resolvedViewerUrl = finalUrl;
      L.reportUrl = finalUrl;
      L.viewerUrl = finalUrl;
      L.hasResolved = true;
      if (wf) L.linkWflowInstanceID = wf;
      console.log(`[Montgomery][status-pdf] wflowInstanceID = ${wf || "(none)"}`);
      if (!statusTab.meta) statusTab.meta = {};
      statusTab.meta.wflowInstanceID = wf || statusTab.meta.wflowInstanceID;
      statusTab.meta.routingSlipViewerUrl = finalUrl;
      statusTab.meta.routingSlipAvailable = true;
    } else {
      L.hasResolved = false;
      console.log("[Montgomery][status-pdf] wflowInstanceID = (none)");
    }
  }
}

function logMontgomeryDebugStatusReportLinkFromPayload(statusTab) {
  console.log(
    "[Montgomery][debug][status-report-link] static (extractMontgomeryStatusTab result; no click)",
  );
  if (!statusTab) {
    console.log("[Montgomery][debug][status-report-link] statusTab=null");
    return;
  }
  const links = Array.isArray(statusTab.links) ? statusTab.links : [];
  const wf = statusTab.meta?.wflowInstanceID ?? null;
  const rsv = statusTab.meta?.routingSlipViewerUrl;
  const rsa = !!statusTab.meta?.routingSlipAvailable;
  console.log(
    `[Montgomery][debug][status-report-link] linksCount=${links.length} meta.wflowInstanceID=${wf ?? "(none)"} routingSlipViewerUrl=${rsv ? "set" : "absent"} routingSlipAvailable=${rsa}`,
  );
  links.forEach((L, i) => {
    const href = String(L.href || "");
    const res = String(L.resolvedViewerUrl || "");
    console.log(
      `[Montgomery][debug][status-report-link] link[${i}] text=${JSON.stringify(L.text)} hrefHttp=${/^https?:\/\//i.test(href)} hrefSample=${href.slice(0, 100)} resolvedHttp=${/^https?:\/\//i.test(res)} onclick=${L.onclick ? String(L.onclick).slice(0, 100) : "(none)"} reportName=${JSON.stringify(L.reportName || "")}`,
    );
  });
  const actionable = links.some(
    (L) =>
      (L.href && /^https?:\/\//i.test(String(L.href))) ||
      (L.resolvedViewerUrl && /^https?:\/\//i.test(String(L.resolvedViewerUrl))),
  );
  console.log(
    `[Montgomery][debug][status-report-link] anyActionableHttpHref=${actionable}`,
  );
  if (links.length && !actionable) {
    console.log(
      "[Montgomery][debug][status-report-link] hypothesis: no WFlowInstanceID in static HTML → buildMontgomeryRoutingSlipViewerUrl null → links lack https href until mapper fills from resolvedViewerUrl",
    );
  }
}

/**
 * Optional: set MONTGOMERY_DEBUG_STATUS_LINKS=1 to click first viewRoutingSlip control and log popup URL.
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 */
async function debugMontgomeryStatusReportLinksPlaywright(page, webUiBase, projectID) {
  console.log(
    "[Montgomery][debug][status-report-link] interactive probe start (env MONTGOMERY_DEBUG_STATUS_LINKS=1)",
  );
  await gotoMontgomeryTab(page, webUiBase, projectID, "projectStatusTab");
  await page.waitForTimeout(900);
  const context = page.context();
  const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  const clicked = await page
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll("a[onclick], span[onclick], button[onclick]"),
      );
      for (const el of nodes) {
        const oc = el.getAttribute("onclick") || "";
        if (!/viewRoutingSlip/i.test(oc)) continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        /** @type {HTMLElement} */ (el).click();
        return { ok: true, text: t.slice(0, 160), onclick: oc.slice(0, 160) };
      }
      return { ok: false, reason: "no element with onclick matching viewRoutingSlip in document" };
    })
    .catch((e) => ({ ok: false, reason: (e && e.message) || String(e) }));
  console.log(
    `[Montgomery][debug][status-report-link] clickAttempt=${JSON.stringify(clicked)}`,
  );
  const popup = await popupPromise;
  const popupOk = !!(popup && !popup.isClosed());
  console.log(`[Montgomery][debug][status-report-link] popupOpened=${popupOk}`);
  if (popupOk && popup) {
    let immediate = "";
    let after = "";
    try {
      immediate = popup.url();
    } catch (_) {}
    await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200).catch(() => {});
    try {
      after = popup.url();
    } catch (_) {}
    const wf = after || immediate ? pgc.extractWFlowInstanceIdFromViewerUrl(after || immediate) : null;
    console.log(
      `[Montgomery][debug][status-report-link] popupUrlImmediate=${immediate.slice(0, 220)}`,
    );
    console.log(
      `[Montgomery][debug][status-report-link] popupUrlAfterSettle=${after.slice(0, 220)} matchesReportViewer=${/ReportViewer\.aspx/i.test(after)} wflowFromPopup=${wf || "(none)"}`,
    );
    await popup.close().catch(() => {});
  } else {
    const mu = page.url();
    console.log(
      `[Montgomery][debug][status-report-link] noPopup mainPageUrl=${mu.slice(0, 220)} mainMatchesReportViewer=${/ReportViewer\.aspx/i.test(mu)}`,
    );
  }
  console.log("[Montgomery][debug][status-report-link] interactive probe end");
}

/**
 * @param {import('playwright').Page} page
 * @param {{ projectID: string, projectNumber?: string }} proj
 * @param {string} webUiBase
 * @param {Record<string, boolean>} omitTabs omit[key]=true → skip tab
 */
async function scrapeMontgomeryProjectDetails(page, proj, webUiBase, omitTabs) {
  const projectID = String(proj.projectID);
  /** @type {any} */
  const out = {
    projectID,
    dashboard: {
      projectNumber: proj.projectNumber || null,
      description: proj.description || null,
      location: proj.location || null,
      status: proj.status || null,
    },
    info: null,
    statusTab: null,
    tasksTab: null,
    _meta: { montgomery: true },
  };

  if (!omitTabs.status) {
    console.log("[Montgomery][status] capturing first-open summary + routing slip / WFlow signals");
    await gotoMontgomeryTab(page, webUiBase, projectID, "projectStatusTab");
    await page.waitForTimeout(1000);
    const target = await getMontgomeryDomTarget(page, "status");
    await target
      .waitForSelector(
        "#projectStatusTab, [id*='projectStatus'], table, .ui-iggrid, dl",
        { timeout: 22000 },
      )
      .catch(() => {});
    out.statusTab = await extractMontgomeryStatusTab(target, {
      projectID,
      webUiBase,
    });
    await enrichMontgomeryStatusTabWithViewerUrls(page, webUiBase, projectID, out.statusTab).catch(
      (e) => console.warn("[Montgomery][status-pdf] enrich failed:", e?.message || e),
    );
    logMontgomeryDebugStatusReportLinkFromPayload(out.statusTab);
    if (process.env.MONTGOMERY_DEBUG_STATUS_LINKS === "1") {
      await debugMontgomeryStatusReportLinksPlaywright(page, webUiBase, projectID).catch(
        (e) =>
          console.warn(
            "[Montgomery][debug][status-report-link] interactive probe error:",
            e?.message || e,
          ),
      );
    }
  }

  if (!omitTabs.info) {
    console.log("[Montgomery][info] project metadata (ProjectInfo panel only)");
    await gotoMontgomeryTab(
      page,
      webUiBase,
      projectID,
      "projectInfoTab",
      "projectTab=TabProjectInfo",
    );
    const finalInfoOk = await waitForMontgomeryTabProjectInfoHydrated(page, 28000);
    const target = await getMontgomeryDomTarget(page, "info");
    await target
      .waitForSelector("#TabProjectInfo", { timeout: 12000 })
      .catch(() => {});
    let frameUrlShort = "";
    try {
      frameUrlShort = target.url() || "";
    } catch (_) {}
    console.log(
      `[Montgomery][info] info root selected: #TabProjectInfo frame=${frameUrlShort ? frameUrlShort.slice(0, 100) : "(unknown)"}`,
    );
    console.log(`[Montgomery][info] final info state confirmed: ${finalInfoOk ? "yes" : "no"}`);
    out.info = await extractMontgomeryInfoTab(target, {
      finalStateConfirmed: finalInfoOk,
      frameUrlShort: frameUrlShort ? frameUrlShort.slice(0, 140) : "",
    });
    const inf = out.info;
    console.log(`[Montgomery][info] extracted projectInfo count=${inf?.projectInfo?.length ?? 0}`);
    console.log(`[Montgomery][info] extracted keyValues count=${inf?.keyValues?.length ?? 0}`);
    console.log(`[Montgomery][info] extracted tables count=${inf?.tables?.length ?? 0}`);
    console.log(
      `[Montgomery][info] filtered discussion/task rows count=${inf?.info_debug?.filteredNoiseCount ?? 0}`,
    );
  }

  if (!omitTabs.tasks) {
    console.log("[Montgomery][tasks] tasks grid + workflows tables");
    await gotoMontgomeryTab(page, webUiBase, projectID, "tasksTab");
    await page.waitForTimeout(1200);
    const target = await getMontgomeryDomTarget(page, "tasks");
    await target
      .waitForSelector("#tasksTab, [id*='tasksTab'], table, .ui-iggrid", {
        timeout: 22000,
      })
      .catch(() => {});
    out.tasksTab = await extractMontgomeryTasksTab(target);
  }

  try {
    const st = out.statusTab;
    const inf = out.info;
    const tt = out.tasksTab;
    const taskGridRows = (tt?.tables || [])
      .filter((x) => x.title === "Tasks")
      .reduce((n, t) => n + (t.rows?.length || 0), 0);
    const wfRows = (tt?.tables || [])
      .filter((x) => x.title === "Workflows")
      .reduce((n, t) => n + (t.rows?.length || 0), 0);
    console.log(
      `[Montgomery][extract] summary statusKv=${st?.keyValues?.length ?? 0} statusLinks=${st?.links?.length ?? 0} infoKv=${inf?.projectInfo?.length ?? 0} infoTables=${inf?.tables?.length ?? 0} tasksLegacy=${tt?.tasks?.length ?? 0} taskGridRows=${taskGridRows} workflowRows=${wfRows} tasksTableBlocks=${tt?.tables?.length ?? 0}`,
    );
  } catch (_) {}

  return { ok: true, out };
}

/**
 * @param {import('playwright').Page} page
 * @param {{ projectID: string }} proj
 * @param {string} webUiBase
 */
async function harvestMontgomeryFilesByCategory(page, proj, webUiBase) {
  const projectID = String(proj.projectID);
  console.log("[Montgomery][files] category list + flat grids");
  await gotoMontgomeryTab(page, webUiBase, projectID, "filesTab");
  await page.waitForTimeout(1500);

  const selectors =
    "#folderTree a, .ui-igtree-node a, #filesTab .ui-igtree-node a, [id*='filesTab'] .ui-igtree a";
  const n = await page.locator(selectors).count().catch(() => 0);
  const maxCat = Math.min(Math.max(n, 0), 24);

  /** @type {object[]} */
  const folders = [];
  const seenCat = new Set();

  for (let i = 0; i < maxCat; i++) {
    const loc = page.locator(selectors).nth(i);
    const text = (await loc.textContent().catch(() => "")) || "";
    const catName = text.replace(/\s+/g, " ").trim();
    if (!catName || catName.length > 120) continue;
    const key = catName.toLowerCase();
    if (seenCat.has(key)) continue;
    seenCat.add(key);

    console.log(`[Montgomery][files] category: "${catName}"`);
    await loc.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.waitForSelector(".ui-iggrid-table tbody tr, table tbody tr", { timeout: 12000 }).catch(() => {});

    const files = await page.evaluate((category) => {
      function norm(s) {
        return String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      /** @type {object[]} */
      const out = [];
      const trs = document.querySelectorAll(
        "#filesTab .ui-iggrid-table tbody tr, .ui-iggrid-table tbody tr, #filesTab table tbody tr",
      );
      trs.forEach((tr) => {
        const tds = Array.from(tr.querySelectorAll("td")).map((td) => norm(td.textContent));
        if (!tds.some((c) => c.length > 0)) return;
        let fileId = "";
        let viewUrl = "";
        tr.querySelectorAll("a[onclick], a[href]").forEach((a) => {
          const oc = a.getAttribute("onclick") || "";
          const href = a.getAttribute("href") || "";
          const pool = `${oc} ${href}`;
          const mf =
            pool.match(/viewFile\(\s*['"]?(\d+)/i) ||
            pool.match(/viewFile\(\s*(\d+)/i);
          const mi = pool.match(/viewInfo\(\s*['"]?(\d+)/i);
          const mv = pool.match(/viewVersion\(\s*['"]?(\d+)/i);
          if (mf) fileId = mf[1];
          else if (mi) fileId = mi[1];
          else if (mv) fileId = mv[1];
          if (/^https?:/i.test(href)) viewUrl = href;
        });
        const nameGuess = tds.find((c) => /\.(pdf|dwg|dxf|docx?|xlsx?|tif{1,2})\b/i.test(c)) || tds[0] || "";
        out.push({
          name: nameGuess || "file",
          fileId: fileId || undefined,
          folderName: category,
          status: tds[1] || "",
          reviewedBy: tds[2] || "",
          uploadedDate: tds[3] || "",
          commentCount: 0,
          viewUrl: viewUrl || undefined,
        });
      });
      return out;
    }, catName);

    folders.push({
      folderID: null,
      folderName: catName,
      parentFolder: null,
      filesCount: files.length,
      name: catName,
      fileCount: files.length,
      files,
    });
  }

  return {
    projectID,
    foldersCount: folders.length,
    filesCount: folders.reduce((a, f) => a + (f.filesCount || 0), 0),
    sampledDownloadsCount: 0,
    folders,
    sampleFiles: [],
    downloadedFiles: [],
    _meta: {
      fileApiFailures: 0,
      largeFilesSkipped: 0,
      downloadAttempts: 0,
      downloadsOk: 0,
      uploadsOk: 0,
      failures: 0,
    },
  };
}

function buildMontgomeryReportUrls(projectID, wflowInstanceID, webUiBase) {
  const origin = (webUiBase || DEFAULT_MONTGOMERY_WEBUI).replace(/\/$/, "");
  const base = `${origin}/WebForms/ReportViewer.aspx`;
  const out = MONTGOMERY_REPORT_SPECS.map((s) => {
    const q = new URLSearchParams({
      ReportPath: s.reportPath,
      DataSourceName: "DataSource1",
      ProjectID: String(projectID),
      WFlowInstanceID: String(wflowInstanceID || ""),
      Timezone: "",
    });
    if (s.reportId) q.set("ReportID", String(s.reportId));
    return {
      fileSlug: s.fileSlug,
      reportName: s.reportName,
      url: `${base}?${q.toString()}`,
    };
  });
  console.log(
    `[Montgomery][reports-deep] nav buildMontgomeryReportUrls wfid=${wflowInstanceID != null && String(wflowInstanceID).trim() !== "" ? String(wflowInstanceID) : "null"} projectID=${projectID} specCount=${out.length}`,
  );
  for (const x of out) {
    console.log(
      `[Montgomery][reports-deep] nav fallbackBuilt report=${JSON.stringify(x.reportName)} urlLen=${x.url.length} urlSample=${x.url.slice(0, 160)}`,
    );
  }
  return out;
}

function buildMontgomeryRoutingSlipViewerUrl(webUiBase, projectID, wfid) {
  if (!wfid) return null;
  const list = buildMontgomeryReportUrls(projectID, wfid, webUiBase);
  const hit = list.find((x) => /routing slip/i.test(x.reportName || ""));
  return hit?.url || null;
}

/**
 * PGC helper only matches literal WFlowInstanceID=123; Montgomery URLs may be encoded or embedded.
 * @param {string | null | undefined} s
 * @returns {string | null}
 */
function extractMontgomeryWFlowInstanceIdFromText(s) {
  if (s == null) return null;
  const raw = String(s).trim();
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch (_) {
    decoded = raw;
  }
  let id = pgc.extractWFlowInstanceIdFromViewerUrl(decoded);
  if (id) return id;
  id = pgc.extractWFlowInstanceIdFromViewerUrl(raw);
  if (id) return id;
  const m =
    decoded.match(/WFlowInstanceID(?:=|%3[Dd])(\d+)/i) ||
    raw.match(/WFlowInstanceID(?:=|%3[Dd])(\d+)/i);
  return m ? String(m[1]) : null;
}

/**
 * Recover WFlowInstanceID for ReportViewer fallback URLs from enriched status (meta, routing slip URL, links).
 * runMontgomery previously only read meta.wflowInstanceID and href/onclick/resolvedViewerUrl — missing viewerUrl/reportUrl/routingSlipViewerUrl.
 * @param {any} statusTab
 * @returns {string | null}
 */
function extractWfidFromMontgomeryStatusTab(statusTab) {
  if (!statusTab || typeof statusTab !== "object") return null;
  const meta = statusTab.meta;
  if (meta && meta.wflowInstanceID != null) {
    const s = String(meta.wflowInstanceID).trim();
    if (/^\d+$/.test(s)) return s;
    const fromMeta = extractMontgomeryWFlowInstanceIdFromText(s);
    if (fromMeta) return fromMeta;
  }
  const rsv = meta?.routingSlipViewerUrl;
  if (rsv) {
    const id = extractMontgomeryWFlowInstanceIdFromText(String(rsv));
    if (id) return id;
  }
  const links = Array.isArray(statusTab.links) ? statusTab.links : [];
  for (const L of links) {
    if (L.linkWflowInstanceID != null) {
      const s = String(L.linkWflowInstanceID).trim();
      if (/^\d+$/.test(s)) return s;
    }
    const blob = [
      L.resolvedViewerUrl,
      L.viewerUrl,
      L.reportUrl,
      L.href,
      L.onclick,
    ]
      .filter(Boolean)
      .map((x) => String(x))
      .join(" ");
    const id = extractMontgomeryWFlowInstanceIdFromText(blob);
    if (id) return id;
  }
  return null;
}

function shortenMontgomeryReportFixLogUrl(u, maxLen = 140) {
  const t = String(u || "").trim();
  if (!t) return "null";
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** Deep debug only — no behavior change. */
function montgomeryReportsDeepEntryLine(phase, entry) {
  const v = entry || {};
  const rn = JSON.stringify(v.reportName ?? "?");
  console.log(
    `[Montgomery][reports-deep] entry phase=${phase} report=${rn} viewUrlLen=${String(v.viewUrl || "").length} reportUrlLen=${String(v.reportUrl || "").length} viewerReady=${!!v.viewerReady} pdfHttpUrl=${v.pdfHttpUrl ? "set" : "null"} excelHttpUrl=${v.excelHttpUrl ? "set" : "null"} pdfDl=${!!v.pdfDownloaded} xlDl=${!!v.excelDownloaded} pdfPath=${v.pdfPath ? "yes" : "no"} xlPath=${v.excelPath ? "yes" : "no"} pdfPub=${v.pdfPublicUrl ? "yes" : "no"} xlPub=${v.excelPublicUrl ? "yes" : "no"} exportUnavail=${!!v.exportUnavailable}`,
  );
}

/**
 * DOM probe for #grdReports row matching report name (diagnostic).
 * @param {import('playwright').Frame} gridFrame
 * @param {string} reportName
 * @param {any[]} gridRowsSnapshot
 */
async function montgomeryReportsDeepProbeGridRow(
  gridFrame,
  reportName,
  gridRowsSnapshot,
) {
  const nameTrim = String(reportName || "").trim();
  const hit = gridRowsSnapshot.find((r) =>
    pgc.pgcReportNamesLooselyMatch(r.reportName, reportName),
  );
  const harvested = hit
    ? {
        reportName: hit.reportName,
        viewUrlSample: String(hit.viewUrl || "").slice(0, 140),
        rowIndex: hit.rowIndex,
        stableRowKey: hit.stableRowKey,
        actionText: hit.actionText,
      }
    : null;
  let domProbe = null;
  try {
    domProbe = await gridFrame.evaluate((name) => {
      const norm = (s) =>
        String(s || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const want = norm(name).toLowerCase().replace(/\s+/g, " ");
      const trs = document.querySelectorAll("#grdReports tbody tr");
      for (const tr of trs) {
        const t = norm(tr.textContent || "")
          .toLowerCase()
          .replace(/\s+/g, " ");
        if (!want) continue;
        if (!t.includes(want)) continue;
        const links = Array.from(tr.querySelectorAll("a")).map((a) => ({
          href: (a.getAttribute("href") || "").slice(0, 200),
          onclick: (a.getAttribute("onclick") || "").slice(0, 200),
          dataHref: (a.getAttribute("data-href") || "").slice(0, 200),
          text: norm(a.textContent).slice(0, 100),
        }));
        return {
          rowMatched: true,
          rowTextSample: norm(tr.textContent || "").slice(0, 240),
          linkCount: links.length,
          links,
        };
      }
      return { rowMatched: false, tbodyTrCount: trs.length };
    }, nameTrim);
  } catch (e) {
    domProbe = { evaluateError: (e && e.message) || String(e) };
  }
  console.log(
    `[Montgomery][reports-deep] row report=${JSON.stringify(nameTrim)} hitInHarvestedGrid=${hit ? "yes" : "no"} harvested=${JSON.stringify(harvested)} domProbe=${JSON.stringify(domProbe)}`,
  );
}

/**
 * Real Montgomery reports grid (same pattern as other ProjectDox tenants): Admin/Report/ReportList in WebUI.
 * @param {string} webUiBase
 * @param {string} projectID
 */
function buildMontgomeryReportListUrl(webUiBase, projectID) {
  const origin = (webUiBase || DEFAULT_MONTGOMERY_WEBUI).replace(/\/$/, "");
  const u = new URL(`${origin}/Admin/Report/ReportList`);
  u.searchParams.append("reportTypes", "1");
  u.searchParams.append("reportTypes", "10");
  u.searchParams.append("reportTypes", "11");
  u.searchParams.set("projectID", String(projectID));
  return u.toString();
}

/**
 * @param {string | null | undefined} hrefOrUrl
 * @param {string} webUiBase
 * @returns {string | null}
 */
function absolutizeMontgomeryMaybeUrl(hrefOrUrl, webUiBase) {
  const s = String(hrefOrUrl || "").trim();
  if (!s || /^javascript:/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const origin = (webUiBase || DEFAULT_MONTGOMERY_WEBUI).replace(/\/$/, "");
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${origin}${s}`;
  return null;
}

/**
 * Pull a ReportViewer.aspx URL from onclick/href/data attributes (Montgomery rows often use javascript:void(0)).
 * @param {string} s
 * @returns {string | null}
 */
function extractMontgomeryReportViewerAspxUrlFromText(s) {
  const raw = String(s || "");
  const m1 = raw.match(/https?:\/\/[^'"\s]+ReportViewer\.aspx[^'"\s]*/i);
  if (m1) return m1[0].replace(/&amp;/gi, "&");
  const m2 = raw.match(/(\/WebForms\/ReportViewer\.aspx[^'"\s]*)/i);
  if (m2) return m2[1].replace(/&amp;/gi, "&");
  return null;
}

/**
 * @param {string[]} candidates
 * @param {string} projectID
 * @returns {string | null}
 */
function pickLikelyMontgomeryWflowInstanceId(candidates, projectID) {
  const pid = String(projectID || "").replace(/\D/g, "");
  const uniq = [...new Set((candidates || []).map((x) => String(x || "").trim()))].filter((x) =>
    /^\d{4,}$/.test(x),
  );
  if (!uniq.length) return null;
  const withoutPid = uniq.filter((x) => x !== pid);
  const pool = withoutPid.length ? withoutPid : uniq;
  return pool.sort((a, b) => b.length - a.length)[0];
}

/**
 * Scan open frames (report list + iframes) for WFlowInstanceID embedded in HTML.
 * @param {import('playwright').Page} page
 * @param {string} projectID
 * @returns {Promise<string | null>}
 */
async function montgomeryCollectWflowInstanceIdFromOpenPageFrames(page, projectID) {
  const found = [];
  for (const f of page.frames()) {
    try {
      if (f.isDetached()) continue;
      const html = await f.content().catch(() => "");
      found.push(...extractWFlowInstanceIdsFromHtml(html));
    } catch (_) {}
  }
  return pickLikelyMontgomeryWflowInstanceId(found, projectID);
}

/**
 * Minimal status-tab navigation to recover WFlowInstanceID when full detail scrape was omitted (e.g. reports-only mode).
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 * @returns {Promise<string | null>}
 */
async function montgomeryLightweightFetchWfidFromStatusTab(page, webUiBase, projectID) {
  try {
    await gotoMontgomeryTab(page, webUiBase, projectID, "projectStatusTab");
    await page.waitForTimeout(1000).catch(() => {});
    const target = await getMontgomeryDomTarget(page, "status");
    await target
      .waitForSelector("#projectStatusTab, [id*='projectStatus'], table", {
        timeout: 15000,
      })
      .catch(() => {});
    const html = await target.content().catch(() => "");
    const picked = pickLikelyMontgomeryWflowInstanceId(
      extractWFlowInstanceIdsFromHtml(html),
      projectID,
    );
    if (picked) {
      console.log(
        `[Montgomery][reports-fix] wflowInstanceID from lightweight status tab fetch: ${picked}`,
      );
    }
    return picked;
  } catch (e) {
    console.warn(
      `[Montgomery][reports-fix] lightweight status wfid fetch failed: ${(e && e.message) || e}`,
    );
    return null;
  }
}

/**
 * @param {any[]} rows
 * @param {string} webUiBase
 */
function augmentMontgomeryHarvestedReportRows(rows, webUiBase) {
  for (const r of rows || []) {
    const pools = [r.anchorOnclick, r.anchorHref, r.secondaryOnclick].filter(Boolean);
    for (const p of pools) {
      const raw = extractMontgomeryReportViewerAspxUrlFromText(p);
      if (!raw) continue;
      const abs = absolutizeMontgomeryMaybeUrl(raw, webUiBase);
      if (abs && !r.viewUrl) r.viewUrl = abs;
      if (abs) break;
    }
  }
}

/**
 * Load the reports grid: prefer ReportList (iframe data-src target), fall back to Project/Index reports tab.
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 * @returns {Promise<string>} final URL used
 */
async function navigateMontgomeryReportsGrid(page, webUiBase, projectID) {
  const origin = (webUiBase || DEFAULT_MONTGOMERY_WEBUI).replace(/\/$/, "");
  const reportListUrl = buildMontgomeryReportListUrl(webUiBase, projectID);
  await page.goto(reportListUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pgc.waitForPgcReportsGridReady(page);
  let n = 0;
  try {
    n = await page.locator("#grdReports tbody tr").count();
  } catch (_) {
    n = 0;
  }
  if (n > 0) return reportListUrl;
  const fallback = `${origin}/Project/Index?tab=reportsTab&ProjectID=${encodeURIComponent(String(projectID))}`;
  await page.goto(fallback, { waitUntil: "domcontentloaded", timeout: 45000 });
  await pgc.waitForPgcReportsGridReady(page);
  return fallback;
}

/**
 * @param {string[]} urls
 * @returns {string | null}
 */
function pickMontgomeryReportViewerUrl(urls) {
  const list = (urls || []).filter(Boolean).filter((u) => /ReportViewer\.aspx/i.test(u));
  if (!list.length) return null;
  list.sort((a, b) => b.length - a.length);
  return list[0];
}

/**
 * When a ReportViewer URL is known, attach SSRS-style export GET URLs (same pattern as PGC).
 * @param {any} entry
 */
function applyMontgomeryReportEntryHttpExportUrls(entry) {
  const rn = JSON.stringify(entry?.reportName ?? "?");
  const v = String(entry?.viewUrl || entry?.reportUrl || "").trim();
  if (!v || !/ReportViewer\.aspx/i.test(v)) {
    console.log(
      `[Montgomery][reports-deep] entry phase=applyHttpExport-skip report=${rn} reason=${!v ? "empty-viewUrl-reportUrl" : "url-not-ReportViewer.aspx"} baseLen=${v.length}`,
    );
    return;
  }
  entry.pdfHttpUrl = pgc.pgcReportViewerUrlWithFormat(v, "PDF");
  entry.excelHttpUrl = pgc.pgcReportViewerUrlWithFormat(v, "EXCELOPENXML");
  console.log(
    `[Montgomery][reports-deep] entry phase=applyHttpExport-applied report=${rn} pdfHttpLen=${String(entry.pdfHttpUrl || "").length} excelHttpLen=${String(entry.excelHttpUrl || "").length}`,
  );
}

/**
 * Reports grid (#grdReports) often lives in Frame.aspx, not the top document.
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Frame>}
 */
async function montgomeryFindReportsGridFrame(page) {
  await page.waitForTimeout(400);
  for (const f of page.frames()) {
    try {
      if (f.isDetached()) continue;
      const n = await f.locator("#grdReports tbody tr").count();
      if (n > 0) return f;
    } catch (_) {}
  }
  return page.mainFrame();
}

/**
 * Capture real ReportViewer.aspx URL via row click (popup or same tab), mirroring PGC task-8 behavior.
 * @param {import('playwright').Page} page
 * @param {string} webUiBase
 * @param {string} projectID
 * @param {string} reportName
 * @returns {Promise<string | null>}
 */
async function captureMontgomeryReportViewerUrlFromRow(
  page,
  webUiBase,
  projectID,
  reportName,
) {
  const nameTrim = String(reportName || "").trim();
  if (!nameTrim) return null;

  console.log(
    `[Montgomery][debug][reports] captureFromRow start reportName=${JSON.stringify(nameTrim)} gridPage=${page.url().slice(0, 160)}`,
  );

  await navigateMontgomeryReportsGrid(page, webUiBase, projectID);
  const gridFrame = await montgomeryFindReportsGridFrame(page);
  console.log(`[Montgomery][reports-fix] opening viewer for ${nameTrim}`);
  console.log(`[Montgomery][reports] opening viewer for ${nameTrim}`);
  console.log(
    `[Montgomery][debug][reports] after navigateMontgomeryReportsGrid url=${page.url().slice(0, 200)}`,
  );

  /** @type {string[]} */
  const captured = [];
  const onReq = (req) => {
    const u = req.url();
    if (/ReportViewer\.aspx/i.test(u)) {
      captured.push(u);
      console.log(
        `[Montgomery][debug][reports] intercepted request ReportViewer len=${u.length} sample=${u.slice(0, 180)}`,
      );
    }
  };
  page.on("request", onReq);

  const context = page.context();
  /** @type {import('playwright').Page | null} */
  let popup = null;
  let deepClickAttempted = false;
  let deepPopupDetected = false;
  let deepPopupUrlInitial = "";
  let deepPopupUrlFinal = "";
  let deepMainUrlAfter = "";

  try {
    const popupPromise = context
      .waitForEvent("page", { timeout: 12000 })
      .catch(() => null);
    const navPromise = page
      .waitForURL(/ReportViewer\.aspx/i, { timeout: 12000 })
      .catch(() => {});

    const row = gridFrame
      .locator("#grdReports tbody tr")
      .filter({ hasText: nameTrim })
      .first();
    const hasRow = (await row.count().catch(() => 0)) > 0;
    console.log(
      `[Montgomery][debug][reports] rowLocator hasRow=${hasRow} selector=#grdReports tbody tr + hasText`,
    );

    let clickAttempted = false;
    if (hasRow) {
      const links = row.locator("a");
      const linkCount = await links.count().catch(() => 0);
      const nameLower = nameTrim.toLowerCase().replace(/\s+/g, " ").trim();
      /** @type {import('playwright').Locator | null} */
      let clickTarget = null;
      if (linkCount >= 2) {
        const second = links.nth(1);
        const t2 = ((await second.textContent().catch(() => "")) || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .trim();
        if (
          t2 &&
          (t2.includes(nameLower) ||
            (nameLower.length >= 12 && nameLower.includes(t2)) ||
            (t2.length >= 12 && nameLower.includes(t2)))
        ) {
          clickTarget = second;
        }
      }
      if (!clickTarget) {
        const nameLink = row.locator("a").filter({ hasText: nameTrim }).first();
        const hasNameLink = (await nameLink.count().catch(() => 0)) > 0;
        clickTarget = hasNameLink ? nameLink : row.locator("a").first();
      }
      if ((await clickTarget.count().catch(() => 0)) > 0) {
        clickAttempted = true;
        await clickTarget.click({ timeout: 8000 }).catch((e) => {
          console.log(
            `[Montgomery][debug][reports] row click error: ${(e && e.message) || e}`,
          );
        });
      }
    } else {
      const evResult = await gridFrame
        .evaluate((name) => {
          const want = String(name || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          const trs = document.querySelectorAll("#grdReports tbody tr");
          for (const tr of trs) {
            const t = (tr.textContent || "")
              .replace(/\u00a0/g, " ")
              .replace(/\s+/g, " ")
              .toLowerCase();
            if (!t.includes(want)) continue;
            const links = tr.querySelectorAll("a");
            for (const a of links) {
              const at = (a.textContent || "")
                .replace(/\u00a0/g, " ")
                .replace(/\s+/g, " ")
                .toLowerCase();
              if (at.includes(want) || want.includes(at)) {
                a.click();
                return "name_anchor";
              }
            }
            const first = tr.querySelector("a");
            if (first) {
              first.click();
              return "first_anchor";
            }
          }
          return null;
        }, nameTrim)
        .catch(() => null);
      console.log(
        `[Montgomery][debug][reports] fallback evaluate click result=${JSON.stringify(evResult)}`,
      );
      clickAttempted = !!evResult;
    }
    deepClickAttempted = clickAttempted;
    console.log(`[Montgomery][debug][reports] clickAttempted=${clickAttempted}`);

    await navPromise;
    popup = await popupPromise;

    const popupDetected = !!(popup && !popup.isClosed());
    deepPopupDetected = popupDetected;
    console.log(`[Montgomery][debug][reports] popupNewPageDetected=${popupDetected}`);
    console.log(`[Montgomery][reports-fix] popup detected: ${popupDetected ? "yes" : "no"}`);
    if (popup && !popup.isClosed()) {
      let urlImmediate = "";
      let urlAfter = "";
      try {
        urlImmediate = popup.url();
      } catch (_) {}
      deepPopupUrlInitial = urlImmediate;
      try {
        await popup
          .waitForLoadState("domcontentloaded", { timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(800).catch(() => {});
        urlAfter = popup.url();
      } catch (_) {}
      deepPopupUrlFinal = urlAfter;
      console.log(
        `[Montgomery][debug][reports] popupUrlImmediate=${urlImmediate.slice(0, 220)}`,
      );
      console.log(
        `[Montgomery][debug][reports] popupUrlAfterSettle=${urlAfter.slice(0, 220)} matchesReportViewer=${/ReportViewer\.aspx/i.test(urlAfter)}`,
      );
      try {
        const pu = urlAfter || urlImmediate;
        if (/ReportViewer\.aspx/i.test(pu)) captured.push(pu);
      } catch (_) {}
      await popup.close().catch(() => {});
    }

    const mainU = page.url();
    deepMainUrlAfter = mainU;
    console.log(
      `[Montgomery][debug][reports] mainPageUrlAfterWait=${mainU.slice(0, 220)} mainMatchesReportViewer=${/ReportViewer\.aspx/i.test(mainU)}`,
    );
    if (/ReportViewer\.aspx/i.test(mainU)) captured.push(mainU);

    await page.waitForTimeout(800);
    console.log(
      `[Montgomery][debug][reports] capturedUrlsCount=${captured.length} (from requests+popup+main)`,
    );
  } finally {
    page.off("request", onReq);
    if (popup && !popup.isClosed()) await popup.close().catch(() => {});
    await navigateMontgomeryReportsGrid(page, webUiBase, projectID);
  }

  const best = pickMontgomeryReportViewerUrl(captured);
  console.log(
    `[Montgomery][reports-deep] nav report=${JSON.stringify(nameTrim)} step=capture clickAttempted=${deepClickAttempted ? "yes" : "no"} popupDetected=${deepPopupDetected ? "yes" : "no"} popupInitialUrl=${deepPopupUrlInitial ? deepPopupUrlInitial.slice(0, 160) : "null"} popupFinalUrl=${deepPopupUrlFinal ? deepPopupUrlFinal.slice(0, 160) : "null"} popupFinalIsReportViewer=${/ReportViewer\.aspx/i.test(deepPopupUrlFinal)} mainPageUrl=${deepMainUrlAfter ? deepMainUrlAfter.slice(0, 160) : "null"} mainIsReportViewer=${/ReportViewer\.aspx/i.test(deepMainUrlAfter)} interceptedRvRequestCount=${captured.length} chosenUrlLen=${best ? best.length : 0} chosenIsReportViewer=${best ? /ReportViewer\.aspx/i.test(best) : false}`,
  );
  if (best) {
    const short = best.length > 220 ? `${best.slice(0, 220)}…` : best;
    console.log(`[Montgomery][reports] resolved viewerUrl = ${short}`);
    console.log(`[Montgomery][reports-fix] final viewerUrl = ${short}`);
    console.log(
      `[Montgomery][debug][reports] pickMontgomeryReportViewerUrl chose len=${best.length}`,
    );
  } else {
    console.log(`[Montgomery][reports-fix] final viewerUrl = (none)`);
    console.log(
      `[Montgomery][debug][reports] pickMontgomeryReportViewerUrl returned null (no matching ReportViewer URL in captured list)`,
    );
  }
  return best;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function extractWFlowInstanceIdsFromHtml(html) {
  const s = String(html || "");
  const found = new Set();
  const patterns = [
    /WFlowInstanceID\s*=\s*(\d+)/gi,
    /WFlowInstanceID%3D(\d+)/gi,
    /["']WFlowInstanceID["']\s*:\s*["']?(\d+)/gi,
    /\bWFlowInstanceID\b\D{0,24}(\d{5,})/gi,
  ];
  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      if (m[1]) found.add(m[1]);
    }
  }
  return [...found];
}

/**
 * @param {{ key: string, value: string }[]} rows
 */
function dedupeMontgomeryStatusKeyValues(rows) {
  /** @type {Map<string, { key: string, value: string }>} */
  const map = new Map();
  for (const kv of rows) {
    const key = String(kv.key || "")
      .replace(/:\s*$/, "")
      .trim();
    const value = String(kv.value || "").trim();
    if (!key) continue;
    const kl = key.toLowerCase();
    if (!map.has(kl)) {
      map.set(kl, { key, value });
      continue;
    }
    const cur = map.get(kl);
    const a = cur.value.length;
    const b = value.length;
    let next = cur;
    if (!cur.value && value) next = { key: cur.key, value };
    else if (cur.value && !value) next = cur;
    else if (b > 0 && b < a) next = { key: cur.key, value };
    else if (a > 0 && a < b && b > Math.max(280, a * 3)) next = cur;
    map.set(kl, next);
  }
  return [...map.values()];
}

function mdcReportFileSlugFromTargetName(nm, i) {
  return (
    pgc
      .normalizeText(nm || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `report-${i + 1}`
  );
}

/**
 * @param {import('playwright').Page} page
 * @param {string} projectID
 * @param {string} webUiBase
 */
async function scrapeMontgomeryReportsTabRows(page, projectID, webUiBase) {
  await navigateMontgomeryReportsGrid(page, webUiBase, projectID);
  const gridFrame = await montgomeryFindReportsGridFrame(page);
  const targetSpecs = MONTGOMERY_REPORT_SPECS.map((s) => ({
    norm: pgc.normalizeReportName(s.reportName),
    name: s.reportName,
  }));

  const rows = await gridFrame.evaluate((specs) => {
    function norm(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const st = window.getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function rowKey(tr, idx) {
      const id =
        tr.getAttribute("data-id") ||
        tr.getAttribute("data-ig") ||
        tr.getAttribute("id") ||
        "";
      return id || `idx:${idx}`;
    }
    /** @type {{ norm: string, name: string }[]} */
    const targetSpecs = specs;
    /** @type {any[]} */
    const out = [];
    const seen = new Set();
    function reportCellKey(s) {
      return norm(String(s))
        .replace(/[\u2013\u2014\u2212]/g, "-")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    }
    /**
     * Match the whole row (same idea as deep domProbe), not only column 0 — Montgomery often puts the
     * report title in a secondary cell or link while col0 is an icon/control.
     * @param {HTMLTableRowElement} tr
     * @returns {{ norm: string, name: string } | null}
     */
    function pickMatchingSpec(tr) {
      const k = reportCellKey(tr.textContent || "");
      if (!k) return null;
      for (const spec of targetSpecs) {
        const t = spec.norm;
        if (k === t) return spec;
        if (t.length >= 12 && (k.includes(t) || t.includes(k))) return spec;
      }
      return null;
    }
    function harvestFromTable(_tableEl, trList) {
      let localRowIndex = -1;
      for (const tr of trList) {
        if (!isVisible(tr)) continue;
        if (tr.querySelector("th") && trList.indexOf(tr) === 0) continue;
        localRowIndex += 1;
        const matched = pickMatchingSpec(tr);
        if (!matched) continue;
        const reportName = matched.name;
        const rnLower = reportName.toLowerCase().replace(/\s+/g, " ").trim();
        let tds = Array.from(tr.querySelectorAll("td"));
        if (!tds.length) {
          tds = Array.from(tr.querySelectorAll('[role="gridcell"]'));
        }
        const cols = tds.map((td) => norm(td.textContent));
        const reportType = cols.length > 1 ? cols[1] || "" : "";
        const reportDescription = cols.length > 2 ? cols[2] || "" : "";
        const anchors = Array.from(tr.querySelectorAll("a"));
        let reportNameAnchor = null;
        if (anchors.length >= 2) {
          const second = anchors[1];
          const st = norm(second.textContent).toLowerCase().replace(/\s+/g, " ").trim();
          if (
            st &&
            (st.includes(rnLower) ||
              (rnLower.length >= 12 && rnLower.includes(st)) ||
              (st.length >= 12 && rnLower.includes(st)))
          ) {
            reportNameAnchor = second;
          }
        }
        if (!reportNameAnchor) {
          reportNameAnchor =
            anchors.find((a) =>
              norm(a.textContent).toLowerCase().replace(/\s+/g, " ").trim().includes(rnLower),
            ) ||
            anchors[1] ||
            anchors[0] ||
            null;
        }
        const actionNode =
          reportNameAnchor ||
          tr.querySelector("a[href], a[onclick], button[onclick], [onclick]");
        const viewUrlRaw =
          actionNode?.getAttribute("href") || actionNode?.getAttribute("data-href") || null;
        const viewUrl =
          viewUrlRaw && !/^javascript:/i.test(viewUrlRaw) ? viewUrlRaw : null;
        const sig = matched.norm;
        if (seen.has(sig)) continue;
        seen.add(sig);
        const sec = anchors.length >= 2 ? anchors[1] : null;
        out.push({
          rowIndex: localRowIndex,
          reportName,
          reportType,
          reportDescription,
          viewUrl,
          actionText: actionNode ? norm(actionNode.textContent) : null,
          stableRowKey: rowKey(tr, localRowIndex),
          anchorOnclick: actionNode?.getAttribute("onclick")
            ? String(actionNode.getAttribute("onclick")).slice(0, 800)
            : "",
          anchorHref: actionNode?.getAttribute("href")
            ? String(actionNode.getAttribute("href")).slice(0, 400)
            : "",
          secondaryOnclick:
            sec && sec !== actionNode && sec.getAttribute("onclick")
              ? String(sec.getAttribute("onclick")).slice(0, 800)
              : "",
        });
      }
      return out.length > 0;
    }
    const grdTrs = Array.from(
      document.querySelectorAll("#grdReports tbody tr"),
    ).filter(isVisible);
    if (grdTrs.length) {
      const hostTable =
        document.querySelector("#grdReports")?.closest("table") ||
        document.querySelector("#grdReports");
      const tableEl =
        hostTable instanceof HTMLTableElement
          ? hostTable
          : document.querySelector(".ui-iggrid-table, table") || document.body;
      harvestFromTable(tableEl, grdTrs);
    }
    if (!out.length) {
      const tables = Array.from(
        document.querySelectorAll(".ui-iggrid-table, table"),
      ).filter((t) => isVisible(t));
      for (const table of tables) {
        const trList = Array.from(table.querySelectorAll("tbody tr, tr")).filter(isVisible);
        if (harvestFromTable(table, trList)) break;
      }
    }
    return out;
  }, targetSpecs);

  augmentMontgomeryHarvestedReportRows(rows, webUiBase);

  console.log(`[Montgomery][reports] rows found = ${rows.length}`);
  for (const r of rows) {
    console.log(
      `[Montgomery][reports-deep] row scrapeHarvest reportName=${JSON.stringify(r.reportName)} viewUrl=${JSON.stringify(String(r.viewUrl || "").slice(0, 160))} rowIndex=${r.rowIndex} stableRowKey=${String(r.stableRowKey || "")} actionText=${JSON.stringify(r.actionText)}`,
    );
  }
  return rows;
}

/**
 * @param {import('playwright').Page} page
 * @param {{ projectID: string }} project
 * @param {string | null} wflowInstanceID
 * @param {{ webUiBase: string, dashboardUrl?: string, statusTab?: any | null }} opts
 */
async function processMontgomerySsrReportsForProject(
  page,
  project,
  wflowInstanceID,
  opts,
) {
  const projectID = String(project.projectID);
  const safePid = projectID.replace(/\D/g, "") || "unknown";
  const webUiBase = opts.webUiBase || DEFAULT_MONTGOMERY_WEBUI;
  const statusTabSnapshot = opts.statusTab ?? null;

  console.log(
    "[Montgomery][debug][reports] exportControlsProbe: waitForPgcReportViewerHandle scans frames for window.$find(clientId) where clientId in ReportViewer1, ReportViewer, [id*='ReportViewer']; needs rv.exportReport. exportReportFormat calls rv.exportReport(fmt)+waitForEvent('download') or HTTP GET viewer URL rs:Format=PDF|EXCELOPENXML (pgc-eplan-scraper.js)",
  );

  let effectiveWfid =
    wflowInstanceID != null && String(wflowInstanceID).trim() !== ""
      ? String(wflowInstanceID).trim()
      : null;
  let wfSource = "missing";
  if (effectiveWfid) wfSource = "param";
  if (!effectiveWfid && statusTabSnapshot) {
    effectiveWfid = extractWfidFromMontgomeryStatusTab(statusTabSnapshot);
    if (effectiveWfid) {
      wfSource = "statusTab";
      console.log(
        `[Montgomery][reports-fix] wflowInstanceID from statusTab snapshot: ${effectiveWfid}`,
      );
    }
  }

  let activePage = page;
  let gridRows = [];
  /** @type {Map<string, { needCapture: boolean, capturedUrl: string | null }>} */
  const captureByReportNorm = new Map();
  try {
    console.log(`[Montgomery][reports] scraping report grid project=${projectID}`);
    gridRows = await scrapeMontgomeryReportsTabRows(activePage, projectID, webUiBase);
    if (!effectiveWfid) {
      const fromFrames = await montgomeryCollectWflowInstanceIdFromOpenPageFrames(
        activePage,
        projectID,
      );
      if (fromFrames) {
        effectiveWfid = fromFrames;
        wfSource = "reportsPageFrames";
        console.log(
          `[Montgomery][reports-fix] wflowInstanceID from report-list / iframe HTML: ${effectiveWfid}`,
        );
      }
    }
    const wanted = new Set(MONTGOMERY_TARGET_REPORT_NAMES.map((n) => pgc.normalizeReportName(n)));
    gridRows = gridRows.filter((r) =>
      pgc.pgcReportRowMatchesAnyTarget(r.reportName, wanted),
    );
    console.log(
      `[Montgomery][debug][reports] gridRowsAfterFilter count=${gridRows.length} names=${gridRows.map((x) => x.reportName).join(" | ")}`,
    );
    console.log(
      `[Montgomery][reports-fix2] harvested rows count=${gridRows.length}`,
    );
    /** @type {import('playwright').Frame | null} */
    let gridFrameForDeep = null;
    try {
      gridFrameForDeep = await montgomeryFindReportsGridFrame(activePage);
    } catch (e) {
      console.log(
        `[Montgomery][reports-deep] row domProbeFrameError=${(e && e.message) || String(e)}`,
      );
    }
    for (const specNm of MONTGOMERY_REPORT_SPECS) {
      if (gridFrameForDeep) {
        await montgomeryReportsDeepProbeGridRow(
          gridFrameForDeep,
          specNm.reportName,
          gridRows,
        );
      } else {
        console.log(
          `[Montgomery][reports-deep] row report=${JSON.stringify(specNm.reportName)} domProbeSkipped=no-grid-frame`,
        );
      }
    }
    for (const r of gridRows) {
      const abs = absolutizeMontgomeryMaybeUrl(r.viewUrl, webUiBase);
      if (abs) r.viewUrl = abs;
      const v = String(r.viewUrl || "").trim();
      const needCapture =
        !v ||
        /^javascript:/i.test(v) ||
        !/^https?:\/\//i.test(v);
      console.log(
        `[Montgomery][debug][reports] gridRow reportName=${JSON.stringify(r.reportName)} viewUrlSample=${v.slice(0, 140)} needCaptureFromRow=${needCapture}`,
      );
      let capturedUrl = null;
      if (needCapture) {
        const actionUrl = await captureMontgomeryReportViewerUrlFromRow(
          activePage,
          webUiBase,
          projectID,
          r.reportName,
        );
        console.log(
          `[Montgomery][debug][reports] after captureFromRow reportName=${JSON.stringify(r.reportName)} gotUrl=${actionUrl ? "yes" : "no"}`,
        );
        if (actionUrl) {
          r.viewUrl = actionUrl;
          capturedUrl = actionUrl;
        }
      } else if (/^https?:\/\//i.test(v)) {
        capturedUrl = v;
      }
      captureByReportNorm.set(pgc.normalizeReportName(r.reportName), {
        needCapture,
        capturedUrl,
      });
    }
  } catch (e) {
    console.warn("[Montgomery][reports] grid error:", e?.message || e);
  }

  if (!effectiveWfid) {
    for (const r of gridRows) {
      const fromUrl = extractMontgomeryWFlowInstanceIdFromText(r.viewUrl);
      const fromRowMeta = extractMontgomeryWFlowInstanceIdFromText(
        [r.anchorOnclick, r.secondaryOnclick].filter(Boolean).join(" "),
      );
      const fromRow = fromUrl || fromRowMeta;
      if (fromRow) {
        effectiveWfid = fromRow;
        wfSource = "gridRowUrl";
        console.log(
          `[Montgomery][reports] WFlowInstanceID from grid row (viewUrl or onclick): ${effectiveWfid}`,
        );
        break;
      }
    }
  }
  if (!effectiveWfid) {
    const fromLight = await montgomeryLightweightFetchWfidFromStatusTab(
      activePage,
      webUiBase,
      projectID,
    );
    if (fromLight) {
      effectiveWfid = fromLight;
      wfSource = "statusTabLightweight";
    }
  }
  const wfid =
    effectiveWfid != null && String(effectiveWfid).trim() !== ""
      ? String(effectiveWfid).trim()
      : null;

  console.log(
    `[Montgomery][debug][reports] effectiveWfid after status+grid=${wfid || "(none)"} (fallback built URLs ${wfid ? "enabled" : "disabled"})`,
  );
  console.log(
    `[Montgomery][reports-fix2] effective wfid=${wfid || "none"} source=${wfSource}`,
  );

  if (!wfid) {
    console.log(
      `[Montgomery][reports-deep] nav buildMontgomeryReportUrls skipped reason=wfid-null-after-param-statusTab-and-grid`,
    );
  }
  const builtSpecs = wfid ? buildMontgomeryReportUrls(projectID, wfid, webUiBase) : [];
  const specList = MONTGOMERY_REPORT_SPECS.map((spec) => {
    const b = builtSpecs.find(
      (s) =>
        pgc.normalizeReportName(s.reportName) ===
        pgc.normalizeReportName(spec.reportName),
    );
    return {
      fileSlug: b?.fileSlug || spec.fileSlug,
      reportName: spec.reportName,
      fallbackUrl: b?.url || null,
    };
  });

  const outDir = path.join(__dirname, "..", "..", "mdc-reports", safePid);
  await fs.promises.mkdir(outDir, { recursive: true });

  /** @type {any[]} */
  const reports = [];

  for (const spec of specList) {
    const hit = gridRows.find((r) => pgc.pgcReportNamesLooselyMatch(r.reportName, spec.reportName));
    const capMeta =
      captureByReportNorm.get(pgc.normalizeReportName(spec.reportName)) ||
      (hit
        ? captureByReportNorm.get(pgc.normalizeReportName(hit.reportName))
        : undefined);
    const liveFromCapture =
      capMeta?.capturedUrl && /^https?:\/\//i.test(String(capMeta.capturedUrl).trim())
        ? String(capMeta.capturedUrl).trim()
        : null;
    const fromGrid = absolutizeMontgomeryMaybeUrl(hit?.viewUrl, webUiBase);
    const liveFromRow =
      fromGrid && /^https?:\/\//i.test(String(fromGrid).trim())
        ? String(fromGrid).trim()
        : null;
    const liveUrl = liveFromCapture || liveFromRow;
    const navigateUrl = liveUrl || spec.fallbackUrl;
    const navSource = liveFromCapture
      ? "live-capture"
      : liveFromRow
        ? "live-row"
        : spec.fallbackUrl
          ? "fallback"
          : "none";

    let navigateNullReason = "none";
    if (!navigateUrl) {
      if (!wfid && !liveUrl)
        navigateNullReason = "wfid-null-and-no-liveUrl-from-grid-capture";
      else if (!wfid)
        navigateNullReason = "wfid-null-no-fallbackUrl";
      else if (!spec.fallbackUrl && !liveUrl)
        navigateNullReason = "wfid-present-but-fallbackUrl-missing-and-no-liveUrl";
      else navigateNullReason = "navigateUrl-null-other";
    }
    console.log(
      `[Montgomery][reports-deep] nav report=${JSON.stringify(spec.reportName)} liveUrl=${liveUrl ? liveUrl.slice(0, 160) : "null"} fallbackUrl=${spec.fallbackUrl ? spec.fallbackUrl.slice(0, 160) : "null"} chosenNavigateUrl=${navigateUrl ? navigateUrl.slice(0, 160) : "null"} navSource=${navSource} navigateNullReason=${navigateNullReason}`,
    );
    console.log(
      `[Montgomery][reports-fix2] report=${spec.reportName} navigateUrl=${navigateUrl ? shortenMontgomeryReportFixLogUrl(navigateUrl) : "null"}`,
    );
    const rpt = spec.reportName;
    console.log(`[Montgomery][reports-fix] report=${rpt} row found=${hit ? "yes" : "no"}`);
    console.log(
      `[Montgomery][reports-fix] report=${rpt} click attempted=${capMeta?.needCapture ? "yes" : "no"}`,
    );
    console.log(
      `[Montgomery][reports-fix] report=${rpt} popup/viewer url captured=${capMeta?.capturedUrl ? shortenMontgomeryReportFixLogUrl(capMeta.capturedUrl) : "null"}`,
    );
    console.log(
      `[Montgomery][reports-fix] report=${rpt} fallback url built=${spec.fallbackUrl ? shortenMontgomeryReportFixLogUrl(spec.fallbackUrl) : "null"}`,
    );

    const entry = {
      fileSlug: spec.fileSlug,
      reportName: spec.reportName,
      reportType: hit?.reportType || "",
      reportDescription: hit?.reportDescription || "",
      reportUrl: navigateUrl || fromGrid || null,
      viewUrl: navigateUrl || fromGrid || null,
      viewerReady: false,
      excelDownloaded: false,
      excelPath: null,
      pdfDownloaded: false,
      pdfPath: null,
      exportUnavailable: false,
      wflowInstanceIDInViewerUrl: null,
      pdfHttpUrl: null,
      excelHttpUrl: null,
      exportError: null,
      _montgomeryAllowViewerHttpText: true,
    };
    montgomeryReportsDeepEntryLine("after-init", entry);

    function applyKnownViewerUrl(u) {
      const s = String(u || "").trim();
      if (!s || !/ReportViewer\.aspx/i.test(s)) return;
      entry.reportUrl = s;
      entry.viewUrl = s;
      const w =
        pgc.extractWFlowInstanceIdFromViewerUrl(s) ||
        extractMontgomeryWFlowInstanceIdFromText(s);
      if (w) entry.wflowInstanceIDInViewerUrl = w;
    }

    function syncEntryFromReportViewerPage(silent) {
      const resolved = activePage.url();
      if (!/ReportViewer\.aspx/i.test(resolved)) return;
      entry.reportUrl = resolved;
      entry.viewUrl = resolved;
      entry.wflowInstanceIDInViewerUrl =
        pgc.extractWFlowInstanceIdFromViewerUrl(resolved) ||
        extractMontgomeryWFlowInstanceIdFromText(resolved);
      if (!silent) {
        const short = resolved.length > 220 ? `${resolved.slice(0, 220)}…` : resolved;
        console.log(`[Montgomery][reports] resolved viewerUrl = ${short}`);
      }
    }

    function logReportFixSummary() {
      const pu = entry.pdfPublicUrl || entry.pdfHttpUrl || null;
      const xu = entry.excelPublicUrl || entry.excelHttpUrl || null;
      console.log(
        `[Montgomery][reports-fix] report=${spec.reportName} final viewerReady=${entry.viewerReady ? "true" : "false"}`,
      );
      console.log(
        `[Montgomery][reports-fix] report=${spec.reportName} pdfUrl=${pu ? shortenMontgomeryReportFixLogUrl(pu) : "null"}`,
      );
      console.log(
        `[Montgomery][reports-fix] report=${spec.reportName} excelUrl=${xu ? shortenMontgomeryReportFixLogUrl(xu) : "null"}`,
      );
      const hasV =
        !!(
          entry.viewUrl &&
          /^https?:\/\//i.test(String(entry.viewUrl)) &&
          /ReportViewer\.aspx/i.test(String(entry.viewUrl))
        );
      console.log(
        `[Montgomery][reports-fix] report=${spec.reportName} entry persisted with viewerUrl? ${hasV ? "yes" : "no"}`,
      );
    }

    if (!navigateUrl) {
      console.log(`[Montgomery][reports] skip (no URL) | ${spec.reportName} | wfid=${wfid || "(none)"}`);
      console.log(
        `[Montgomery][debug][reports] skipReason=noNavigateUrl reportName=${JSON.stringify(spec.reportName)} liveUrl=${liveUrl ? "had" : "none"} fallbackUrl=${spec.fallbackUrl ? "had" : "none"} wfid=${wfid || "(none)"}`,
      );
      montgomeryReportsDeepEntryLine("skip-no-navigateUrl", entry);
      logReportFixSummary();
      console.log(
        `[Montgomery][reports-fix2] report=${spec.reportName} viewerResolved=no`,
      );
      reports.push(entry);
      continue;
    }

    console.log(`[Montgomery][reports] navigate | ${spec.reportName} | ${navSource}`);
    console.log(
      `[Montgomery][debug][reports] spec=${JSON.stringify(spec.reportName)} navigateUrlLen=${navigateUrl.length} navSource=${navSource}`,
    );
    try {
      await activePage.goto(navigateUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await activePage.waitForTimeout(TASK8_REPORT_POST_NAV_MS);

      applyKnownViewerUrl(navigateUrl);
      syncEntryFromReportViewerPage();
      applyKnownViewerUrl(activePage.url());

      const urlAfterGoto = activePage.url();
      const matchesRv = /ReportViewer\.aspx/i.test(urlAfterGoto);
      console.log(
        `[Montgomery][debug][reports] afterGoto+settle url=${urlAfterGoto.slice(0, 220)} matchesReportViewer=${matchesRv}`,
      );
      montgomeryReportsDeepEntryLine("after-goto-sync", entry);

      applyMontgomeryReportEntryHttpExportUrls(entry);
      montgomeryReportsDeepEntryLine("after-first-applyHttpExport", entry);

      const viewerHandle = await pgc.waitForPgcReportViewerHandle(activePage);
      const entryViewer = String(entry.viewUrl || "");
      entry.viewerReady =
        !!viewerHandle ||
        (/ReportViewer\.aspx/i.test(entryViewer) && /^https?:\/\//i.test(entryViewer));
      console.log(
        `[Montgomery][debug][reports] waitForPgcReportViewerHandle result=${viewerHandle ? `clientId=${viewerHandle.clientId}` : "null (viewer not ready / $find missing / still loading)"}`,
      );
      console.log(
        `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} viewerPageLoaded=${/ReportViewer\.aspx/i.test(urlAfterGoto)} pageUrlSample=${urlAfterGoto.slice(0, 160)} selectorsChecked=pgc.waitForPgcReportViewerHandle: per-frame window.$find(ReportViewer1|ReportViewer|[id*=ReportViewer]) until rv.exportReport exists and not loading`,
      );
      console.log(
        `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} pdfControlFound=${viewerHandle ? "yes" : "no"} excelControlFound=${viewerHandle ? "yes" : "no"} clientId=${viewerHandle ? viewerHandle.clientId : "null"}`,
      );

      const shotB64 = await pgc.capturePgcReportScreenshotBase64(activePage, viewerHandle);
      if (shotB64) entry.screenshot = shotB64;

      const excelPath = path.join(outDir, `${spec.fileSlug}.xlsx`);
      const pdfPath = path.join(outDir, `${spec.fileSlug}.pdf`);
      let viewerUrlForHttp = activePage.url();

      if (!viewerHandle) {
        console.log(
          `[Montgomery][debug][reports] export path=noHandle attempt EXCELOPENXML+PDF via exportReportFormat(null handle, http fallback viewerUrlForHttp=${viewerUrlForHttp.slice(0, 160)})`,
        );
        console.log(
          `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} pdfExportAttempted=yes excelExportAttempted=yes path=noHandle-uses-exportReportFormat-with-http-fallback`,
        );
        const xResHttp = await pgc.exportReportFormat(
          activePage,
          "EXCELOPENXML",
          excelPath,
          null,
          viewerUrlForHttp,
        );
        entry.excelDownloaded = xResHttp.ok;
        entry.excelPath = xResHttp.ok ? excelPath : null;
        console.log(
          `[Montgomery][debug][reports] excelExport attempted ok=${xResHttp.ok} viaHttp=${!!xResHttp.viaHttp} error=${xResHttp.error || "(none)"}`,
        );
        const pResHttp = await pgc.exportReportFormat(
          activePage,
          "PDF",
          pdfPath,
          null,
          viewerUrlForHttp,
        );
        entry.pdfDownloaded = pResHttp.ok;
        entry.pdfPath = pResHttp.ok ? pdfPath : null;
        console.log(
          `[Montgomery][debug][reports] pdfExport attempted ok=${pResHttp.ok} viaHttp=${!!pResHttp.viaHttp} error=${pResHttp.error || "(none)"}`,
        );
        console.log(
          `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} pdfExportResult ok=${pResHttp.ok} viaHttp=${!!pResHttp.viaHttp} err=${pResHttp.error || "none"} excelExportResult ok=${xResHttp.ok} viaHttp=${!!xResHttp.viaHttp} err=${xResHttp.error || "none"}`,
        );
      } else {
        console.log(
          `[Montgomery][debug][reports] export path=withHandle attempt EXCELOPENXML+PDF with viewerHandle`,
        );
        console.log(
          `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} pdfExportAttempted=yes excelExportAttempted=yes path=withHandle-rv.exportReport`,
        );
        const xRes = await pgc.exportReportFormat(
          activePage,
          "EXCELOPENXML",
          excelPath,
          viewerHandle,
          viewerUrlForHttp,
        );
        entry.excelDownloaded = xRes.ok;
        entry.excelPath = xRes.ok ? excelPath : null;
        console.log(
          `[Montgomery][debug][reports] excelExport attempted ok=${xRes.ok} viaHttp=${!!xRes.viaHttp} error=${xRes.error || "(none)"}`,
        );
        await activePage.waitForTimeout(1000);
        const viewerHandlePdf =
          (await pgc.waitForPgcReportViewerHandle(activePage)) || viewerHandle;
        viewerUrlForHttp = activePage.url();
        const pRes = await pgc.exportReportFormat(
          activePage,
          "PDF",
          pdfPath,
          viewerHandlePdf,
          viewerUrlForHttp,
        );
        entry.pdfDownloaded = pRes.ok;
        entry.pdfPath = pRes.ok ? pdfPath : null;
        console.log(
          `[Montgomery][debug][reports] pdfExport attempted ok=${pRes.ok} viaHttp=${!!pRes.viaHttp} error=${pRes.error || "(none)"}`,
        );
        console.log(
          `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} pdfExportResult ok=${pRes.ok} viaHttp=${!!pRes.viaHttp} err=${pRes.error || "none"} excelExportResult ok=${xRes.ok} viaHttp=${!!xRes.viaHttp} err=${xRes.error || "none"}`,
        );
      }
      montgomeryReportsDeepEntryLine("after-file-export-attempts", entry);

      syncEntryFromReportViewerPage(true);
      applyKnownViewerUrl(activePage.url());

      const onViewer =
        /ReportViewer\.aspx/i.test(activePage.url()) ||
        /ReportViewer\.aspx/i.test(String(entry.viewUrl || ""));
      if (onViewer && !entry.pdfDownloaded && !entry.excelDownloaded) {
        const hasHttpExportHint = !!(entry.pdfHttpUrl || entry.excelHttpUrl);
        entry.exportUnavailable = !hasHttpExportHint;
        console.log(
          `[Montgomery][debug][reports] exportUnavailable=${entry.exportUnavailable} reason=on ReportViewer, both file exports false, httpExportHint=${hasHttpExportHint}`,
        );
      } else if (!onViewer) {
        entry.exportUnavailable = false;
        console.log(
          `[Montgomery][debug][reports] exportUnavailable=false (not on viewer page after export attempt; entry may still hold navigateUrl if it was ReportViewer)`,
        );
      }

      applyMontgomeryReportEntryHttpExportUrls(entry);
      montgomeryReportsDeepEntryLine("after-second-applyHttpExport", entry);

      const pdfDisk = !!(entry.pdfPath && fs.existsSync(entry.pdfPath));
      const xlDisk = !!(entry.excelPath && fs.existsSync(entry.excelPath));
      const pdfNullBecause =
        entry.pdfPublicUrl || entry.pdfHttpUrl
          ? "n/a-mapped-layer-has-pdfPublic-or-pdfHttp"
          : entry.pdfDownloaded && pdfDisk
            ? "downloaded-ok-await-upload-for-public-url"
            : entry.pdfDownloaded && !pdfDisk
              ? "pdfDownloaded-flag-but-file-missing-on-disk"
              : !viewerHandle && !/ReportViewer\.aspx/i.test(activePage.url())
                ? "no-viewer-handle-and-page-not-ReportViewer-http-export-likely-failed"
                : "exportReportFormat-pdf-not-ok-or-no-download-event";
      const xlNullBecause =
        entry.excelPublicUrl || entry.excelHttpUrl
          ? "n/a-mapped-layer-has-excelPublic-or-excelHttp"
          : entry.excelDownloaded && xlDisk
            ? "downloaded-ok-await-upload-for-public-url"
            : entry.excelDownloaded && !xlDisk
              ? "excelDownloaded-flag-but-file-missing-on-disk"
              : !viewerHandle && !/ReportViewer\.aspx/i.test(activePage.url())
                ? "no-viewer-handle-and-page-not-ReportViewer-http-export-likely-failed"
                : "exportReportFormat-excel-not-ok-or-no-download-event";
      console.log(
        `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} downloadPath pdf=${pdfDisk} excel=${xlDisk} pdfUrlStaysNullBecause=${pdfNullBecause} excelUrlStaysNullBecause=${xlNullBecause}`,
      );

      console.log(
        `[Montgomery][reports] export unavailable confirmed = ${entry.exportUnavailable ? "yes" : "no"} | ${spec.reportName}`,
      );
      console.log(
        `[Montgomery][debug][reports] summary reportName=${JSON.stringify(spec.reportName)} viewerReady=${entry.viewerReady} excelDownloaded=${entry.excelDownloaded} pdfDownloaded=${entry.pdfDownloaded} exportUnavailable=${entry.exportUnavailable} paths excel=${entry.excelPath ? "yes" : "no"} pdf=${entry.pdfPath ? "yes" : "no"}`,
      );
    } catch (e) {
      applyKnownViewerUrl(navigateUrl);
      const eu = String(entry.viewUrl || "");
      if (/ReportViewer\.aspx/i.test(eu) && /^https?:\/\//i.test(eu)) {
        entry.viewerReady = true;
        applyMontgomeryReportEntryHttpExportUrls(entry);
      }
      entry.exportError = (e && e.message) || String(e);
      console.warn(`[Montgomery][reports] error | ${spec.reportName}:`, e?.message || e);
      console.log(
        `[Montgomery][debug][reports] exception reportName=${JSON.stringify(spec.reportName)} message=${(e && e.message) || e}`,
      );
      montgomeryReportsDeepEntryLine("catch-after-recovery", entry);
      console.log(
        `[Montgomery][reports-deep] export report=${JSON.stringify(spec.reportName)} exceptionDuringExport=${String((e && e.message) || e).slice(0, 200)}`,
      );
    }
    montgomeryReportsDeepEntryLine("final-pre-push", entry);
    logReportFixSummary();
    {
      const vu = String(entry.viewUrl || entry.reportUrl || "");
      const viewerResolvedYes =
        /^https?:\/\//i.test(vu) && /ReportViewer\.aspx/i.test(vu);
      console.log(
        `[Montgomery][reports-fix2] report=${spec.reportName} viewerResolved=${viewerResolvedYes ? "yes" : "no"}`,
      );
    }
    reports.push(entry);
  }

  console.log(
    `[Montgomery][reports-deep] pipeline-return reports.length=${reports.length} summary=${JSON.stringify(
      reports.map((r) => ({
        name: r.reportName,
        viewUrlLen: String(r.viewUrl || "").length,
        reportUrlLen: String(r.reportUrl || "").length,
        viewerReady: !!r.viewerReady,
        pdfHttp: !!r.pdfHttpUrl,
        xlHttp: !!r.excelHttpUrl,
        pdfDl: !!r.pdfDownloaded,
        xlDl: !!r.excelDownloaded,
      })),
    )}`,
  );

  const pdfOk = reports.filter((r) => r.pdfDownloaded).length;
  const xlOk = reports.filter((r) => r.excelDownloaded).length;
  console.log(
    `[Montgomery][reports] phase done: entries=${reports.length} pdfOk=${pdfOk} excelOk=${xlOk} wfid=${wfid || "(none)"}`,
  );

  return {
    projectID,
    wflowInstanceID: wfid,
    reports,
  };
}

/**
 * @param {import('playwright').Page} page
 * @param {object} proj
 * @param {string[]} bases
 * @param {string} dashboardUrl
 * @param {{
 *   _montgomeryOmitTabs?: Record<string, boolean>,
 *   uploadLocal?: (localPath: string, storageKey: string) => Promise<string|null>,
 *   storagePrefix?: string,
 *   harvestFiles?: (
 *     page: import('playwright').Page,
 *     proj: { projectID: string, projectNumber?: string },
 *     webUiBase: string
 *   ) => Promise<any>,
 * }} [opts]
 */
async function runMontgomeryProductionPipeline(
  page,
  proj,
  bases,
  dashboardUrl,
  opts = {},
) {
  const omit = opts._montgomeryOmitTabs || {};
  const uploadLocal = opts.uploadLocal || null;
  const storagePrefix = (opts.storagePrefix || "montgomery").replace(/^\/+|\/+$/g, "");
  const harvestFiles = opts.harvestFiles || null;
  const webUiBase = bases[0] || DEFAULT_MONTGOMERY_WEBUI;
  const isCancelRequested =
    typeof opts.isCancelRequested === "function" ? opts.isCancelRequested : null;

  async function cancelled() {
    if (!isCancelRequested) return false;
    try {
      const v = isCancelRequested();
      return !!(v && typeof v.then === "function" ? await v : v);
    } catch (_) {
      return false;
    }
  }

  const skipDetail = !!(omit.info && omit.status && omit.tasks);
  const skipFiles = !!omit.files;
  const skipReports = !!omit.reports;

  console.log(
    `[Montgomery][mode] omit(files=${!!omit.files},reports=${!!omit.reports},info=${!!omit.info},status=${!!omit.status},tasks=${!!omit.tasks}) → run(files=${!skipFiles},reports=${!skipReports},detail=${!skipDetail})`,
  );

  if (await cancelled()) {
    return { cancelled: true, detailResult: { ok: true, out: null, skipped: true }, filesOut: { skipped: true }, reportsPayload: { skipped: true, reports: [] } };
  }

  /** @type {any} */
  let detailResult = { ok: true, out: null, skipped: true };
  if (!skipDetail) {
    detailResult = await scrapeMontgomeryProjectDetails(page, proj, webUiBase, omit);
  }
  if (await cancelled()) {
    return { cancelled: true, detailResult, filesOut: { skipped: true }, reportsPayload: { skipped: true, reports: [] } };
  }

  let wfid = extractWfidFromMontgomeryStatusTab(detailResult.out?.statusTab);
  if (wfid) {
    console.log(
      `[Montgomery][reports-fix] wflowInstanceID from statusTab for pipeline: ${wfid}`,
    );
  }

  const workflowPack = {
    workflow: {
      wflowInstanceID: wfid,
      source: wfid ? "montgomery_status_or_grid" : "missing",
      wflowInstanceStateName: null,
      instanceName: null,
      workflowName: null,
      rawWorkflowCount: 0,
      tasksDomPattern: "montgomery_tasks_workflows",
      correctionsPrimaryUrl: null,
      taskListUrl: null,
      taskListOk: false,
      userID: null,
    },
    reviewProbe: null,
    correctionsProbeUrl: null,
    correctionsJson: null,
    taskListMeta: null,
  };

  const reviewOut = {
    skipped: true,
    projectID: String(proj.projectID),
    wflowInstanceID: wfid,
    reviewGroupsCount: 0,
    rawCorrectionsCount: 0,
    latestCycleCorrectionsCount: 0,
    changemarkCount: 0,
    commentCount: 0,
    unresolvedCount: 0,
    resolvedCount: 0,
    statusCounts: {},
    latestCycleCorrections: [],
    workflowBuckets: [],
    markupArtifacts: [],
    markupPdfUniqueCount: 0,
    markupPdfDownloadedCount: 0,
  };

  let filesOut = {
    projectID: String(proj.projectID),
    foldersCount: 0,
    filesCount: 0,
    sampledDownloadsCount: 0,
    folders: [],
    sampleFiles: [],
    downloadedFiles: [],
    _meta: {
      fileApiFailures: 0,
      largeFilesSkipped: 0,
      downloadAttempts: 0,
      downloadsOk: 0,
      uploadsOk: 0,
      failures: 0,
    },
  };
  if (!skipFiles) {
    if (await cancelled()) {
      return {
        cancelled: true,
        detailResult,
        workflowPack,
        reviewOut,
        filesOut: { ...filesOut, skipped: true },
        reportsPayload: { skipped: true, reports: [] },
        _montgomeryOmitTabs: omit,
      };
    }
    filesOut = harvestFiles
      ? await harvestFiles(page, proj, webUiBase)
      : await harvestMontgomeryFilesByCategory(page, proj, webUiBase);
  }

  let reportsPayload = { skipped: true, reports: [] };
  if (!skipReports) {
    if (await cancelled()) {
      return {
        cancelled: true,
        detailResult,
        workflowPack,
        reviewOut,
        filesOut,
        reportsPayload,
        _montgomeryOmitTabs: omit,
      };
    }
    reportsPayload = await processMontgomerySsrReportsForProject(page, proj, wfid, {
      webUiBase,
      dashboardUrl,
      statusTab: detailResult.out?.statusTab ?? null,
    });
    if (uploadLocal && reportsPayload.reports?.length) {
      for (const r of reportsPayload.reports) {
        if (await cancelled()) {
          return {
            cancelled: true,
            detailResult,
            workflowPack,
            reviewOut,
            filesOut,
            reportsPayload,
            _montgomeryOmitTabs: omit,
          };
        }
        const slug = r.fileSlug || "report";
        try {
          if (r.excelPath && fs.existsSync(r.excelPath)) {
            const u = await uploadLocal(
              r.excelPath,
              `${storagePrefix}/reports/${slug}.xlsx`,
            );
            if (u) {
              r.excelPublicUrl = u;
              console.log(`[Montgomery][reports] resolved excelUrl = ${u}`);
            }
          }
          if (r.pdfPath && fs.existsSync(r.pdfPath)) {
            const u = await uploadLocal(
              r.pdfPath,
              `${storagePrefix}/reports/${slug}.pdf`,
            );
            if (u) {
              r.pdfPublicUrl = u;
              console.log(`[Montgomery][reports] resolved pdfUrl = ${u}`);
            }
          }
        } catch (e) {
          console.warn("[Montgomery][reports] upload:", e?.message || e);
        }
      }
    }
  }

  if (await cancelled()) {
    return {
      cancelled: true,
      detailResult,
      workflowPack,
      reviewOut,
      filesOut,
      reportsPayload,
      _montgomeryOmitTabs: omit,
    };
  }

  return {
    detailResult,
    workflowPack,
    reviewOut,
    filesOut,
    reportsPayload,
    _montgomeryOmitTabs: omit,
  };
}

module.exports = {
  isMontgomeryProjectDoxHost,
  MONTGOMERY_HOST_MARKER,
  DEFAULT_MONTGOMERY_WEBUI,
  MONTGOMERY_TARGET_REPORT_NAMES,
  resolveMontgomeryWebUiBases,
  buildMontgomeryProjectTabUrl,
  runMontgomeryProductionPipeline,
};
