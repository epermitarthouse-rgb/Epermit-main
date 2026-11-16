#!/usr/bin/env node
/**
 * Finding-level scoring for analyzer runs (saved GPT-4o runs and new stage 4 runs).
 *
 * Each published finding is pre-screened against fixtures/known-issues.json (genuine, plausible,
 * trap, harness) and its quoted evidence is checked against the ground truth, the PDF text layer and
 * every saved OCR read of the sheet (Apple Vision 12x9 and Qwen). A finding no pattern settles gets
 * its class from fixtures/adjudication.json (keyed by finding id), or stays "unadjudicated".
 *
 *   node eval-findings.mjs --calibrate                 screen the 143 hand-classified Phase 6 findings
 *   node eval-findings.mjs --runs <dir> [--runs <dir>] score run files (one JSON per call)
 *
 * Classes follow 07-finding-root-cause: E confirmed error, H harness/index artifact, U unsupported,
 * Q uncertain, OK correct, OKs correct with severity too high.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { canonicalSheet } from "./stage3-link.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATASET = path.resolve(HERE, "..");
const OUT = path.join(DATASET, "out/qwen-spatial-audit");
const RESEARCH = path.join(DATASET, "out/gpt-5.4-audit-3364698b/ocr-research-final");
const KNOWN = JSON.parse(readFileSync(path.join(HERE, "fixtures/known-issues.json"), "utf8"));
const ADJ_PATH = path.join(HERE, "fixtures/adjudication.json");
const ADJ = existsSync(ADJ_PATH) ? JSON.parse(readFileSync(ADJ_PATH, "utf8")).findings || {} : {};
const INDEX82 = JSON.parse(readFileSync(path.join(OUT, "index82.json"), "utf8"));
const SHEET_KEYS = new Set(INDEX82.sheets.map((s) => s.sheetKey).filter(Boolean));

const rx = (s) => new RegExp(s, "i");
const allOf = (pats, t) => pats.every((p) => rx(p).test(t));
const anyOf = (pats, t) => !pats.length || pats.some((p) => p === "" || rx(p).test(t));
const noneOf = (pats, t) => !pats.some((p) => rx(p).test(t));
const sheetMatches = (rule, sheet) => rule.sheet === "*" || canonicalSheet(rule.sheet) === canonicalSheet(sheet);
const textOf = (f) => [f.title, f.observation, f.validation?.originalObservation, f.drawing_evidence, f.recommendation].filter(Boolean).join("\n");

export function screen(f, sheet) {
  const t = textOf(f);
  for (const g of KNOWN.genuine) if (sheetMatches(g, sheet) && allOf(g.all, t) && anyOf(g.any, t) && noneOf(g.none, t)) return { screen: g.id, cls: "genuine", severityOk: g.expectedSeverity.includes(f.severity) };
  for (const g of KNOWN.plausible) if (sheetMatches(g, sheet) && allOf(g.all, t) && anyOf(g.any, t)) return { screen: g.id, cls: "plausible" };
  for (const g of KNOWN.traps) if (sheetMatches(g, sheet) && allOf(g.all, t) && anyOf(g.any, t) && noneOf(g.none, t)) return { screen: g.id, cls: "trap" };
  const tokens = [...t.toUpperCase().matchAll(/\b[A-Z]{1,2}-?\d{1,3}(?:\.\d{1,2})?\b/g)].map((m) => canonicalSheet(m[0])).filter((k) => k && SHEET_KEYS.has(k) && k !== canonicalSheet(sheet));
  if (tokens.length && anyOf(KNOWN.harness.any, t)) return { screen: KNOWN.harness.id, cls: "harness", sheets: [...new Set(tokens)] };
  return { screen: null, cls: null };
}

// ---- quote grounding ---------------------------------------------------------------------------
const key = (s) => String(s || "").toUpperCase().replace(/[″“”]/g, '"').replace(/[’‘]/g, "'").replace(/[^A-Z0-9'"/.\-]/g, "");
const sourceCache = new Map();
function sourcesFor(sheet) {
  if (sourceCache.has(sheet)) return sourceCache.get(sheet);
  const texts = [];
  const gt = path.join(RESEARCH, "implementation/data/gt", `${sheet}.ground-truth.json`);
  if (existsSync(gt)) texts.push(...JSON.parse(readFileSync(gt, "utf8")).rows.map((r) => r.text));
  const s1 = path.join(OUT, "sheets", sheet, "stage1/stage1.json");
  if (existsSync(s1)) texts.push(...JSON.parse(readFileSync(s1, "utf8")).textLayer.lines.map((l) => l.text));
  const o12 = path.join(RESEARCH, "implementation/data/ocr12x9", `${sheet}.json`);
  if (existsSync(o12)) texts.push(...JSON.parse(readFileSync(o12, "utf8")).observations.map((o) => o.text));
  const s2 = path.join(OUT, "sheets", sheet, "stage2");
  if (existsSync(s2)) for (const f of readdirSync(s2).filter((x) => x.startsWith("sheet-index."))) texts.push(...JSON.parse(readFileSync(path.join(s2, f), "utf8")).lines.map((l) => l.text));
  const keys = texts.map(key).filter((k) => k.length >= 2);
  sourceCache.set(sheet, keys);
  return keys;
}

/** Quoted spans of the evidence (or the whole field); a span is grounded when every ` / ` row is read somewhere. */
export function grounding(f, sheet) {
  const ev = String(f.drawing_evidence || "");
  const quoted = [...ev.matchAll(/'([^']{4,})'|"([^"]{4,})"|‘([^’]{4,})’|“([^”]{4,})”/g)].map((m) => m[1] || m[2] || m[3] || m[4]);
  const spans = quoted.length ? quoted : [ev];
  const src = sourcesFor(sheet);
  const pieces = spans.flatMap((s) => s.split(/\s+\/\s+|\s*\|\s*|;\s+/)).map(key).filter((k) => k.length >= 4);
  if (!pieces.length) return { spans: 0, grounded: 0, status: "no_quote" };
  const ok = pieces.filter((p) => src.some((s) => s.includes(p) || (p.length >= 12 && p.includes(s) && s.length >= 0.7 * p.length)));
  return { spans: pieces.length, grounded: ok.length, status: ok.length === pieces.length ? "grounded" : ok.length ? "partly_grounded" : "not_found" };
}

export const findingId = (run, f) => createHash("sha256").update(`${run.sheetId}|${run.arm}|${run.rep}|${f.title}|${f.drawing_evidence}`).digest("hex").slice(0, 12);

export function scoreFinding(run, f) {
  const s = screen(f, run.sheetId);
  const g = grounding(f, run.sheetId);
  const id = findingId(run, f);
  const manual = ADJ[id];
  const cls = manual?.class
    || (s.cls === "genuine" ? (s.severityOk ? "OK" : "OKs") : s.cls === "trap" ? "E" : s.cls === "harness" ? "H" : s.cls === "plausible" ? "Q" : "unadjudicated");
  return { id, severity: f.severity, title: f.title, screen: s.screen, screenClass: s.cls, grounding: g.status, class: cls, cause: manual?.cause || s.screen || null, note: manual?.note || null, adjudicated: Boolean(manual) };
}

export function scoreRuns(runs) {
  const rows = [];
  runs.forEach((r, runIdx) => {
    Object.defineProperty(r, "runIdx", { value: runIdx, enumerable: false, configurable: true });
    for (const f of r.published || []) rows.push({ sheet: r.sheetId, arm: r.arm, rep: r.rep, model: r.model, runIdx, ...scoreFinding(r, f) });
  });
  return rows;
}

export function tallyArm(rows, runs) {
  const by = (pred) => rows.filter(pred).length;
  const warn = (r) => r.severity === "warning" || r.severity === "critical";
  const genuineIds = [...new Set(KNOWN.genuine.map((g) => g.id))];
  const perRun = runs.map((r) => new Set(rows.filter((x) => x.runIdx === r.runIdx && x.class.startsWith("OK")).map((x) => x.screen)));
  const s201Runs = runs.filter((r) => canonicalSheet(r.sheetId) === "S-201");
  const s201Idx = runs.map((r, i) => [r, i]).filter(([r]) => canonicalSheet(r.sheetId) === "S-201").map(([, i]) => i);
  return {
    runs: runs.length, published: rows.length, warningPlus: by(warn),
    E: by((r) => r.class === "E"), H: by((r) => r.class === "H"), U: by((r) => r.class === "U"), Q: by((r) => r.class === "Q"), OK: by((r) => r.class === "OK"), OKs: by((r) => r.class === "OKs"),
    unadjudicated: by((r) => r.class === "unadjudicated"),
    warningPlusE: by((r) => warn(r) && r.class === "E"), warningPlusNotGenuine: by((r) => warn(r) && !r.class.startsWith("OK") && r.class !== "Q"),
    critical: by((r) => r.severity === "critical"), criticalE: by((r) => r.severity === "critical" && r.class === "E"),
    groundedQuotes: by((r) => r.grounding === "grounded"), notFoundQuotes: by((r) => r.grounding === "not_found"),
    genuineDetections: Object.fromEntries(genuineIds.map((g) => [g, `${s201Idx.filter((i) => perRun[i].has(g)).length}/${s201Runs.length}`])),
    costUsd: Number(runs.reduce((s, r) => s + (Number(r.costUsd) || 0), 0).toFixed(4)),
    inputTokens: runs.reduce((s, r) => s + (Number(r.inputTokens) || 0), 0), outputTokens: runs.reduce((s, r) => s + (Number(r.outputTokens) || 0), 0),
    meanLatencyS: runs.length ? Number((runs.reduce((s, r) => s + (Number(r.latencyMs) || 0), 0) / runs.length / 1000).toFixed(1)) : null,
  };
}

function loadRuns(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes("error")).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}

function calibrate() {
  const dir = path.join(RESEARCH, "implementation/data/phase6-analyzer-runs");
  const runs = loadRuns(dir);
  const csv = readFileSync(path.join(RESEARCH, "07-finding-root-cause/data/finding-inventory.csv"), "utf8").trim().split("\n").slice(1);
  const manual = csv.map((l) => { const m = l.match(/^(F\d+),([^,]+),([^,]+),(\d),(\w+),"(.*?)",(\w+),([^,]*),/); return m ? { id: m[1], cls: m[7], cause: m[8] } : null; }).filter(Boolean);
  let n = 0;
  const conf = {};
  const misses = [];
  const groundingByClass = {};
  for (const r of runs) for (const f of r.published) {
    const m = manual[n++];
    const s = screen(f, r.sheetId);
    const g = grounding(f, r.sheetId).status;
    groundingByClass[m.cls] = { ...(groundingByClass[m.cls] || {}), [g]: ((groundingByClass[m.cls] || {})[g] || 0) + 1 };
    const k = `${s.cls || "none"} -> ${m.cls}`;
    conf[k] = (conf[k] || 0) + 1;
    if (s.cls && !((s.cls === "genuine" && m.cls.startsWith("OK")) || (s.cls === "trap" && m.cls === "E") || (s.cls === "harness" && m.cls === "H") || (s.cls === "plausible" && m.cls === "Q"))) misses.push({ id: m.id, screen: s.screen, manual: m.cls, cause: m.cause, title: f.title });
  }
  const fired = Object.entries(conf).filter(([k]) => !k.startsWith("none")).reduce((s, [, v]) => s + v, 0);
  const out = { findings: n, screened: fired, agreeing: fired - misses.length, confusion: conf, disagreements: misses, groundingByManualClass: groundingByClass,
    manualE_notScreened: Object.entries(conf).filter(([k]) => k === "none -> E").map(([, v]) => v)[0] || 0 };
  mkdirSync(path.join(OUT, "eval"), { recursive: true });
  writeFileSync(path.join(OUT, "eval/finding-screen-calibration.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.trim().split("\n")) {
    const cells = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q && c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = !q; else if (c === "," && !q) { cells.push(cur); cur = ""; } else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** Saved manual classes (07 inventory and the 07/09 verify scoring) as adjudications of the saved runs. */
const BASELINES = [
  { label: "phase6", runs: "implementation/data/phase6-analyzer-runs", csv: "07-finding-root-cause/data/finding-inventory.csv" },
  { label: "verify07", runs: "07-finding-root-cause/impl/verify/runs", csv: "07-finding-root-cause/impl/verify/scoring.csv" },
  { label: "verify09", runs: "09-v2-downstream/verify/runs", csv: "09-v2-downstream/verify/scoring.csv" },
];

function seed() {
  const findings = {};
  const report = {};
  for (const b of BASELINES) {
    const manual = parseCsv(readFileSync(path.join(RESEARCH, b.csv), "utf8")).filter((m) => !m.state || m.state === "published");
    const pool = new Map();
    for (const m of manual) { const k = `${canonicalSheet(m.sheet)}|${m.arm}|${m.rep}|${m.title}`; pool.set(k, [...(pool.get(k) || []), m]); }
    let matched = 0, unmatched = 0;
    for (const r of loadRuns(path.join(RESEARCH, b.runs))) for (const f of r.published || []) {
      const m = pool.get(`${canonicalSheet(r.sheetId)}|${r.arm}|${r.rep}|${f.title}`)?.shift();
      if (!m) { unmatched++; continue; }
      matched++;
      findings[findingId(r, f)] = { class: m.class, cause: m.cause, note: m.note, source: `${b.csv}${m.id ? ` ${m.id}` : ""}` };
    }
    report[b.label] = { manualRows: manual.length, matched, unmatched };
  }
  const prior = existsSync(ADJ_PATH) ? JSON.parse(readFileSync(ADJ_PATH, "utf8")).findings || {} : {};
  writeFileSync(ADJ_PATH, JSON.stringify({ version: "qsa.adjudication.v1", note: "Saved baseline classes are copied from the research CSVs; new-run entries are added by hand after reading the finding and the sheet.", findings: { ...prior, ...findings } }, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

function main() {
  if (process.argv.includes("--calibrate")) return calibrate();
  if (process.argv.includes("--seed-baselines")) return seed();
  const dirs = process.argv.flatMap((a, i) => (process.argv[i - 1] === "--runs" ? [a] : []));
  const label = process.argv[process.argv.indexOf("--label") + 1] || "runs";
  const runs = dirs.flatMap(loadRuns);
  const rows = scoreRuns(runs);
  const arms = [...new Set(runs.map((r) => r.arm))];
  const byArm = Object.fromEntries(arms.map((a) => [a, tallyArm(rows.filter((r) => r.arm === a), runs.filter((r) => r.arm === a))]));
  mkdirSync(path.join(OUT, "eval"), { recursive: true });
  writeFileSync(path.join(OUT, "eval", `findings.${label}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), byArm, rows }, null, 1));
  console.log(JSON.stringify(byArm, null, 1));
  const open = rows.filter((r) => r.class === "unadjudicated");
  if (open.length) console.log(`${open.length} findings need adjudication (fixtures/adjudication.json keyed by id)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
