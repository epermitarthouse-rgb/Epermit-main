/**
 * Stage 4: QA/QC reasoning over the extracted evidence (local experiment; nothing is written to Supabase).
 *
 * Arms (same production system prompt, PDF attachment, 82-sheet index and validator as verify-runs.ts):
 *   G_av    gpt-4o        + v2 block from Apple Vision 4x3 (saved OCR)     -- baseline model, baseline OCR
 *   G_qwen  gpt-4o        + v2 block from Qwen (same v2 code and budget)    -- OCR effect at the baseline model
 *   L_av    gpt-5.6-luna  + v2 block from Apple Vision 4x3                  -- model effect at the baseline OCR
 *   L_qwen  gpt-5.6-luna  + v2 block from Qwen                              -- both changed, same evidence format
 *   L_full  gpt-5.6-luna  + Qwen evidence with coordinates + cross-sheet pairs + paired crops + finding types
 *
 * Usage: npx tsx stage4-reason.ts --arms=L_av,L_qwen --backend=local-3b [--sheets=...] [--reps=3] [--dry]
 *        paid calls also need --approve --cap=<usd>. --probe makes one minimal call per model to verify parameters.
 * The OpenAI key is read from code-analyzer-worker/.env and never printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildAnalyzerUserPrompt, mergeProjectSheetIndex, validateAnalyzerFindings } from "../../../supabase/functions/_shared/analyzerFindingQuality.ts";
import { processorReviewPrompt, resolveAnalyzerReviewScope } from "../../../supabase/functions/_shared/analyzerReviewScope.ts";
import { canonicalSheet } from "./stage3-link.mjs";
import { questionEvidence } from "./lib/spatialEvidence.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.resolve(HERE, "../out/qwen-spatial-audit");
const PDF_DIR = process.env.QSA_PDF_DIR || "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual";
const PRIMARY = ["A-3.06-00", "A-4.00-00", "A-1.01-00", "A-6.00-00", "S-201.00"];
const ANALYSIS_DATE = "2026-11-16T12:00:00.000Z";
const TIMEOUT_MS = 240_000;

// USD per 1M tokens (OpenAI pricing page, checked 2026-11-16). Image inputs are billed as input tokens.
const MODELS: Record<string, { input: number; output: number; maxOutput: number; reasoning: boolean }> = {
  "gpt-4o": { input: 2.5, output: 10, maxOutput: 3500, reasoning: false },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, maxOutput: 16000, reasoning: true },
};
const ARMS: Record<string, { model: string; evidence: "av" | "qwen" | "full" | "spatial" }> = {
  G_av: { model: "gpt-4o", evidence: "av" },
  G_qwen: { model: "gpt-4o", evidence: "qwen" },
  L_av: { model: "gpt-5.6-luna", evidence: "av" },
  L_qwen: { model: "gpt-5.6-luna", evidence: "qwen" },
  L_full: { model: "gpt-5.6-luna", evidence: "full" },
  L_spatial: { model: "gpt-5.6-luna", evidence: "spatial" },
  L_spatial2: { model: "gpt-5.6-luna", evidence: "spatial" },
};

const run = {
  analysis_mode: "both" as const,
  jurisdiction_key: "dc",
  jurisdiction_label: "Washington, DC",
  code_edition: "2017",
  code_context: "2017 District of Columbia Construction Codes (2015 IBC base)",
  project_type: "Commercial (General)",
  analysis_scope: resolveAnalyzerReviewScope({
    mode: "both", jurisdictionKey: "dc", jurisdictionLabel: "Washington, DC", codeEdition: "2017",
    codeContext: "2017 District of Columbia Construction Codes (2015 IBC base)",
  }),
};
const basePrompt = processorReviewPrompt(run, { analysisDate: ANALYSIS_DATE });

export const FULL_ADDENDUM = [
  "Experimental QA/QC evidence rules (this request only):",
  "- Qwen2.5-VL evidence lines are machine readings with page coordinates (PDF points, origin bottom-left). They are not verified. Quote them exactly; never repair a value.",
  "- Cross-sheet pairs were resolved through the project sheet index. Attached images are crops of the source and target regions named in each pair; a target region is approximate.",
  "- Classify every finding with finding_type:",
  "  contradiction: two printed values for the same element and the same condition disagree (quote both, with sheets).",
  "  different_condition: values differ because the condition differs (for example exterior versus interior doors). Report only if a stated requirement is not met; otherwise do not report.",
  "  ocr_uncertainty: the reading is marked uncertain ({A | B}, ?text) or the crop is unclear. Advisory only; ask for verification. Never Warning or Critical on this basis.",
  "  missing_information: a label is printed without its value, or a required item is absent from both this sheet and its referenced target. Quote the label. A pointer to another sheet is not an omission.",
  "  code_requirement: a printed value conflicts with a cited requirement.",
  "- Put every sheet you relied on in source_sheets and the evidence ids (L..., P-R...) in evidence_ids.",
  "- Do not report physical clashes between disciplines: no aligned geometry is provided.",
].join("\n");

export const SPATIAL_ADDENDUM = [
  "Experimental QA/QC evidence rules (this request only):",
  "- The evidence summary and the question sections are Qwen2.5-VL-72B readings of this sheet, grouped by detail. eN = unit in the summary, oN = unit retrieved from the full sheet index. ?text = unverified reading; {A | B} = overlapping tiles disagree. Quote readings exactly; never repair a value. The attached PDF is the authority: check every reading you rely on against it.",
  "- Cross-sheet pairs (P-R...) were resolved through the project sheet index. Where a printed sheet or detail number was ambiguous (for example I versus 1), the resolution is stated; the printed form is unchanged. Attached images are crops of the source and target regions; a target region is approximate.",
  "- Work through each question section that applies to this sheet before writing findings. Report only issues; do not report items that are adequately shown.",
  "- Drafting defects are reportable as advisory: a label printed without its value, a malformed notation, an incomplete title-block field.",
  "- finding_type:",
  "  contradiction: two printed values for the same element and the same condition disagree (quote both, with sheets).",
  "  different_condition: values differ because the condition differs (for example exterior versus interior doors). Report only if a stated requirement is not met; otherwise do not report.",
  "  ocr_uncertainty: the reading is uncertain and the PDF does not settle it. Advisory only.",
  "  missing_information: a label is printed without its value, or a required item is absent from this sheet and its referenced target. Quote the label. A pointer to another sheet (SEE ..., detail bubble) is not an omission.",
  "  code_requirement: a printed value conflicts with a code requirement.",
  "- evidence_status: confirmed_by_drawing only when the printed text in the PDF itself shows the issue; preliminary when it depends on a reading you could not confirm or on information outside this sheet; requires_professional_verification when it depends on engineering judgement, a calculation or code applicability.",
  "- confidence: high, medium or low, for the issue being real.",
  "- suggested_code_reference: cite a section only if you are certain of its number and edition (2015 IBC base, ICC A117.1-2009, ASCE 7-10 as referenced). Otherwise leave it empty and say in the recommendation that the code basis needs verification.",
  "- Put every sheet you relied on in source_sheets and the evidence ids (eN, oN, P-R...) in evidence_ids.",
  "- Do not report physical clashes between disciplines: no aligned geometry is provided.",
].join("\n");

const BASE_ITEM: Record<string, unknown> = {
  category: { type: "string" }, severity: { type: "string", enum: ["critical", "warning", "advisory"] }, title: { type: "string" },
  observation: { type: "string" }, drawing_evidence: { type: "string" }, drawing_location: { type: "string" },
  suggested_code_reference: { type: "string" }, recommendation: { type: "string" },
};
function schema(evidence: string) {
  const typed = { ...BASE_ITEM, finding_type: { type: "string", enum: ["contradiction", "different_condition", "ocr_uncertainty", "missing_information", "code_requirement"] },
    source_sheets: { type: "array", items: { type: "string" } }, evidence_ids: { type: "array", items: { type: "string" } } };
  const item = evidence === "spatial"
    ? { ...typed, evidence_status: { type: "string", enum: ["confirmed_by_drawing", "preliminary", "requires_professional_verification"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] } }
    : evidence === "full" ? typed : BASE_ITEM;
  return {
    type: "object", additionalProperties: false,
    properties: {
      detected_sheet_number: { type: "string" }, detected_sheet_title: { type: "string" }, discipline: { type: "string" }, summary: { type: "string" },
      findings: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, properties: item, required: Object.keys(item) } },
    },
    required: ["detected_sheet_number", "detected_sheet_title", "discipline", "summary", "findings"],
  };
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const sha = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const TECHNICAL = /\d|A\.F\.F|ELEV\.|\bMIN\b|V\.I\.F|\bTYP\b|@/i;

/** Qwen sheet index rendered with ids, coordinates and uncertainty markers, technical annotations first. */
export function qwenEvidenceBlock(index: any, maxChars = 9000): string {
  const lineById = new Map(index.lines.map((l: any) => [l.lid, l]));
  const row = (l: any) => (l.conflict ? `{${[l.text, ...l.alternatives].join(" | ")}}` : `${l.uncertain ? "?" : ""}${l.text}`);
  const anns = index.annotations.map((a: any) => {
    const ls = a.lines.map((id: string) => lineById.get(id));
    const technical = ls.some((l: any) => TECHNICAL.test(l.text));
    const b = a.box;
    return { technical, text: `- [${ls[0].lid}${ls.length > 1 ? `+${ls.length - 1}` : ""} @${Math.round(b.x)},${Math.round(b.y)}] ${ls.map(row).join(" / ")}` };
  });
  anns.sort((a: any, b: any) => Number(b.technical) - Number(a.technical));
  const header = [
    `Qwen2.5-VL evidence (machine-extracted; independentlyVerified=false) sheet=${index.sheetId} model=${index.model} lines=${index.lines.length} tilesRead=${index.coverage.tilesRead}/${index.coverage.tilesTotal - index.coverage.tilesBlank}`,
    "Format: - [first line id(+more lines) @x,y in PDF points] row / row. {A | B} = conflicting readings from overlapping tiles. ?text = model marked the reading uncertain. Not shown is not absent.",
  ];
  const out = [...header];
  let used = header.join("\n").length, omitted = 0;
  for (const a of anns) {
    if (used + a.text.length + 1 > maxChars) { omitted += 1; continue; }
    out.push(a.text);
    used += a.text.length + 1;
  }
  if (omitted) out.push(`omitted: ${omitted} annotations by budget; not shown is not absent`);
  return out.join("\n");
}

/** Cross-sheet pairs touching this sheet, with attached-crop numbers. */
export function crossSheetBlock(links: any, sheetId: string, maxPairs = 14) {
  const key = canonicalSheet(sheetId);
  const mine = (links?.pairs || []).filter((p: any) => p.source.sheet === sheetId && !p.target.status?.startsWith("not_") && p.target.sheet !== key);
  const rank = (p: any) => (p.kind === "plan_to_schedule" ? 0 : p.kind === "plan_to_detail" ? 1 : 2) + (p.target.cropBox ? 0 : 3);
  mine.sort((a: any, b: any) => rank(a) - rank(b));
  const chosen = mine.slice(0, maxPairs);
  const images: Array<{ file: string; label: string }> = [];
  const lines = ["Cross-sheet pairs (resolved through the project sheet index; targets were not reviewed in this request unless their lines are quoted):"];
  for (const p of chosen) {
    const t = p.target;
    let img = "";
    for (const side of ["source", "target"] as const) {
      const c = p[side]?.crop?.file;
      if (c && images.length < 8) { images.push({ file: path.join(OUT, c), label: `${p.pairId} ${side}` }); img += ` image#${images.length}=${side}`; }
    }
    const det = t.detail ? ` detail ${t.detail.number} "${t.detail.title}" (scale ${t.detail.scale || "n/a"})` : "";
    const q = t.qwenLines?.length ? ` target lines: ${t.qwenLines.slice(0, 8).map((l: any) => `[${l.lid}] ${l.text}`).join(" / ")}` : "";
    const ref = (links.references || []).find((r: any) => r.refId === p.refId);
    const printed = [
      ...(ref?.targetFromLookalike || []).filter((x: any) => x.status === "resolved_by_sheet_index").map((x: any) => `sheet printed "${x.printed}" read as ${x.candidate}`),
      ...(ref?.bubblePrinted ? [`detail number printed "${ref.bubblePrinted}" read as ${ref.detail}, matched to the target's detail list`] : []),
    ];
    const note = printed.length ? ` (${printed.join("; ")}; OCR reading unchanged)` : "";
    lines.push(`- ${p.pairId} ${p.kind}: "${clip(p.source.text, 80)}" @${Math.round(p.source.box.x)},${Math.round(p.source.box.y)} -> ${t.fileName}${det} [${t.status}]${note}${img}${q}`);
  }
  for (const c of (links?.comparisons?.openingForces || []).filter((c: any) => c.sheets.length > 1 || c.status !== "single_sheet")) {
    lines.push(`- comparison door opening force (${c.condition}): values ${c.values.join(", ")} on ${c.sheets.join(", ")} -> ${c.status}`);
  }
  if (lines.length === 1) lines.push("- none resolved for this sheet");
  return { text: lines.join("\n"), images, pairs: chosen.map((p: any) => p.pairId) };
}

function sheetIndexFor(fileName: string) {
  const pdfs = readdirSync(PDF_DIR).filter((f) => f.endsWith(".pdf")).sort();
  return mergeProjectSheetIndex([{ fileName }], pdfs.filter((f) => f !== fileName).map((f) => ({ fileName: f })));
}

type Job = { sheet: string; arm: string; rep: number };

function prepare(job: Job, backend: string) {
  const arm = ARMS[job.arm];
  const fileName = `${job.sheet}.pdf`;
  const sheetIndex = sheetIndexFor(fileName);
  let visual = "", cross = "", images: Array<{ file: string; label: string }> = [], pairs: string[] = [];
  if (arm.evidence === "av" || arm.evidence === "qwen") {
    const f = path.join(OUT, "blocks", `${job.sheet}.${arm.evidence === "av" ? "apple-vision-4x3" : `qwen-${backend}`}.v2.block.txt`);
    if (!existsSync(f)) throw new Error(`missing block ${path.relative(OUT, f)} (run eval-ocr.mjs --write-blocks)`);
    visual = readFileSync(f, "utf8");
  } else if (arm.evidence === "spatial") {
    const ev = path.join(OUT, "evidence");
    const block = path.join(ev, `${job.sheet}.spatial.block.txt`), pack = path.join(ev, `${job.sheet}.spatial.pack.json`);
    if (!existsSync(block) || !existsSync(pack)) throw new Error(`missing spatial evidence for ${job.sheet} (run compare-arms.mjs --write)`);
    visual = `${readFileSync(block, "utf8")}\n\n${questionEvidence(readJson(pack)).block}`;
    const lf = path.join(OUT, "stage3", `links.${backend}.validated.json`);
    if (!existsSync(lf)) throw new Error(`missing ${path.relative(OUT, lf)} (run stage3-link.mjs --variant validated)`);
    const c = crossSheetBlock(readJson(lf), job.sheet);
    cross = c.text; images = c.images; pairs = c.pairs;
  } else {
    const idx = path.join(OUT, "sheets", job.sheet, "stage2", `sheet-index.${backend}.json`);
    const idxSub = idx.replace(/\.json$/, ".subset.json");
    const index = readJson(existsSync(idx) ? idx : idxSub);
    visual = qwenEvidenceBlock(index);
    const lf = [path.join(OUT, "stage3", `links.${backend}.json`), path.join(OUT, "stage3", `links.${backend}.subset.json`)].find(existsSync);
    const c = crossSheetBlock(lf ? readJson(lf) : null, job.sheet);
    cross = c.text; images = c.images; pairs = c.pairs;
  }
  const userPrompt = buildAnalyzerUserPrompt(fileName, sheetIndex, { visualEvidence: visual, crossSheetEvidence: cross || null });
  const system = arm.evidence === "full" ? `${basePrompt}\n\n${FULL_ADDENDUM}` : arm.evidence === "spatial" ? `${basePrompt}\n\n${SPATIAL_ADDENDUM}` : basePrompt;
  return { arm, fileName, sheetIndex, userPrompt, system, images, pairs, visual };
}

/** Upper-bound tokens: PDF (Phase 6 PDF-only input minus its prompt) + text / 3.5 + 1,600 per image. */
function estimate(job: Job, backend: string) {
  const p = prepare(job, backend);
  const phase6 = readJson(path.resolve(HERE, "../out/gpt-5.4-audit-3364698b/ocr-research-final/implementation/data/phase6-analyzer-runs", `${job.sheet}.A_pdf_only.r1.json`));
  const pdfTokens = Math.max(0, phase6.inputTokens - Math.ceil(phase6.userPromptChars / 3.5) - Math.ceil(basePrompt.length / 3.5));
  const input = Math.ceil(pdfTokens * 1.25) + Math.ceil((p.userPrompt.length + p.system.length) / 3.5) + 1600 * p.images.length;
  const m = MODELS[p.arm.model];
  const expectedOut = m.reasoning ? 6000 : 1200;
  return { input, expectedUsd: input * m.input / 1e6 + expectedOut * m.output / 1e6, worstUsd: input * m.input / 1e6 + m.maxOutput * m.output / 1e6 };
}

function apiKey(): string {
  const raw = readFileSync(path.join(ROOT, "code-analyzer-worker/.env"), "utf8");
  const line = raw.split("\n").find((l) => l.startsWith("OPENAI_API_KEY="));
  const key = line?.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "") || "";
  if (!key) throw new Error("OPENAI_API_KEY is missing");
  return key;
}

function outputText(payload: any): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) for (const part of item?.content || []) if (typeof part?.text === "string") return part.text;
  return "";
}

async function post(key: string, body: unknown) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = await response.json() as any;
  if (!response.ok) { const e = new Error(payload?.error?.message || `HTTP ${response.status}`) as Error & { status?: number }; e.status = response.status; throw e; }
  return payload;
}

async function oneCall(key: string, job: Job, backend: string, reasoning: string) {
  const p = prepare(job, backend);
  const m = MODELS[p.arm.model];
  const content: any[] = [
    { type: "input_file", filename: p.fileName, file_data: `data:application/pdf;base64,${readFileSync(path.join(PDF_DIR, p.fileName)).toString("base64")}`, ...(p.arm.model === "gpt-4o" ? { detail: "high" } : {}) },
    { type: "input_text", text: p.userPrompt },
    ...p.images.flatMap((im) => [{ type: "input_text", text: `image: ${im.label}` }, { type: "input_image", image_url: `data:image/png;base64,${readFileSync(im.file).toString("base64")}`, detail: "high" }]),
  ];
  const body: any = {
    model: p.arm.model, store: false, max_output_tokens: m.maxOutput,
    input: [{ role: "system", content: [{ type: "input_text", text: p.system }] }, { role: "user", content }],
    text: { format: { type: "json_schema", name: "permit_drawing_review", strict: true, schema: schema(p.arm.evidence) } },
    ...(m.reasoning && reasoning !== "default" ? { reasoning: { effort: reasoning } } : {}),
  };
  const started = Date.now();
  const payload = await post(key, body);
  const rawText = outputText(payload);
  const parsed = JSON.parse(rawText);
  const drafts = (parsed.findings || []).map((f: any) => ({
    category: clip(f.category, 120), severity: clip(f.severity, 40).toLowerCase(), title: clip(f.title, 240), observation: clip(f.observation, 2000),
    drawing_evidence: clip(f.drawing_evidence, 1500), drawing_location: clip(f.drawing_location, 500), suggested_code_reference: clip(f.suggested_code_reference, 500),
    recommendation: clip(f.recommendation, 1500),
    ...(f.finding_type ? { finding_type: f.finding_type, source_sheets: f.source_sheets, evidence_ids: f.evidence_ids } : {}),
    ...(f.evidence_status ? { evidence_status: f.evidence_status, confidence: f.confidence } : {}),
  }));
  const EXTRA_KEYS = ["finding_type", "source_sheets", "evidence_ids", "evidence_status", "confidence"];
  const ctx = { analysisMode: "both" as const, jurisdictionKey: run.jurisdiction_key, jurisdictionLabel: run.jurisdiction_label, codeEdition: run.code_edition,
    codeContext: run.code_context, sheetIndex: p.sheetIndex, currentFileName: p.fileName, sheetDiscipline: clip(parsed.discipline, 120) || "General", analysisDate: ANALYSIS_DATE };
  const reviewed = validateAnalyzerFindings(drafts, ctx);
  const extra = new Map(drafts.map((d: any) => [d.title, d]));
  const usage = payload.usage || {};
  const inputTokens = Number(usage.input_tokens) || 0, outputTokens = Number(usage.output_tokens) || 0;
  return {
    sheetId: job.sheet, arm: job.arm, rep: job.rep, model: payload.model || p.arm.model, backend, responseId: payload.id || null,
    latencyMs: Date.now() - started, inputTokens, outputTokens, reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens) || 0,
    costUsd: inputTokens * m.input / 1e6 + outputTokens * m.output / 1e6,
    input: { systemPromptSha: sha(p.system), pdf: p.fileName, evidenceSha: sha(p.visual), userPromptChars: p.userPrompt.length, images: p.images.map((i) => i.label), pairs: p.pairs, reasoning },
    rawOutput: rawText, detected: { number: parsed.detected_sheet_number, title: parsed.detected_sheet_title, discipline: parsed.discipline }, summary: parsed.summary,
    drafts,
    published: reviewed.published.map((f: any) => {
      const d: any = extra.get(f.validation?.originalTitle || f.title) || {};
      return { ...f, ...Object.fromEntries(EXTRA_KEYS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) };
    }),
    withheld: reviewed.withheld,
  };
}

async function probe(key: string, reasoning: string, models: string[], cap: number) {
  for (const model of models) {
    const callId = `probe.${model}.${Date.now()}`, worstUsd = 0.002;
    if (spent() + worstUsd > cap) { console.log(`stop: cap $${cap}`); return; }
    ledger({ type: "reserve", callId, model, worstUsd });
    const body: any = {
      model, store: false, max_output_tokens: MODELS[model].reasoning ? 600 : 60,
      input: [{ role: "user", content: [{ type: "input_text", text: "Return ok=true." }] }],
      text: { format: { type: "json_schema", name: "probe", strict: true, schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] } } },
      ...(MODELS[model].reasoning && reasoning !== "default" ? { reasoning: { effort: reasoning } } : {}),
    };
    try {
      const p = await post(key, body);
      const u = p.usage || {};
      ledger({ type: "settle", callId, model: p.model, inputTokens: u.input_tokens, outputTokens: u.output_tokens,
        costUsd: (u.input_tokens || 0) * MODELS[model].input / 1e6 + (u.output_tokens || 0) * MODELS[model].output / 1e6 });
      console.log(`probe ${model}: ok model=${p.model} in=${u.input_tokens} out=${u.output_tokens} reasoning=${u.output_tokens_details?.reasoning_tokens ?? "n/a"} text=${outputText(p)}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/timeout|abort/i.test(msg)) ledger({ type: "settle", callId, costUsd: 0, error: msg.slice(0, 200) });
      console.log(`probe ${model}: FAILED ${msg.slice(0, 200)}`);
    }
  }
}

/**
 * Append-only cost ledger shared by every paid call. A call is reserved at its worst case before it is
 * sent and settled at the billed usage afterwards; a reservation that is never settled (crash, timeout)
 * stays charged at the worst case.
 */
const LEDGER = path.join(OUT, "stage4", "ledger.jsonl");
function ledger(entry: Record<string, unknown>) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}
function spent() {
  if (!existsSync(LEDGER)) return 0;
  const calls = new Map<string, number>();
  for (const line of readFileSync(LEDGER, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.type === "reserve") calls.set(e.callId, Number(e.worstUsd));
    else if (e.type === "settle") calls.set(e.callId, Number(e.costUsd));
  }
  return [...calls.values()].reduce((s, v) => s + v, 0);
}

async function main() {
  const opt = (n: string, d = "") => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) || d;
  const arms = opt("arms", "L_av,L_qwen,G_qwen,L_full").split(",");
  const sheets = opt("sheets", PRIMARY.join(",")).split(",");
  const reps = Number(opt("reps", "3"));
  const backend = opt("backend", "local-3b");
  const reasoning = opt("reasoning", "medium");
  const cap = Number(opt("cap", "0"));
  const dry = !process.argv.includes("--approve");
  const runsDir = path.join(OUT, "stage4", "runs");
  mkdirSync(runsDir, { recursive: true });
  if (process.argv.includes("--probe")) {
    if (dry || !(cap > 0)) throw new Error("--probe is a paid call; add --approve --cap=<usd>");
    return probe(apiKey(), reasoning, [...new Set(arms.map((a) => ARMS[a].model))], cap);
  }

  const jobs: Job[] = arms.flatMap((arm) => sheets.flatMap((sheet) => Array.from({ length: reps }, (_, i) => ({ sheet, arm, rep: i + 1 }))));
  const dest = (j: Job) => path.join(runsDir, `${j.sheet}.${j.arm}.${backend}.r${j.rep}.json`);
  const failed = (j: Job) => existsSync(dest(j).replace(/\.json$/, ".error.json"));
  const pending = jobs.filter((j) => !existsSync(dest(j)) && (process.argv.includes("--retry-failed") || !failed(j)));
  const rows: any[] = [];
  let expected = 0, worst = 0;
  for (const arm of arms) for (const sheet of sheets) {
    try {
      const e = estimate({ sheet, arm, rep: 1 }, backend);
      const n = pending.filter((j) => j.arm === arm && j.sheet === sheet).length;
      expected += e.expectedUsd * n; worst += e.worstUsd * n;
      rows.push({ arm, sheet, model: ARMS[arm].model, pendingCalls: n, inputTokensPerCall: e.input, expectedUsdPerCall: Number(e.expectedUsd.toFixed(4)), worstUsdPerCall: Number(e.worstUsd.toFixed(4)) });
      const p = prepare({ sheet, arm, rep: 1 }, backend);
      const pd = path.join(OUT, "stage4", "prompts");
      mkdirSync(pd, { recursive: true });
      writeFileSync(path.join(pd, `${sheet}.${arm}.${backend}.user.txt`), p.userPrompt);
      writeFileSync(path.join(pd, ARMS[arm].evidence === "full" || ARMS[arm].evidence === "spatial" ? `system.${arm}.txt` : "system.production.txt"), p.system);
    } catch (e) { rows.push({ arm, sheet, error: (e as Error).message }); }
  }
  const plan = { generatedAt: new Date().toISOString(), backend, reasoning, jobs: jobs.length, pending: pending.length, spentUsd: Number(spent().toFixed(4)), expectedUsd: Number(expected.toFixed(4)), worstCaseUsd: Number(worst.toFixed(4)), rows };
  writeFileSync(path.join(OUT, "stage4", `plan.${backend}.json`), JSON.stringify(plan, null, 1));
  console.log(JSON.stringify({ ...plan, rows: undefined }, null, 1));
  for (const r of rows) console.log(r.error ? `  ${r.arm} ${r.sheet}: ${r.error}` : `  ${r.arm.padEnd(7)} ${r.sheet.padEnd(10)} ${r.model.padEnd(13)} calls=${r.pendingCalls} in~${r.inputTokensPerCall} exp=$${r.expectedUsdPerCall} worst=$${r.worstUsdPerCall}`);
  if (dry) { console.log("dry run: no API calls. Add --approve --cap=<usd> after approval."); return; }
  if (!(cap > 0)) throw new Error("--cap=<usd> is required with --approve");

  const key = apiKey();
  let consecutiveFailures = 0;
  for (const job of pending) {
    const est = estimate(job, backend);
    if (spent() + est.worstUsd > cap) { console.log(`stop: cap $${cap} (spent $${spent().toFixed(4)})`); break; }
    const callId = `${job.sheet}.${job.arm}.${backend}.r${job.rep}.${Date.now()}`;
    ledger({ type: "reserve", callId, job, model: ARMS[job.arm].model, worstUsd: est.worstUsd });
    try {
      const r = await oneCall(key, job, backend, reasoning);
      ledger({ type: "settle", callId, model: r.model, responseId: r.responseId, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd });
      writeFileSync(dest(job), JSON.stringify(r, null, 1));
      consecutiveFailures = 0;
      console.log(`${job.sheet} ${job.arm} r${job.rep} published=${r.published.length} withheld=${r.withheld.length} in=${r.inputTokens} out=${r.outputTokens} $${r.costUsd.toFixed(4)} ${Math.round(r.latencyMs / 1000)}s`);
    } catch (e) {
      const msg = (e as Error).message;
      const status = (e as any).status as number | undefined;
      if (status && status >= 400 && status < 500) ledger({ type: "settle", callId, costUsd: 0, error: msg.slice(0, 300) });
      else ledger({ type: "unsettled", callId, error: msg.slice(0, 300), note: "kept at worst case" });
      writeFileSync(dest(job).replace(/\.json$/, ".error.json"), JSON.stringify({ ...job, error: msg.slice(0, 500), status: status ?? null }, null, 1));
      console.log(`${job.sheet} ${job.arm} r${job.rep} failed: ${msg.slice(0, 200)}`);
      if (++consecutiveFailures >= 2) { console.log("stop: two consecutive failures"); break; }
    }
  }
  console.log(`spent $${spent().toFixed(4)} of cap $${cap}`);
}

main();
