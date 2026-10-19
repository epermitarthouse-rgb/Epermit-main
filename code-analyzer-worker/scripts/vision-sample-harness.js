"use strict";

/**
 * Isolated harness for five permit sheets.
 *
 * Explicit General IBC: one gpt-4o call per sheet. No local/DC mode and no retry.
 * The full PDF folder is text-indexed locally. Nothing is written to Supabase.
 * CODE_ANALYZER_DRAWING_RAG_PERSIST is forced off.
 *
 * Dry run:
 *   node scripts/vision-sample-harness.js
 * Approved send (this process only; the flag is not the default):
 *   CODE_ANALYZER_VISION_HARNESS_SEND=1 node scripts/vision-sample-harness.js
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { classifySheetContent } = require("../lib/classify.js");
const { extractPdfPagesFromFile } = require("../lib/pdfExtract.js");
const { rasterizePagePng } = require("../lib/rasterize.js");
const {
  clearRunEvidenceIndex,
  evidenceIndexForRun,
  prepareEvidenceForSheet,
} = require("../lib/prepareSheetEvidence.js");
const { analyzeDrawingWithOpenAI } = require("../../scraper-service/app/services/compliance/analyze-drawing.service.js");
const {
  resolveJurisdictionDecisionFromInput,
} = require("../../scraper-service/app/services/compliance/findingQuality.js");

const MAX_CALLS = 5;
const MAX_USD = 2;
const RESERVE_USD = 0.4;
const INPUT_USD_PER_TOKEN = 2.5 / 1e6;
const OUTPUT_USD_PER_TOKEN = 10 / 1e6;
const FOLDER = "/Users/javerianaveed/Desktop/008-0003 New York Ave Wash DC_PERMIT REV5 SET_2026-10-15_Individual";
const SHEETS = ["A-1.00-00.pdf", "A-3.02-00.pdf", "E-2.1-00.pdf", "EQ-1.00-0.pdf", "P-3.0-00.pdf"];
const RASTER_DPI = Number(process.env.CODE_ANALYZER_RASTER_DPI) || 150;
const OUT_DIR = path.join(__dirname, "..", "tmp-vision-harness");
const RUN_ID = "local-vision-harness";
const PROJECT_ID = "local-vision-harness";

delete process.env.CODE_ANALYZER_DRAWING_RAG_PERSIST;

function highDetailTokens(width, height) {
  let w = width;
  let h = height;
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit;
  h *= fit;
  const short = Math.min(w, h);
  if (short > 768) {
    const scale = 768 / short;
    w *= scale;
    h *= scale;
  }
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  return 85 + 170 * tiles;
}

async function pagePoints(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  try {
    const page = await pdf.getPage(1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height, pages: pdf.numPages };
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

function disciplineFromName(fileName) {
  const prefix = String(fileName || "").split("-")[0].toUpperCase();
  if (prefix === "A") return "Architectural";
  if (prefix === "E") return "Electrical";
  if (prefix === "EQ") return "Equipment";
  if (prefix === "P") return "Plumbing";
  return prefix || "General";
}

function sheetRow(fileName) {
  return {
    id: fileName,
    file_name: fileName,
    sheet_label: fileName.replace(/\.pdf$/i, ""),
    page_number: 1,
    discipline: disciplineFromName(fileName),
    project_id: PROJECT_ID,
    source_document_id: fileName,
    excluded: false,
  };
}

function costUsd(usage) {
  const input = Number(usage?.prompt_tokens) || 0;
  const output = Number(usage?.completion_tokens) || 0;
  return input * INPUT_USD_PER_TOKEN + output * OUTPUT_USD_PER_TOKEN;
}

function cropNotes(body) {
  const content = body?.messages?.[1]?.content;
  if (!Array.isArray(content)) return { imageCount: 0, cropCount: 0, notes: [] };
  const images = content.filter((part) => part?.type === "image_url");
  const notes = content
    .filter((part) => part?.type === "text" && String(part.text).includes("High-resolution crop"))
    .map((part) => part.text);
  return {
    imageCount: images.length,
    cropCount: Math.max(0, images.length - 1),
    fullDetail: images[0]?.image_url?.detail || null,
    cropDetail: images[1]?.image_url?.detail || null,
    notes,
  };
}

function withoutImages(value) {
  if (Array.isArray(value)) return value.map(withoutImages);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "imageBase64" || key === "image") {
      out[key] = `[omitted ${typeof item === "string" ? item.length : 0} chars]`;
    } else {
      out[key] = withoutImages(item);
    }
  }
  return out;
}

function localSignals(pageText, observations) {
  const text = String(pageText || "");
  const quotes = (observations || []).map((item) => item.quote).filter(Boolean);
  const hour = /one\s+hours?|\b[1I]\s*h(?:r)?\b|\d+(?:\.\d+)?\s*-?\s*(?:hours?|hrs?)\b/i;
  return {
    textChars: text.length,
    hourInText: hour.test(text),
    hourQuotes: quotes.filter((quote) => hour.test(quote)).slice(0, 4),
    emergencyLight: /emergency\s+light/i.test(text),
    corridor44: /44\s*(?:["”]|in\b|inch)/i.test(text),
    waterHammer: /water\s*hammer/i.test(text),
  };
}

async function indexFolder(index) {
  const names = fs.readdirSync(FOLDER).filter((name) => name.toLowerCase().endsWith(".pdf")).sort();
  const sheets = [];
  let n = 0;
  for (const fileName of names) {
    n += 1;
    const filePath = path.join(FOLDER, fileName);
    let text = "";
    for await (const page of extractPdfPagesFromFile(filePath)) {
      if (page.pageNumber === 1) text = page.text || "";
      break;
    }
    const sheet = sheetRow(fileName);
    const contentClass = classifySheetContent({ text });
    index.upsert({
      projectId: PROJECT_ID,
      documentId: fileName,
      sheetId: fileName,
      fileName,
      title: sheet.sheet_label,
      discipline: sheet.discipline,
      pageNumber: 1,
      text,
      contentClass,
      extractionMethod: "pdfjs-text-layer",
    });
    sheets.push({
      ...sheet,
      fileName,
      contentClass,
      excerpt: text.replace(/\s+/g, " ").trim().slice(0, 400),
    });
    if (n % 20 === 0) console.log(`indexed ${n}/${names.length}`);
  }
  return { pdfCount: names.length, sheets };
}

function createBudgetedClient(real, budget) {
  return {
    chat: {
      completions: {
        async create(body) {
          if (budget.calls >= MAX_CALLS) {
            const error = new Error("Stopped: 5 GPT-4o calls already used.");
            error.code = "BUDGET_CALLS";
            throw error;
          }
          if (budget.spentUsd + RESERVE_USD > MAX_USD) {
            const error = new Error("Stopped: the next call could pass $2.");
            error.code = "BUDGET_USD";
            throw error;
          }
          budget.calls += 1;
          const response = await real.chat.completions.create(body);
          const usage = response.usage || {};
          const cost = costUsd(usage);
          budget.spentUsd += cost;
          budget.last = {
            model: body.model,
            usage,
            costUsd: cost,
            spentUsd: budget.spentUsd,
            callNumber: budget.calls,
            crops: cropNotes(body),
            rawContent: response.choices?.[0]?.message?.content || "",
            finishReason: response.choices?.[0]?.finish_reason || null,
            refusal: response.choices?.[0]?.message?.refusal || null,
          };
          return response;
        },
      },
    },
  };
}

async function dryRun() {
  const names = fs.readdirSync(FOLDER).filter((name) => name.toLowerCase().endsWith(".pdf"));
  const sheets = [];
  for (const fileName of SHEETS) {
    const filePath = path.join(FOLDER, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Missing sample sheet ${fileName}`);
    const box = await pagePoints(filePath);
    const pixels = {
      width: Math.ceil((box.width / 72) * RASTER_DPI),
      height: Math.ceil((box.height / 72) * RASTER_DPI),
    };
    sheets.push({
      fileName,
      points: box,
      rasterDpi: RASTER_DPI,
      rasterPixels: pixels,
      fullSheetHighDetailTokens: highDetailTokens(pixels.width, pixels.height),
      crops: 2,
      cropDetail: "low",
      cropTokens: 85 * 2,
    });
  }
  console.log(JSON.stringify({
    jurisdiction: "general",
    amendmentsEnforced: false,
    analysisModes: ["ibc"],
    calls: sheets.length,
    maxCalls: MAX_CALLS,
    maxUsd: MAX_USD,
    retrievalFolderPdfCount: names.length,
    persist: false,
    api: "not called",
    outputDirWhenApproved: OUT_DIR,
    sheets,
  }, null, 2));
}

async function sendRun() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set.");
  const OpenAI = require("openai");
  const real = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const budget = { calls: 0, spentUsd: 0, last: null };
  const client = createBudgetedClient(real, budget);
  clearRunEvidenceIndex(RUN_ID);
  const index = evidenceIndexForRun(RUN_ID);
  console.log("Indexing local PDFs. No model call.");
  const indexed = await indexFolder(index);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  const summary = [];

  for (const fileName of SHEETS) {
    const sheetStarted = Date.now();
    const filePath = path.join(FOLDER, fileName);
    const sheet = indexed.sheets.find((row) => row.file_name === fileName) || sheetRow(fileName);
    console.log(`Preparing ${fileName}. Calls so far: ${budget.calls}. Spent $${budget.spentUsd.toFixed(4)}.`);
    if (budget.calls >= MAX_CALLS || budget.spentUsd + RESERVE_USD > MAX_USD) {
      summary.push({ fileName, skipped: true, reason: "budget stop before this sheet" });
      break;
    }
    const seeded = index.list().find((record) => record.fileName === fileName);
    const decision = resolveJurisdictionDecisionFromInput({
      runJurisdiction: "general",
      drawingText: seeded?.text || "",
    });
    const prepared = await prepareEvidenceForSheet({
      runId: RUN_ID,
      projectId: PROJECT_ID,
      sheet,
      pageText: "",
      contentClass: sheet.contentClass || null,
      pdfPath: filePath,
      specChunks: [],
      jurisdictionScope: decision,
      analysisInstructions: null,
      renderRegions: true,
    });
    const regionImages = (prepared.regionImages || []).slice(0, 2).map((image) => ({
      ...image,
      fileName,
      sheetId: fileName,
      pageNumber: 1,
    }));
    let imageBase64 = "";
    let imageType = "image/png";
    let raster = null;
    try {
      const png = await rasterizePagePng(filePath, 1);
      imageBase64 = png.buffer.toString("base64");
      raster = { width: png.width, height: png.height, bytes: png.buffer.length };
    } catch (err) {
      summary.push({
        fileName,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        callsUsed: budget.calls,
      });
      continue;
    }
    const callsBefore = budget.calls;
    let outcome;
    try {
      outcome = await analyzeDrawingWithOpenAI({
        openai: client,
        imageBase64,
        imageType,
        jurisdiction: decision.enforcedJurisdiction,
        projectType: "Commercial",
        codeYear: "2021",
        codeType: "ibc",
        sheetTitle: fileName,
        sheetId: fileName,
        discipline: sheet.discipline,
        contentClass: prepared.record?.contentClass || sheet.contentClass || null,
        sheetIndex: indexed.sheets,
        jurisdictionScope: decision,
        reviewContext: prepared.promptBlock,
        drawingRecords: prepared.drawingRecords,
        observations: prepared.observations,
        regions: prepared.record?.regions || [],
        regionImages,
        fileName,
        pageText: prepared.pageText,
        logInfo: () => {},
        logError: (msg, extra) => console.error(msg, extra || ""),
        downscaleFn: async () => {
          throw new Error("Retry disabled so each sheet keeps one call.");
        },
      });
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err), code: err.code || null };
      if (err.code === "BUDGET_CALLS" || err.code === "BUDGET_USD") {
        summary.push({ fileName, skipped: true, reason: outcome.error });
        break;
      }
    }
    const call = budget.calls > callsBefore ? budget.last : null;
    const result = outcome?.result || null;
    const diagnostic = {
      fileName,
      pageNumber: 1,
      jurisdiction: decision,
      codeType: "ibc",
      amendmentsEnforced: decision.amendmentsEnforced === true,
      runtimeMs: Date.now() - sheetStarted,
      raster,
      cropsInRequest: call?.crops || null,
      cropProvenance: regionImages.map((image) => ({
        fileName: image.fileName,
        pageNumber: image.pageNumber,
        sheetId: image.sheetId,
        label: image.label,
        extractionMethod: image.extractionMethod,
        region: image.region || null,
        bytes: image.imageBase64 ? Buffer.from(image.imageBase64, "base64").length : 0,
      })),
      localSignals: localSignals(prepared.pageText, prepared.observations),
      graphicalReadStatus: prepared.graphicalReadStatus || null,
      retrievedEvidence: withoutImages(prepared.retrieval || null),
      observations: withoutImages(prepared.observations || []),
      reviewState: result?.summary?.reviewState || null,
      overallScore: result?.summary?.overallScore ?? null,
      acceptedFindings: result?.issues || [],
      rejectedFindings: result?.rejectedCandidates || [],
      summary: result?.summary || null,
      jurisdictionNotes: result?.jurisdictionNotes || null,
      rawModelResponse: call?.rawContent || null,
      tokenUsage: call?.usage || null,
      estimatedCostUsd: call?.costUsd ?? null,
      spentUsd: budget.spentUsd,
      callNumber: call?.callNumber || null,
      finishReason: call?.finishReason || null,
      refusal: call?.refusal || null,
      ok: outcome?.ok === true,
      error: outcome?.ok === true ? null : (outcome?.error || null),
      callsUsed: budget.calls,
    };
    const safeName = fileName.replace(/[^a-z0-9.]+/gi, "_");
    fs.writeFileSync(path.join(OUT_DIR, `${safeName}.json`), JSON.stringify(diagnostic, null, 2));
    summary.push({
      fileName,
      ok: diagnostic.ok,
      reviewState: diagnostic.reviewState,
      accepted: (diagnostic.acceptedFindings || []).length,
      rejected: (diagnostic.rejectedFindings || []).length,
      crops: diagnostic.cropsInRequest?.cropCount || 0,
      tokens: diagnostic.tokenUsage,
      estimatedCostUsd: diagnostic.estimatedCostUsd,
      error: diagnostic.error,
    });
    console.log(JSON.stringify(summary[summary.length - 1]));
    imageBase64 = "";
  }

  const run = {
    calls: budget.calls,
    maxCalls: MAX_CALLS,
    spentUsd: budget.spentUsd,
    maxUsd: MAX_USD,
    priceAssumption: { inputUsdPerMillion: 2.5, outputUsdPerMillion: 10, model: "gpt-4o" },
    jurisdiction: "general",
    analysisModes: ["ibc"],
    persist: false,
    indexedPdfs: indexed.pdfCount,
    runtimeMs: Date.now() - started,
    sheets: summary,
  };
  fs.writeFileSync(path.join(OUT_DIR, "run.json"), JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
}

async function main() {
  if (process.env.CODE_ANALYZER_VISION_HARNESS_SEND === "1") {
    await sendRun();
    return;
  }
  await dryRun();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
