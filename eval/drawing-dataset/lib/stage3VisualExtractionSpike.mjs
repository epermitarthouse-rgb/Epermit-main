/**
 * Stage 3 targeted visual extraction spike (offline / local only).
 *
 * Reuses Phase 2A layout-full associations + Vision OCR. Prefer OCR for CAD
 * lettering; keep text-layer for FP200-class regression. Not professionally
 * verified. No GPT calls. Crops/outputs stay under gitignored out/.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCropViaPython } from "./adjudicateCrops.mjs";
import {
  assessGuardrailHeightAssociation,
  assessHydraulicRelationships,
  collectTopicHits,
  PILOT_SHEETS,
} from "./visualEvidencePilot.mjs";

export const STAGE3_SPIKE_VERSION = "phase3.stage3-visual-extraction-spike.v1";

const DETAIL_TITLE = /\bGUARD\s*RAIL\s+(?:ELEVATION\s+)?DETAIL\b/i;
const HEIGHT_36 = /3\s*['′]\s*-?\s*6\s*"?\s*MIN\.?\s*HEIGHT/i;
const HEIGHT_GENERIC = /\bMIN\.?\s*(?:HEIGHT|ABOVE)\b/i;
const GUARD_NOTE = /\bGUARD\s*RAIL\b|\bPIPE\s+RAILING\b|\bEXTEND\s+GUARD\b/i;
const DOOR_MARK = /\b(?:DOOR\s*)?(?:MARK|NO\.?|#)\s*[A-Z0-9-]+|\bD\d{1,3}\b|\bEX-\d+\b/i;
const HARDWARE_LINE =
  /\b(?:\d+\.?\s*)?(?:\d+\s*EA\s+)?(?:PANIC|LOCK(?:SET)?|SCHLAGE|V\.?\s*DUPRIN|ALARM\s+LOCK|ELEC\s+STRIKE|CLOSER|PUSH\s+BUTTON|HORN)/i;
const FIRE_NOTE = /\bFIRE[- ]RATED|\bFIRE\s*RATING|\bUL\s*LABEL|\bGASKETS?\s+FOR\s+DOOR|\bOPENING\s+PROTECTIVE/i;
const SCHEDULE_HEADER = /\bDOOR\s+SCHEDULE\b/i;

function oneLine(value, max = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function packageId(sheetId, topic, texts) {
  const digest = createHash("sha1").update(`${sheetId}|${topic}|${texts.join("|")}`).digest("hex").slice(0, 12);
  return `${sheetId}.${topic}.${digest}`;
}

function expandBbox(items, pad = 24) {
  const boxes = items.map((item) => item.bbox).filter(Boolean);
  if (!boxes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + (box.width || 0));
    maxY = Math.max(maxY, box.y + (box.height || 0));
  }
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: maxX - minX + 2 * pad,
    height: maxY - minY + 2 * pad,
    unit: boxes[0].unit || "pdf-point",
    origin: boxes[0].origin || "bottom-left",
  };
}

function center(bbox) {
  if (!bbox) return null;
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
}

function isVisual(item) {
  return String(item.origin || "").includes("visual") || String(item.extractionMethod || "").includes("vision");
}

function filterByMode(associations, mode) {
  if (mode === "text_layer_only") {
    return associations.filter((item) => !isVisual(item));
  }
  // stage3: prefer all, but ranking prefers visual
  return associations;
}

function toHit(item) {
  return {
    text: item.text || "",
    bbox: item.bbox || null,
    regionId: item.regionId || null,
    regionKind: item.regionKind || null,
    origin: item.origin || null,
    extractionMethod: item.extractionMethod || null,
    associationMethod: item.associationMethod || null,
    independentlyVerified: false,
  };
}

/**
 * A-3.06: locate Guard Rail Elevation Detail titles and associate 3'-6" MIN HEIGHT
 * with guard-rail language — not generic MIN. ABOVE DECK notes.
 */
export function extractGuardrailDetailEvidence(layout, options = {}) {
  const mode = options.mode || "stage3_visual";
  const associations = filterByMode(layout.associations || [], mode);
  const detailTitles = associations.filter((item) => DETAIL_TITLE.test(item.text || "")).map(toHit);
  const heightExact = associations.filter((item) => HEIGHT_36.test(item.text || "")).map(toHit);
  const heightGeneric = associations
    .filter((item) => HEIGHT_GENERIC.test(item.text || "") && !HEIGHT_36.test(item.text || ""))
    .map(toHit);
  const guardNotes = associations.filter((item) => GUARD_NOTE.test(item.text || "")).map(toHit);

  // Prefer visual height hits when available.
  heightExact.sort((a, b) => Number(isVisual(b)) - Number(isVisual(a)));
  guardNotes.sort((a, b) => Number(isVisual(b)) - Number(isVisual(a)));

  let association = {
    status: "not_found",
    applicableToGuardrail: "unresolved",
    detailIdentifier: null,
    note: "No 3'-6\" MIN HEIGHT recovered.",
    independentlyVerified: false,
  };

  if (heightExact.length && guardNotes.length) {
    const height = heightExact[0];
    const hc = center(height.bbox);
    // Nearest guard note by Euclidean distance in PDF points.
    let nearestGuard = null;
    let bestDist = Infinity;
    for (const guard of guardNotes) {
      const gc = center(guard.bbox);
      if (!hc || !gc) continue;
      const dist = Math.hypot(hc.x - gc.x, hc.y - gc.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearestGuard = guard;
      }
    }
    // Nearest elevation detail title (often text-layer title above the detail).
    let nearestDetail = null;
    let bestDetailDist = Infinity;
    for (const title of detailTitles) {
      const tc = center(title.bbox);
      if (!hc || !tc) {
        if (!nearestDetail) nearestDetail = title;
        continue;
      }
      const dist = Math.hypot(hc.x - tc.x, hc.y - tc.y);
      if (dist < bestDetailDist) {
        bestDetailDist = dist;
        nearestDetail = title;
      }
    }

    const sameRegion = nearestGuard && height.regionId && height.regionId === nearestGuard.regionId;
    const near = bestDist < 220;
    const associated = Boolean(sameRegion || near);
    association = {
      status: associated ? "associated_to_guardrail_detail" : "found_distant",
      applicableToGuardrail: associated ? "likely_same_detail_candidate" : "unresolved",
      detailIdentifier: nearestDetail?.text || null,
      detailDistancePts: Number.isFinite(bestDetailDist) ? Math.round(bestDetailDist) : null,
      guardDistancePts: Number.isFinite(bestDist) ? Math.round(bestDist) : null,
      heightText: height.text,
      guardText: nearestGuard?.text || null,
      rejectedGenericHeights: heightGeneric.map((item) => item.text).slice(0, 6),
      note: associated
        ? "3'-6\" MIN HEIGHT co-located with guard-rail OCR/notes (candidate association only)."
        : "Height recovered but geometric association to guard-rail language is weak.",
      independentlyVerified: false,
    };
  } else if (heightExact.length) {
    association = {
      status: "found_unassociated",
      applicableToGuardrail: "unresolved",
      detailIdentifier: detailTitles[0]?.text || null,
      heightText: heightExact[0].text,
      rejectedGenericHeights: heightGeneric.map((item) => item.text).slice(0, 6),
      note: "3'-6\" MIN HEIGHT recovered without nearby guard-rail language in examined hits.",
      independentlyVerified: false,
    };
  }

  const packHits = [
    ...detailTitles.slice(0, 3),
    ...heightExact.slice(0, 3),
    ...guardNotes.filter((item) => /GUARD\s*RAIL/i.test(item.text)).slice(0, 6),
  ];
  const texts = [...new Set(packHits.map((item) => item.text))];
  const status = heightExact.length
    ? (association.status.startsWith("associated") ? "evidence_recovered" : "partial_recovery")
    : (mode === "text_layer_only" ? "not_found_text_layer" : "not_found");

  return {
    id: packageId("A-3.06", "guardrail_detail_height", texts),
    topic: "guardrail_detail_height",
    status,
    extractedTexts: texts.slice(0, 20),
    detailIdentifier: association.detailIdentifier,
    bbox: expandBbox([...heightExact.slice(0, 2), ...guardNotes.slice(0, 4), ...detailTitles.slice(0, 1)], 40),
    assessment: association,
    provenance: {
      origin: mode === "text_layer_only" ? "machine_extracted_text_layer" : "visual_interpretation_preferred",
      method: "stage3_detail_spatial_association",
      independentlyVerified: false,
      uncertainty: "OCR/layout machine extraction. Not professionally verified.",
    },
    limitations: [
      "Candidate geometric association only — not a sealed compliance determination.",
      "Generic MIN HEIGHT / MIN ABOVE DECK notes are listed separately and must not clear guardrail claims alone.",
      status === "not_found_text_layer"
        ? "Text-layer mode misses CAD-outlined dimensions that Vision OCR recovers."
        : null,
    ].filter(Boolean),
    hits: {
      detailTitles: detailTitles.length,
      heightExact: heightExact.length,
      heightGeneric: heightGeneric.length,
      guardNotes: guardNotes.length,
      visualHeightHits: heightExact.filter(isVisual).length,
    },
  };
}

function clusterByY(hits, threshold = 28) {
  const sorted = [...hits].filter((item) => item.bbox).sort((a, b) => b.bbox.y - a.bbox.y || a.bbox.x - b.bbox.x);
  const rows = [];
  for (const hit of sorted) {
    const y = hit.bbox.y + hit.bbox.height / 2;
    let row = rows.find((item) => Math.abs(item.y - y) <= threshold);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push(hit);
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.bbox.x - b.bbox.x);
  }
  return rows;
}

/**
 * A-6.00: recover door schedule / hardware / fire notes with coarse row clustering.
 */
export function extractDoorScheduleEvidence(layout, options = {}) {
  const mode = options.mode || "stage3_visual";
  const associations = filterByMode(layout.associations || [], mode).map(toHit);
  const scheduleHeaders = associations.filter((item) => SCHEDULE_HEADER.test(item.text));
  const hardware = associations.filter((item) => HARDWARE_LINE.test(item.text));
  const fire = associations.filter((item) => FIRE_NOTE.test(item.text));
  const marks = associations.filter((item) => DOOR_MARK.test(item.text));

  hardware.sort((a, b) => Number(isVisual(b)) - Number(isVisual(a)));
  fire.sort((a, b) => Number(isVisual(b)) - Number(isVisual(a)));

  const rowClusters = clusterByY([...hardware, ...fire].slice(0, 80), 32).slice(0, 24);
  const rows = rowClusters.map((row, index) => {
    const texts = row.items.map((item) => item.text);
    const joined = texts.join(" | ");
    return {
      rowIndex: index,
      texts: texts.slice(0, 8),
      hasHardware: HARDWARE_LINE.test(joined),
      hasFire: FIRE_NOTE.test(joined),
      hasMark: DOOR_MARK.test(joined),
      readability: row.items.some(isVisual) ? "ocr_readable_candidate" : "text_layer_or_mixed",
      independentlyVerified: false,
    };
  });

  const present = {
    scheduleHeader: scheduleHeaders.length > 0,
    lockingHardware: hardware.length > 0,
    fireRatingNotes: fire.length > 0,
    doorMarks: marks.length > 0,
  };
  const confidence = {
    locking: hardware.some(isVisual) ? "high_ocr" : (hardware.length ? "medium_text" : "not_recovered"),
    fire: fire.some(isVisual) ? "high_ocr" : (fire.length ? "medium_text" : "not_recovered"),
    scheduleCompleteness: "unresolved_needs_professional_review",
  };

  const texts = [
    ...scheduleHeaders.slice(0, 2).map((item) => item.text),
    ...hardware.slice(0, 12).map((item) => item.text),
    ...fire.slice(0, 6).map((item) => item.text),
  ];
  const uniqueTexts = [...new Set(texts)];
  const status = present.lockingHardware || present.fireRatingNotes
    ? "evidence_recovered"
    : (mode === "text_layer_only" ? "not_found_text_layer" : "not_found");

  return {
    id: packageId("A-6.00", "door_schedule_structured", uniqueTexts),
    topic: "door_schedule_structured",
    status,
    extractedTexts: uniqueTexts.slice(0, 30),
    detailIdentifier: scheduleHeaders[0]?.text || "DOOR SCHEDULE",
    bbox: expandBbox([...hardware.slice(0, 10), ...fire.slice(0, 4), ...scheduleHeaders.slice(0, 1)], 30),
    assessment: {
      present,
      confidence,
      sampleRows: rows.slice(0, 12),
      phase2bStance: {
        lockingAbsenceCritical: present.lockingHardware
          ? "contradicted_candidate_by_quoted_hardware"
          : "unresolved_or_not_examined",
        fireRatingAbsenceCritical: present.fireRatingNotes
          ? "partially_contradicted_candidate_by_fire_note"
          : "unresolved_or_not_examined",
        note: "Presence of quoted hardware/fire notes contradicts blanket absence only. Full schedule completeness still needs professional review.",
      },
      independentlyVerified: false,
    },
    provenance: {
      origin: mode === "text_layer_only" ? "machine_extracted_text_layer" : "visual_interpretation_preferred",
      method: "stage3_schedule_row_cluster",
      independentlyVerified: false,
      uncertainty: "OCR/layout machine extraction. Row clusters are approximate.",
    },
    limitations: [
      "Row/column relationships are coarse Y-clusters — not a verified table parse.",
      "not_found means not recovered from examined associations — not proof the drawing lacks content.",
      "Do not treat recovered quotes as professional verification of code compliance.",
    ],
    hits: {
      scheduleHeaders: scheduleHeaders.length,
      hardware: hardware.length,
      fire: fire.length,
      marks: marks.length,
      visualHardware: hardware.filter(isVisual).length,
      visualFire: fire.filter(isVisual).length,
      rowClusters: rows.length,
    },
  };
}

/**
 * FP200 regression: hydraulic values via existing pilot geometry/sequential logic.
 */
export function extractHydraulicEvidence(layout, options = {}) {
  const mode = options.mode || "stage3_visual";
  const associations = filterByMode(layout.associations || [], mode);
  const fakeLayout = { associations };
  const labelHits = collectTopicHits(fakeLayout, "hydraulic_design");
  const valuePattern = /\b(?:\d+\.\d+|\d{3,})\s*(?:GPM)?\b|\b1524\b|\b0\.15\b/i;
  const valueHits = associations
    .filter((item) => valuePattern.test(item.text || ""))
    .map(toHit);
  const hits = [...labelHits, ...valueHits];
  const assessment = assessHydraulicRelationships(hits);
  const texts = hits.map((item) => item.text).slice(0, 40);
  const values = assessment.values || {};
  const recovered = values.densityGpmPerSqFt != null && values.dischargeAreaSqFt != null
    && values.flowDemandGpm != null;
  return {
    id: packageId("FP200", "hydraulic_design", texts),
    topic: "hydraulic_design",
    status: recovered ? "evidence_recovered" : "partial_recovery",
    extractedTexts: [...new Set(texts)].slice(0, 30),
    detailIdentifier: "HYDRAULIC DESIGN",
    bbox: expandBbox(hits.slice(0, 20), 20),
    assessment,
    provenance: {
      origin: mode === "text_layer_only" ? "machine_extracted_text_layer" : "mixed_text_and_visual",
      method: "stage3_hydraulic_label_value",
      independentlyVerified: false,
      uncertainty: "Machine extraction. Density×area is not FLOW DEMAND.",
    },
    limitations: [
      "Density × discharge area is not total FLOW DEMAND.",
      "Values are machine-extracted — not verified hydraulic calculations.",
    ],
    hits: { labelHits: labelHits.length, valueHits: valueHits.length },
  };
}

export function formatStage3PromptBlock(pack) {
  if (!pack || pack.status === "disabled") return "";
  const lines = [
    "Stage 3 targeted visual evidence pack (machine-extracted; independentlyVerified=false):",
    "Not professionally verified compliance evidence. Quote before Critical absence. Empty/sparse packs mean not recovered — not proof of absence.",
    `pack=${pack.id} | topic=${pack.topic} | status=${pack.status} | method=${pack.provenance?.method}`,
  ];
  if (pack.detailIdentifier) lines.push(`detailIdentifier: ${oneLine(pack.detailIdentifier, 160)}`);
  if (pack.assessment?.detailIdentifier) {
    lines.push(`associatedDetail: ${oneLine(pack.assessment.detailIdentifier, 160)}`);
  }
  if (pack.extractedTexts?.length) {
    lines.push(`excerpts: ${pack.extractedTexts.slice(0, 12).map((text) => oneLine(text, 160)).join(" || ")}`);
  } else {
    lines.push(`excerpts: (none — ${pack.status})`);
  }
  if (pack.topic === "guardrail_detail_height" && pack.assessment) {
    lines.push(
      `guardrailAssociation: ${pack.assessment.status} (${pack.assessment.applicableToGuardrail})`,
    );
    if (pack.assessment.rejectedGenericHeights?.length) {
      lines.push(`rejectedGenericHeights: ${pack.assessment.rejectedGenericHeights.join(" | ")}`);
    }
  }
  if (pack.topic === "door_schedule_structured" && pack.assessment?.present) {
    const present = pack.assessment.present;
    lines.push(
      `presence: schedule=${present.scheduleHeader} locking=${present.lockingHardware} fire=${present.fireRatingNotes}`,
    );
  }
  if (pack.topic === "hydraulic_design" && pack.assessment?.values) {
    const values = pack.assessment.values;
    lines.push(
      `hydraulicValues: density=${values.densityGpmPerSqFt ?? "n/a"} area=${values.dischargeAreaSqFt ?? "n/a"} hose=${values.hoseAllowanceGpm ?? "n/a"} flowDemand=${values.flowDemandGpm ?? "n/a"} (density×area≠flowDemand)`,
    );
  }
  if (pack.limitations?.length) lines.push(`limitations: ${pack.limitations.join(" ")}`);
  return lines.join("\n");
}

export function compareModes(stage3Pack, textPack) {
  return {
    stage3Status: stage3Pack.status,
    textLayerStatus: textPack.status,
    stage3Recovered: String(stage3Pack.status).includes("recovered"),
    textLayerRecovered: String(textPack.status).includes("recovered"),
    improvement: String(stage3Pack.status).includes("recovered")
      && !String(textPack.status).includes("recovered"),
    independentlyVerified: false,
  };
}

/** Legitimate Critical controls must not be auto-cleared by pack presence alone. */
export function evaluateCriticalControls(doorPack) {
  const present = doorPack?.assessment?.present || {};
  return {
    controls: [
      {
        id: "P-001-style-egress-conflict",
        retainedIfGenerated: true,
        note: "Quoted hardware presence does not clear a contradictory lock-vs-egress conflict with supporting quotes.",
      },
      {
        id: "blanket-locking-absence",
        softFailCandidate: Boolean(present.lockingHardware),
        note: "Blanket locking absence may soft-fail only when hardware is quoted — conflict Criticals remain.",
      },
      {
        id: "blanket-fire-absence",
        softFailCandidate: Boolean(present.fireRatingNotes),
        note: "Fire-note quotes may contradict blanket absence; schedule completeness still unresolved.",
      },
    ],
    independentlyVerified: false,
  };
}

export async function runStage3VisualExtractionSpike(options = {}) {
  const started = Date.now();
  const datasetOut = options.datasetOut;
  const outDir = options.outDir;
  const sourceDir = options.sourceDir || null;
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "packages"), { recursive: true });
  await mkdir(path.join(outDir, "crops"), { recursive: true });

  const sheets = {};
  const comparisons = {};

  for (const sheet of PILOT_SHEETS) {
    const layoutPath = path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`);
    if (!existsSync(layoutPath)) {
      sheets[sheet.id] = { status: "layout_missing", path: layoutPath };
      continue;
    }
    const layout = JSON.parse(await readFile(layoutPath, "utf8"));
    const t0 = Date.now();

    let stage3;
    let textOnly;
    if (sheet.id === "A-3.06") {
      stage3 = extractGuardrailDetailEvidence(layout, { mode: "stage3_visual" });
      textOnly = extractGuardrailDetailEvidence(layout, { mode: "text_layer_only" });
    } else if (sheet.id === "A-6.00") {
      stage3 = extractDoorScheduleEvidence(layout, { mode: "stage3_visual" });
      textOnly = extractDoorScheduleEvidence(layout, { mode: "text_layer_only" });
    } else {
      stage3 = extractHydraulicEvidence(layout, { mode: "stage3_visual" });
      textOnly = extractHydraulicEvidence(layout, { mode: "text_layer_only" });
    }

    stage3.latencyMs = Date.now() - t0;
    stage3.promptBlock = formatStage3PromptBlock(stage3);
    stage3.sheetId = sheet.id;
    stage3.relativePath = sheet.relativePath;
    stage3.sourceFileSha256 = sheet.sha256;
    stage3.spikeVersion = STAGE3_SPIKE_VERSION;
    textOnly.sheetId = sheet.id;
    textOnly.mode = "text_layer_only";

    // Optional crop for visual reference (gitignored out/).
    stage3.crop = { status: "skipped" };
    if (sourceDir && stage3.bbox) {
      const pdfPath = path.join(sourceDir, sheet.relativePath);
      const cropPath = path.join(outDir, "crops", `${stage3.id}.png`);
      const rendered = renderCropViaPython(pdfPath, cropPath, stage3.bbox, {
        pythonBin: options.pythonBin,
      });
      stage3.crop = {
        status: rendered.status || (existsSync(cropPath) ? "ok" : "failed"),
        path: existsSync(cropPath) ? cropPath : null,
        message: rendered.message || null,
        independentlyVerified: false,
      };
    }

    await writeFile(path.join(outDir, "packages", `${stage3.id}.json`), JSON.stringify(stage3, null, 2));
    sheets[sheet.id] = stage3;
    comparisons[sheet.id] = compareModes(stage3, textOnly);
    if (sheet.id === "A-6.00") {
      comparisons[sheet.id].criticalControls = evaluateCriticalControls(stage3);
    }
  }

  const summary = {
    version: STAGE3_SPIKE_VERSION,
    professionallyVerified: false,
    generatedAt: new Date().toISOString(),
    latencyMsTotal: Date.now() - started,
    approaches: {
      preferred: "targeted_ocr_via_existing_layout_full_associations",
      crops: "optional_visual_reference_only_not_sent_to_gpt_in_spike",
      rejectedForSpike: "blanket_full_page_ocr_reprocess",
    },
    sheets,
    comparisons,
    tradeoffs: {
      ocrVsCrop: "OCR supplies quoteable text for the existing PDF→GPT prompt path; crops alone duplicate vision already available via input_file unless used as human audit artifacts.",
      edgeConstraint: "Supabase Edge cannot run macOS Vision; reuse code-analyzer-worker / offline Phase 2A path or cache packs at ingest.",
      railway: "code-analyzer-worker already hosts Vision OCR — smallest reuse target for productionized Stage 3.",
    },
    notes: [
      "Spike only — no production wiring, no paid GPT.",
      "independentlyVerified is always false.",
      "Extraction failure must fail open in any future integration.",
    ],
  };

  await writeFile(path.join(outDir, "stage3-spike-summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "stage3-spike-report.md"), renderMarkdown(summary));
  return summary;
}

function renderMarkdown(summary) {
  const lines = [
    `# Stage 3 visual extraction spike`,
    ``,
    `Version: ${summary.version}`,
    `Professionally verified: false`,
    ``,
    `## Comparisons`,
  ];
  for (const [sheetId, cmp] of Object.entries(summary.comparisons || {})) {
    lines.push(`- **${sheetId}**: stage3=${cmp.stage3Status} text_layer=${cmp.textLayerStatus} improvement=${cmp.improvement}`);
  }
  lines.push(``, `## Notes`);
  for (const note of summary.notes || []) lines.push(`- ${note}`);
  return `${lines.join("\n")}\n`;
}

export { assessGuardrailHeightAssociation, assessHydraulicRelationships, collectTopicHits };
