/**
 * Stage 5: consolidate the Qwen + GPT-5.6 Luna runs into one reviewable analysis (local experiment).
 *
 * Client findings are the adjudicated claims of the Qwen arms (L_spatial, L_spatial2). Each finding uses
 * the model's own draft text; the production validator outcome, stability across repetitions, evidence
 * units (boxes, tiles, OCR uncertainty), adjudication and crops are kept in an internal audit record.
 *
 * Writes out/qwen-spatial-audit/e2e/: qwen-analysis.dataset.json (AnalyzerRunDataset + audit),
 * comparison.json, PermitPilot-Qwen-Luna-analysis.json (production JSON export) and .pdf (production PDF).
 *
 * Usage (repo root): npx tsx eval/drawing-dataset/qwen-spatial-audit/stage5-consolidate.ts
 */
import { webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildArchitectReviewModel, fingerprintArchitectReview } from "@/lib/supabaseAnalyzer/architectReview";
import { renderArchitectReviewPdf } from "@/lib/supabaseAnalyzer/brandedReport";
import { buildSupabaseAnalyzerJsonExport } from "@/lib/supabaseAnalyzer/exportDataset";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding, SupabaseAnalyzerSheetJob } from "@/lib/supabaseAnalyzer/client";
import { findingId, screen } from "./eval-findings.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.resolve(HERE, "../out/qwen-spatial-audit");
const RUNS = path.join(OUT, "stage4/runs");
const RESEARCH = path.resolve(HERE, "../out/gpt-5.4-audit-3364698b/ocr-research-final");
const BASELINE_DIRS = ["implementation/data/phase6-analyzer-runs", "07-finding-root-cause/impl/verify/runs", "09-v2-downstream/verify/runs"].map((d) => path.join(RESEARCH, d));
const E2E = path.join(OUT, "e2e");
const SHEETS = ["A-3.06-00", "A-4.00-00", "A-1.01-00", "A-6.00-00", "S-201.00"];
const QWEN_ARMS = ["L_spatial", "L_spatial2"];
const RUN_ID = "qwen-luna-e2e-20261117";
const PROJECT = "75 New York Ave & 1st St, Washington DC (Permit Rev 5)";
const CREATED = "2026-11-17T12:00:00.000Z";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const text = (f: any) => [f.title, f.observation, f.drawing_evidence, f.validation?.originalObservation].filter(Boolean).join("\n");

type Status = "confirmed_by_drawing" | "preliminary" | "requires_professional_verification";
export const STATUS_LABEL: Record<Status, string> = {
  confirmed_by_drawing: "Confirmed by drawing evidence",
  preliminary: "Preliminary concern",
  requires_professional_verification: "Requires professional verification",
};

/** Claims verified against the drawings; detection patterns are applied to every draft of every arm. */
const CLAIMS: Array<{
  id: string; sheet: string; match: (t: string, f: any) => boolean; okTitle?: RegExp; client?: { arm: string; rep: number; title: string };
  status?: Status; codeBasis?: string; relatedSheets?: string[]; adjudication: string; crops?: string[]; excluded?: string;
}> = [
  { id: "S201-SOIL", sheet: "S-201.00", match: (t) => /1,?500 ?PSF/i.test(t) && /2,?500 ?PSF/i.test(t),
    client: { arm: "L_spatial2", rep: 2, title: "Conflicting soil pressure values appear in structural notes" }, status: "requires_professional_verification",
    codeBasis: "Foundation design basis; the governing soil value is an engineering determination (code section not cited).",
    adjudication: "Masonry and foundation note 1 'ASSUMED BEARING CAPACITY OF SOIL IS 1,500 PSF' and note 8 'FIRM UNDISTURBED SOIL, OF MINIMUM DESIGN SOIL PRESSURE 2,500 PSF' are both printed.",
    crops: ["inspect/findings/S-201.00.soilnote1.png", "inspect/findings/S-201.00.soil1.png"] },
  { id: "S201-SCALE", sheet: "S-201.00", match: (t, f) => screen(f, "S-201.00").screen === "G-S201-SCALE",
    client: { arm: "L_spatial2", rep: 1, title: "Wall Section 2 scale notation is malformed" }, status: "confirmed_by_drawing",
    codeBasis: "Drafting quality; no code requirement.", adjudication: "Text layer prints '3/4\"1'-0\"' under detail 2 and '3/4\"=1'-0\"' under detail 1." },
  { id: "S201-OF00", sheet: "S-201.00", match: (t, f) => screen(f, "S-201.00").screen === "G-S201-OF00",
    client: { arm: "L_spatial2", rep: 2, title: "Sheet-count field appears incomplete" }, status: "confirmed_by_drawing",
    codeBasis: "Drafting quality; no code requirement.", adjudication: "Text layer prints 'AS NOTED / OF 00' in the title block." },
  { id: "S201-ACI", sheet: "S-201.00", match: (t) => /318-06/.test(t),
    client: { arm: "L_spatial2", rep: 1, title: "Concrete reference identifies an older ACI edition" }, status: "requires_professional_verification",
    codeBasis: "Referenced-standard edition under the 2015 IBC base; requires code verification (code text not retrieved).",
    adjudication: "Reinforced concrete note 1 prints 'ACI 318-06'; design data cites IBC 2015.", crops: ["inspect/findings/S-201.00.aci0.png"] },
  { id: "S201-1705", sheet: "S-201.00", match: (t) => /1705\.3\.4/.test(t),
    client: { arm: "L_spatial2", rep: 3, title: "Cold-formed-steel special-inspection cross-reference requires verification" }, status: "preliminary",
    codeBasis: "Special-inspection section numbering; requires code verification (code text not retrieved).",
    adjudication: "Cloud prints 'D. COLD-FORMED STEEL 1705.3.4'; correctness of the section depends on the code text.", crops: ["inspect/findings/S-201.00.specialD.png"] },
  { id: "S201-SDC", sheet: "S-201.00", match: (t, f) => screen(f, "S-201.00").screen === "G-S201-SDC", okTitle: /seismic/i,
    adjudication: "SEISMIC USE GROUP and SEISMIC DESIGN CATEGORY are printed without values (crop S-201.00.seismic1.png). Not produced by any Luna arm." },
  { id: "A101-LEVEL", sheet: "A-1.01-00", match: (t) => /MEZZANINE/i.test(t) && /2ND/i.test(t),
    client: { arm: "L_spatial2", rep: 3, title: "Floor designation differs between plan title and title block" }, status: "confirmed_by_drawing",
    codeBasis: "Drawing coordination. Whether the level is a mezzanine or a story affects code analysis and needs the designer.",
    adjudication: "Title block 'MEZZANINE & BASEMENT FLOOR PLAN'; plan titles '2ND FLOOR ALTERATION FLOOR PLAN' and 'BASEMENT ALTERATION FLOOR PLAN' (text layer)." },
  { id: "A101-A117", sheet: "A-1.01-00", match: (t) => /A117\.1-2003/i.test(t),
    client: { arm: "L_spatial2", rep: 1, title: "Accessibility standard edition cited in general notes should be verified" }, status: "requires_professional_verification",
    codeBasis: "Accessibility standard edition referenced by the 2015 IBC base; requires code verification (code text not retrieved).",
    adjudication: "General note 4 prints '(ICC/ANSI A117.1-2003)'.", crops: ["inspect/findings/A-1.01-00.adanotes2.png"] },
  { id: "A101-TYPO", sheet: "A-1.01-00", match: (t) => /COMPLAINT/.test(t), adjudication: "Note 5 prints 'ADA COMPLAINT HARDWARE'. Produced only by the Apple Vision arm." },
  { id: "A400-SIGN", sheet: "A-4.00-00", match: (t) => /CENTERLINE/i.test(t) && /(BRAILLE|TACTILE)/i.test(t),
    client: { arm: "L_spatial2", rep: 2, title: "Conflicting signage mounting-height criteria" }, status: "requires_professional_verification",
    codeBasis: "Tactile sign mounting height (accessibility standard); requires code verification (code text not retrieved).",
    adjudication: "Signage note 2 'MOUNTING HEIGHT SHALL BE 60\" ABOVE THE FINISHED FLOOR TO THE CENTERLINE OF THE SIGN'; detail 4 '48\" MIN. AFF. B. OF BRAILLE / 60\" MAX. AFF. T. OF TACTILE'.",
    crops: ["inspect/findings/A-4.00-00.signnote.png", "inspect/findings/A-4.00-00.signage2.png"] },
  { id: "A400-NOTUSED", sheet: "A-4.00-00", match: (t) => /NOT USED/.test(t) && /LAVATORY/i.test(t),
    adjudication: "Callout 8/A400 under detail 5 points to detail 8 LAVATORY SECTION, marked NOT USED. Produced only by the Apple Vision arm; the Qwen linker does not parse unhyphenated sheet tags." },
  { id: "A600-A50", sheet: "A-6.00-00", match: (t) => /A5\.0\b/.test(t), adjudication: "'4/A5.0' printed; no A-5 series sheet in the 82-sheet set. Produced only by the Apple Vision arm." },
  { id: "A600-D11", sheet: "A-6.00-00", match: (t, f) => screen(f, "A-6.00-00").screen === "P-A600-D11", adjudication: "Plausible (saved research): fire-rated gaskets at door #11 without a rating column. Not produced by any arm." },
  { id: "REV00", sheet: "*", match: (t) => /FIRST ISSUE/i.test(t), adjudication: "'00 / FIRST ISSUE / 00' is the revision-table template on every sheet.", excluded: "template placeholder, not a demonstrated error" },
  { id: "A400-FLUSH", sheet: "A-4.00-00", match: (t) => /FLUSH VALVE/i.test(t), adjudication: "Terminology only.", excluded: "terminology only; no compliance consequence shown" },
  { id: "S201-REVTABLE", sheet: "S-201.00", match: (t) => /REVISED PERMIT SET/i.test(t) && /revision/i.test(t), adjudication: "Blank revision rows on a revised sheet.", excluded: "administrative; low value" },
];

function loadRuns(dir: string, filter: (f: string) => boolean) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => /\.r\d\.json$/.test(f) && filter(f)).map((f) => ({ file: path.join(dir, f), ...readJson(path.join(dir, f)) })) : [];
}

const ADJ = readJson(path.join(HERE, "fixtures/adjudication.json")).findings;

/** A run detects a claim when a finding matches its pattern, or was hand-adjudicated correct with a matching title. */
function detection(runs: any[], claim: (typeof CLAIMS)[number]) {
  const mine = runs.filter((r) => claim.sheet === "*" || r.sheetId === claim.sheet);
  const drafts = (r: any) => r.drafts || r.published || [];
  const hit = (r: any, f: any) => claim.match(text(f), f)
    || Boolean(claim.okTitle?.test(f.title) && String(ADJ[findingId(r, f)]?.class || "").startsWith("OK"));
  const drafted = mine.filter((r) => drafts(r).some((f: any) => hit(r, f))).length;
  const published = mine.filter((r) => (r.published || []).some((f: any) => hit(r, f))).length;
  return { runs: mine.length, drafted, published };
}

function evidenceUnits(sheet: string, ids: string[] = []) {
  const pack = readJson(path.join(OUT, "evidence", `${sheet}.spatial.pack.json`));
  const all = new Map([...pack.shown, ...pack.omitted, ...(pack.captions || [])].map((u: any) => [u.id, u]));
  return ids.map((id) => {
    const u: any = all.get(id);
    if (!u) return { id, status: "not_in_pack" };
    return { id, region: u.region, text: u.text, uncertain: u.uncertain, inSummary: pack.shown.includes(u),
      boxes: u.copies.map((c: any) => c.box), tiles: [...new Set(u.copies.flatMap((c: any) => c.lines.flatMap((l: any) => l.tiles)))] };
  });
}

function firstSentence(s: string) {
  const m = String(s || "").match(/^.*?\.(\s|$)/);
  return (m ? m[0] : s).trim();
}

async function main() {
  mkdirSync(E2E, { recursive: true });
  const luna = loadRuns(RUNS, (f) => f.includes(".openrouter-72b."));
  const byArm = (arm: string) => luna.filter((r) => r.arm === arm);
  const baseline = BASELINE_DIRS.flatMap((d) => loadRuns(d, (f) => f.includes(".C_v2_4x3.")));
  const ledger = readFileSync(path.join(OUT, "stage4/ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const evalLuna = readJson(path.join(OUT, "eval/findings.luna-e2e.json"));
  const evalBase = readJson(path.join(OUT, "eval/findings.baseline-gpt4o.json"));

  const jobs: SupabaseAnalyzerSheetJob[] = SHEETS.map((sheet, i) => {
    const runs = byArm("L_spatial2").filter((r) => r.sheetId === sheet);
    const rep = runs.find((r) => r.rep === 2) || runs[0];
    return {
      id: `job-${sheet}`, run_id: RUN_ID, project_id: "experimental", ordinal: i + 1, original_file_name: `${sheet}.pdf`, object_path: "",
      file_size: 0, discipline: rep.detected.discipline, detected_sheet_number: sheet, detected_sheet_title: rep.detected.title, status: "completed",
      attempt_count: 1, max_attempts: 1, last_error: null, error_code: null,
      input_tokens: runs.reduce((s, r) => s + r.inputTokens, 0), output_tokens: runs.reduce((s, r) => s + r.outputTokens, 0),
      estimated_cost_usd: Number(runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)), analysis_summary: firstSentence(rep.summary),
      created_at: CREATED, updated_at: CREATED,
    };
  });

  const findings: SupabaseAnalyzerFinding[] = [];
  const audit: Record<string, unknown> = {};
  for (const c of CLAIMS.filter((x) => x.client && !x.excluded)) {
    const run = luna.find((r) => r.arm === c.client!.arm && r.sheetId === c.sheet && r.rep === c.client!.rep);
    if (!run) throw new Error(`missing run for ${c.id}`);
    const draft = run.drafts.find((d: any) => d.title === c.client!.title);
    if (!draft) throw new Error(`missing draft "${c.client!.title}" for ${c.id}`);
    const pub = run.published.find((p: any) => (p.validation?.originalTitle || p.title) === draft.title);
    const held = run.withheld.find((w: any) => w.title === draft.title);
    const job = jobs.find((j) => j.detected_sheet_number === c.sheet)!;
    const id = `qf-${c.id.toLowerCase()}`;
    const statusLine = `Review status: ${STATUS_LABEL[c.status!]}.`;
    findings.push({
      id, run_id: RUN_ID, sheet_job_id: job.id, finding_index: findings.filter((f) => f.sheet_job_id === job.id).length + 1,
      category: draft.category, severity: draft.severity, title: draft.title, observation: draft.observation, drawing_evidence: draft.drawing_evidence,
      drawing_location: draft.drawing_location, suggested_code_reference: pub?.suggested_code_reference || null,
      recommendation: `${draft.recommendation} ${statusLine}`, ai_provider: "openai", ai_model: run.model, jurisdiction_key: "dc", code_edition: "2017",
      provenance_status: "experimental_qwen72b_gpt56luna", verification_status: c.status!, created_at: CREATED,
    });
    const stability = Object.fromEntries(QWEN_ARMS.map((a) => [a, detection(byArm(a), c)]));
    audit[id] = {
      claimId: c.id, status: c.status, statusLabel: STATUS_LABEL[c.status!], internalConfidence: draft.confidence, modelEvidenceStatus: draft.evidence_status,
      findingType: draft.finding_type, relatedSheets: (draft.source_sheets || []).filter((s: string) => s !== c.sheet), codeBasis: c.codeBasis,
      modelCitation: draft.suggested_code_reference || null,
      stability, ocr: { evidenceUnits: evidenceUnits(c.sheet, draft.evidence_ids), anyUncertain: evidenceUnits(c.sheet, draft.evidence_ids).some((u: any) => u.uncertain) },
      provenance: { runFile: path.relative(OUT, run.file), responseId: run.responseId, model: run.model, arm: run.arm, rep: run.rep, evidenceSha: run.input.evidenceSha, systemPromptSha: run.input.systemPromptSha },
      productionValidator: pub ? { outcome: pub.validation.outcome, rules: pub.validation.rules, publishedTitle: pub.title, publishedSeverity: pub.severity } : held ? { outcome: "withheld", rules: held.rules } : { outcome: "not_found" },
      adjudication: { note: c.adjudication, crops: c.crops || [], by: "evaluator (not a licensed professional)" },
    };
  }

  const ledgerCalls = new Map<string, any>();
  for (const e of ledger) ledgerCalls.set(e.callId, { ...(ledgerCalls.get(e.callId) || {}), ...e });
  const spent = [...ledgerCalls.values()].reduce((s, e) => s + (e.type === "settle" ? Number(e.costUsd) : Number(e.worstUsd)), 0);
  const qwenCost = QWEN_ARMS.flatMap(byArm).reduce((s, r) => s + r.costUsd, 0);
  const run = {
    id: RUN_ID, project_id: "experimental", created_by: "evaluation", status: "completed" as const, jurisdiction_key: "dc", jurisdiction_label: "Washington, DC",
    project_type: "Commercial (General)", code_edition: "2017", code_context: "2017 District of Columbia Construction Codes (2015 IBC base)", analysis_mode: "both" as const,
    source_coverage: "Five drawings: A-3.06, A-4.00, A-1.01, A-6.00, S-201 (82-sheet set index)", ai_provider: "openai", ai_model: "gpt-5.6-luna",
    total_sheets: 5, uploaded_sheets: 5, queued_sheets: 0, processing_sheets: 0, completed_sheets: 5, failed_sheets: 0,
    total_input_tokens: jobs.reduce((s, j) => s + j.input_tokens, 0), total_output_tokens: jobs.reduce((s, j) => s + j.output_tokens, 0),
    estimated_cost_usd: Number(qwenCost.toFixed(4)), budget_limit_usd: 2, started_at: CREATED, completed_at: CREATED, cancelled_at: null, created_at: CREATED, updated_at: CREATED,
  };
  for (const j of jobs) {
    const n = findings.filter((f) => f.sheet_job_id === j.id).length;
    j.analysis_summary = `${j.analysis_summary} ${n ? `${n} observation${n > 1 ? "s" : ""} for review.` : "No observations were raised for this drawing."}`;
  }
  const dataset: AnalyzerRunDataset = { run: run as any, jobs, findings, reviews: [] };

  const arms = ["L_spatial", "L_spatial2", "L_av"];
  const claimMatrix = CLAIMS.map((c) => ({
    claim: c.id, sheet: c.sheet, adjudication: c.adjudication, excludedFromClientView: c.excluded || null, inClientView: Boolean(c.client && !c.excluded),
    baselineGpt4o: detection(baseline, c), ...Object.fromEntries(arms.map((a) => [a, detection(byArm(a), c)])),
  }));
  const armTally = (k: string, src: any) => ({ ...src.byArm[k] });
  const comparison = {
    generatedAt: new Date().toISOString(),
    arms: {
      baseline_C_v2_4x3: { description: "Production Supabase Analyzer V2 prompt + validator, Apple Vision 4x3 v2 block, GPT-4o (saved runs)", ...armTally("C_v2_4x3", evalBase) },
      L_av: { description: "Same production prompt + validator, Apple Vision 4x3 v2 block, GPT-5.6 Luna", ...armTally("L_av", evalLuna) },
      L_spatial: { description: "Qwen 72B validated spatial block + question retrieval + cross-sheet pairs, GPT-5.6 Luna, first addendum", ...armTally("L_spatial", evalLuna) },
      L_spatial2: { description: "As L_spatial + title-block/caption readings + drafting-defect instruction (changed after inspecting L_spatial on these drawings)", ...armTally("L_spatial2", evalLuna) },
    },
    claims: claimMatrix,
    cost: {
      lunaLedgerUsd: Number(spent.toFixed(4)), lunaCalls: [...ledgerCalls.values()].filter((e) => !String(e.callId).startsWith("probe")).length,
      cap: 2, qwenOcrUsd: 1.0055, qwenOcrCalls: 564, qwenOcrWallMin: 17.5,
      qwenAnalysisPerDrawingUsd: Number((1.0055 / 5 + qwenCost / QWEN_ARMS.length / 15).toFixed(4)),
      baselinePerRunUsd: Number((0.5683 / 30).toFixed(4)),
    },
  };

  writeFileSync(path.join(E2E, "qwen-analysis.dataset.json"), JSON.stringify({
    schema: "qsa.qwen-e2e-dataset.v1", note: "Experimental, local only. Not production. Findings are automated observations; statuses and audit are internal.",
    projectName: PROJECT, dataset, audit, excluded: claimMatrix.filter((c) => c.excludedFromClientView), statusLabels: STATUS_LABEL,
    crossSheet: (() => { const l = readJson(path.join(OUT, "stage3/links.openrouter-72b.validated.json")); return { tally: l.tally, lookalikeSheetTokens: l.lookalikeSheetTokens,
      pairs: l.pairs.map((p: any) => { const r = l.references.find((x: any) => x.refId === p.refId) || {};
        return { pairId: p.pairId, kind: p.kind, source: p.source.sheet, sourceText: p.source.text, target: p.target.fileName, detail: p.target.detail ? `${p.target.detail.number} ${p.target.detail.title}` : null,
          status: p.target.status, printed: r.raw, lookalike: (r.targetFromLookalike || []).filter((x: any) => x.status === "resolved_by_sheet_index").map((x: any) => `${x.printed} → ${x.candidate}`), bubblePrinted: r.bubblePrinted || null }; }) }; })(),
    comparison,
  }, null, 1));
  writeFileSync(path.join(E2E, "comparison.json"), JSON.stringify(comparison, null, 1));
  writeFileSync(path.join(E2E, "PermitPilot-Qwen-Luna-analysis.json"), JSON.stringify(buildSupabaseAnalyzerJsonExport(dataset, PROJECT, CREATED), null, 1));

  const logoFile = path.join(ROOT, "src/assets/commun-et-logo.jpg");
  const logo = { data: readFileSync(logoFile).toString("base64"), format: "JPEG" as const, width: 1920, height: 1156 };
  const model = buildArchitectReviewModel(dataset);
  const fingerprint = await fingerprintArchitectReview(dataset);
  const { doc } = renderArchitectReviewPdf({ dataset, model, fingerprint, projectName: PROJECT, generatedAt: new Date(CREATED), logo });
  writeFileSync(path.join(E2E, "PermitPilot-Qwen-Luna-analysis.pdf"), Buffer.from(doc.output("arraybuffer")));

  console.log(`findings ${findings.length} on ${jobs.filter((j) => findings.some((f) => f.sheet_job_id === j.id)).length}/5 drawings; ledger $${spent.toFixed(4)}`);
  for (const c of claimMatrix) console.log(`  ${c.claim.padEnd(14)} base ${c.baselineGpt4o.published}/${c.baselineGpt4o.runs}  L_av ${c.L_av.published}/${c.L_av.runs} (d${c.L_av.drafted})  L_sp ${c.L_spatial.published}/${c.L_spatial.runs} (d${c.L_spatial.drafted})  L_sp2 ${c.L_spatial2.published}/${c.L_spatial2.runs} (d${c.L_spatial2.drafted})${c.inClientView ? "  [client]" : ""}`);
}

main();
