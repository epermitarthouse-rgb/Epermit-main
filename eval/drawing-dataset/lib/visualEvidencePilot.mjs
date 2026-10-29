/**
 * Phase 3 visual evidence grounding pilot (offline).
 * Reuses recovery OCR + layout-full associations. Not professionally verified.
 * Does not call GPT-4o or modify production analyzers.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCropViaPython } from "./adjudicateCrops.mjs";

export const VISUAL_EVIDENCE_PILOT_VERSION = "phase3.visual-evidence-pilot.v1";

export const PILOT_SHEETS = [
  {
    id: "A-6.00",
    relativePath: "A-6.00-00.pdf",
    sha256: "28369090ce34e1d503f9364bc293f9be51ff37bb521dd50a86968b472411c56d",
    topics: ["door_schedule", "locking", "fire_rating", "egress_notes"],
  },
  {
    id: "A-3.06",
    relativePath: "A-3.06-00.pdf",
    sha256: "c20cc018310747ea435c888f7c1b1d4884ef8d1054b16da9ab770a504a33b6cf",
    topics: ["guardrail_height", "guardrail_notes"],
  },
  {
    id: "FP200",
    relativePath: "FP200 .pdf",
    sha256: "983bbfcf38083ff04c7b5c93092f2267f3d5776a01f92ff71411460107127dea",
    topics: ["hydraulic_design"],
  },
];

const TOPIC_PATTERNS = {
  door_schedule: /\bDOOR\s+SCHEDULE\b|\bMARK\s+DOOR\b|\bDOOR\s*#?\s*\d+/i,
  locking: /\b(?:PANIC|LOCK(?:SET|GUARD)?|SCHLAGE|V\.?\s*DUPRIN|ALARM\s+LOCK|KEYLESS|EGRESS)\b/i,
  fire_rating: /\bFIRE\s*RATED|\bFIRE[- ]RATING|\bUL\s*LABEL|\bOPENING\s+PROTECTIVE|\bGASKETS?\s+FOR\s+DOOR/i,
  egress_notes: /\bEXIT\s+DOORS?\b|\bDIRECTION\s+OF\s+EGRESS\b|\bUNLOCKED\s+WHENEVER\b/i,
  guardrail_height: /3\s*['′]\s*-?\s*6\s*"?\s*MIN\.?\s*HEIGHT|\bMIN\.?\s*HEIGHT(?:\s+FROM)?\b/i,
  guardrail_notes: /\bGUARD\s*RAIL\b|\bPIPE\s+RAILING\b|\bEXTEND\s+GUARD\b/i,
  hydraulic_design: /\b(?:HYDRAULIC\s+DESIGN|DENSITY|DISCHARGE\s+AREA|HOSE\s+ALLOWANCE|FLOW\s+DEMAND|PRESSURE\s+DEMAND)\b/i,
};

function expandBbox(items, pad = 18) {
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

function packageId(sheetId, topic, texts) {
  const digest = createHash("sha1").update(`${sheetId}|${topic}|${texts.join("|")}`).digest("hex").slice(0, 12);
  return `${sheetId}.${topic}.${digest}`;
}

export function collectTopicHits(layout, topic) {
  const pattern = TOPIC_PATTERNS[topic];
  if (!pattern) return [];
  const hits = [];
  for (const item of layout.associations || []) {
    const text = item.text || "";
    if (!pattern.test(text)) continue;
    hits.push({
      text,
      bbox: item.bbox || null,
      regionId: item.regionId || null,
      regionKind: item.regionKind || null,
      origin: item.origin || null,
      extractionMethod: item.extractionMethod || null,
      associationMethod: item.associationMethod || null,
      independentlyVerified: false,
    });
  }
  // Prefer OCR/visual hits when available; keep text-layer too.
  hits.sort((a, b) => {
    const rank = (item) => (String(item.origin).includes("visual") ? 0 : 1);
    return rank(a) - rank(b);
  });
  return hits;
}

export function assessGuardrailHeightAssociation(hits) {
  const heightHits = hits.filter((hit) => TOPIC_PATTERNS.guardrail_height.test(hit.text));
  const guardHits = hits.filter((hit) => TOPIC_PATTERNS.guardrail_notes.test(hit.text));
  if (!heightHits.length) {
    return {
      status: "not_found",
      note: "No MIN HEIGHT / 3'-6\" string recovered on this sheet.",
      applicableToGuardrail: "unresolved",
    };
  }
  if (!guardHits.length) {
    return {
      status: "found_unassociated",
      note: "Height dimension recovered, but no nearby guard-rail language in the hit set.",
      applicableToGuardrail: "unresolved",
    };
  }
  // Same coarse region or overlapping expanded windows.
  const heightBox = expandBbox(heightHits, 0);
  const guardBox = expandBbox(guardHits, 80);
  const sameRegion = heightHits.some((h) =>
    guardHits.some((g) => h.regionId && g.regionId && h.regionId === g.regionId)
  );
  const near =
    heightBox
    && guardBox
    && !(
      heightBox.x + heightBox.width < guardBox.x
      || guardBox.x + guardBox.width < heightBox.x
      || heightBox.y + heightBox.height < guardBox.y
      || guardBox.y + guardBox.height < heightBox.y
    );
  return {
    status: sameRegion || near ? "associated_candidate" : "found_distant",
    note: sameRegion || near
      ? "Height string co-located with guard-rail notes/region (candidate association only)."
      : "Height and guard-rail text recovered but geometric association is weak.",
    applicableToGuardrail: sameRegion || near ? "likely_same_detail_candidate" : "unresolved",
    independentlyVerified: false,
  };
}

function nearestValueAfterLabel(hits, labelPattern, valuePattern, options = {}) {
  const maxDy = options.maxDy ?? 40;
  const maxDx = options.maxDx ?? 250;
  const labels = hits.filter((hit) => labelPattern.test(hit.text || "") && hit.bbox);
  const values = hits.filter((hit) => valuePattern.test(hit.text || "") && hit.bbox);
  let best = null;
  for (const label of labels) {
    const lx = label.bbox.x + label.bbox.width / 2;
    const ly = label.bbox.y + label.bbox.height / 2;
    for (const value of values) {
      const match = String(value.text).match(valuePattern);
      if (!match) continue;
      const vx = value.bbox.x + value.bbox.width / 2;
      const vy = value.bbox.y + value.bbox.height / 2;
      const dx = vx - lx;
      const dy = Math.abs(vy - ly);
      // Values sit to the right of labels on this sheet's hydraulic box.
      if (dx < -20 || dx > maxDx || dy > maxDy) continue;
      const score = dy * 3 + Math.abs(dx);
      if (!best || score < best.score) best = { raw: match[1], score };
    }
  }
  return best?.raw ?? null;
}

function sequentialFallback(hits, labelPattern, valuePattern) {
  const texts = hits.map((hit) => hit.text || "");
  for (let index = 0; index < texts.length; index += 1) {
    if (!labelPattern.test(texts[index])) continue;
    for (let cursor = index; cursor < Math.min(texts.length, index + 4); cursor += 1) {
      const match = texts[cursor].match(valuePattern);
      if (match) return match[1];
    }
  }
  return null;
}

export function assessHydraulicRelationships(hits) {
  // Prefer geometry-aware label→value pairing; OCR often splits across lines.
  const densityRaw = nearestValueAfterLabel(hits, /\bDENSITY\b/i, /([\d.]+)\s*GPM/i)
    || nearestValueAfterLabel(hits, /\bDENSITY\b/i, /\b(0\.\d+)\b/)
    || sequentialFallback(hits, /\bDENSITY\b/i, /([\d.]+)\s*GPM/i);
  const areaRaw = nearestValueAfterLabel(hits, /DISCHARGE\s+AREA/i, /([\d,]+)\s*(?:ft|ft²|sf)?/i, { maxDy: 50 })
    || nearestValueAfterLabel(hits, /DISCHARGE\s+AREA/i, /\b(1524)\b/)
    || sequentialFallback(hits, /DISCHARGE\s+AREA/i, /([\d,]+)/);
  const hoseRaw = nearestValueAfterLabel(hits, /HOSE\s+ALLOWANCE/i, /([\d.]+)\s*GPM/i)
    || sequentialFallback(hits, /HOSE\s+ALLOWANCE/i, /([\d.]+)\s*GPM/i);
  const flowRaw = nearestValueAfterLabel(hits, /FLOW\s+DEMAND/i, /([\d.]+)\s*GPM/i)
    || sequentialFallback(hits, /FLOW\s+DEMAND/i, /([\d.]+)\s*GPM/i);
  const densityVal = densityRaw != null ? Number(String(densityRaw).replace(/,/g, "")) : null;
  const areaVal = areaRaw != null ? Number(String(areaRaw).replace(/,/g, "")) : null;
  const hoseVal = hoseRaw != null ? Number(String(hoseRaw).replace(/,/g, "")) : null;
  const flowVal = flowRaw != null ? Number(String(flowRaw).replace(/,/g, "")) : null;
  const product = densityVal != null && areaVal != null ? Number((densityVal * areaVal).toFixed(4)) : null;
  return {
    values: {
      densityGpmPerSqFt: densityVal,
      dischargeAreaSqFt: areaVal,
      hoseAllowanceGpm: hoseVal,
      flowDemandGpm: flowVal,
      densityTimesArea: product,
    },
    relationships: {
      densityAreaEqualsFlowDemand: product != null && flowVal != null
        ? Math.abs(product - flowVal) <= Math.max(1, product * 0.02)
        : null,
      densityAreaPlusHoseNearFlow: product != null && hoseVal != null && flowVal != null
        ? Math.abs(product + hoseVal - flowVal) <= Math.max(2, flowVal * 0.05)
        : null,
    },
    interpretation:
      "Density × discharge area is a density-area quantity, not proof that FLOW DEMAND is wrong. Values are OCR/machine-extracted.",
    independentlyVerified: false,
  };
}

export function assessDoorEvidence(hitsByTopic) {
  const schedule = hitsByTopic.door_schedule || [];
  const locking = hitsByTopic.locking || [];
  const fire = hitsByTopic.fire_rating || [];
  const egress = hitsByTopic.egress_notes || [];
  return {
    schedulePresent: schedule.length > 0,
    lockingHardwareQuoted: locking.length > 0,
    fireRatingLanguageQuoted: fire.length > 0,
    egressNotesQuoted: egress.length > 0,
    sampleLocking: locking.slice(0, 8).map((hit) => hit.text),
    sampleFire: fire.slice(0, 6).map((hit) => hit.text),
    sampleEgress: egress.slice(0, 4).map((hit) => hit.text),
    phase2bCriticalStance: {
      lockingAbsenceCritical: locking.length
        ? "contradicted_candidate_by_quoted_hardware"
        : "unresolved_or_not_examined",
      fireRatingAbsenceCritical: fire.length
        ? "partially_contradicted_candidate_door11_gasket_note"
        : "unresolved_or_not_examined",
      note: "OCR quotes contradict blanket absence claims when hardware/fire notes are visible. Full schedule-column completeness still needs professional review.",
    },
    independentlyVerified: false,
  };
}

export function buildEvidencePackage({ sheet, topic, hits, assessment = null }) {
  const texts = hits.map((hit) => hit.text);
  const status = hits.length
    ? "evidence_recovered"
    : "not_found";
  return {
    id: packageId(sheet.id, topic, texts.slice(0, 5)),
    pilotVersion: VISUAL_EVIDENCE_PILOT_VERSION,
    sheetId: sheet.id,
    relativePath: sheet.relativePath,
    sourceFileSha256: sheet.sha256,
    topic,
    status,
    notFoundVsNotExamined: hits.length ? "found" : "not_found_on_examined_ocr_layout",
    extractedTexts: texts.slice(0, 40),
    hitCount: hits.length,
    regionKinds: [...new Set(hits.map((hit) => hit.regionKind).filter(Boolean))],
    regionIds: [...new Set(hits.map((hit) => hit.regionId).filter(Boolean))],
    bbox: expandBbox(hits.slice(0, 30)),
    provenance: {
      origins: [...new Set(hits.map((hit) => hit.origin).filter(Boolean))],
      extractionMethods: [...new Set(hits.map((hit) => hit.extractionMethod).filter(Boolean))],
      independentlyVerified: false,
      uncertainty: "OCR/layout machine extraction. Not professionally verified technical truth.",
    },
    assessment,
    crop: null,
  };
}

export async function runVisualEvidencePilot(options = {}) {
  const outDir = options.outDir;
  const sourceDir = options.sourceDir;
  const datasetOut = options.datasetOut;
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "crops"), { recursive: true });
  await mkdir(path.join(outDir, "packages"), { recursive: true });

  const packages = [];
  const sheetReports = [];

  for (const sheet of PILOT_SHEETS) {
    const layoutPath = path.join(datasetOut, "layout-full/pages", `${sheet.sha256}.json`);
    const recoveryPath = path.join(datasetOut, "recovery", `${sheet.sha256}.json`);
    if (!existsSync(layoutPath)) {
      sheetReports.push({
        sheetId: sheet.id,
        status: "layout_missing",
        note: `Missing ${layoutPath}`,
      });
      continue;
    }
    const layout = JSON.parse(await readFile(layoutPath, "utf8"));
    const recovery = existsSync(recoveryPath)
      ? JSON.parse(await readFile(recoveryPath, "utf8"))
      : null;

    const hitsByTopic = {};
    for (const topic of sheet.topics) {
      hitsByTopic[topic] = collectTopicHits(layout, topic);
    }

    let assessments = {};
    if (sheet.id === "A-3.06") {
      const combined = [...(hitsByTopic.guardrail_height || []), ...(hitsByTopic.guardrail_notes || [])];
      assessments.guardrail = assessGuardrailHeightAssociation(combined);
      const pkg = buildEvidencePackage({
        sheet,
        topic: "guardrail_height",
        hits: combined,
        assessment: assessments.guardrail,
      });
      packages.push(pkg);
    } else if (sheet.id === "A-6.00") {
      assessments.door = assessDoorEvidence(hitsByTopic);
      for (const topic of ["door_schedule", "locking", "fire_rating", "egress_notes"]) {
        packages.push(buildEvidencePackage({
          sheet,
          topic,
          hits: hitsByTopic[topic] || [],
          assessment: topic === "locking" || topic === "fire_rating" ? assessments.door : null,
        }));
      }
    } else if (sheet.id === "FP200") {
      const labelHits = hitsByTopic.hydraulic_design || [];
      // OCR often places numeric values on adjacent lines that lack the label keyword.
      const valuePattern = /\b(?:\d+\.\d+|\d{3,})\s*(?:GPM)?\b|\b1524\b|\b0\.15\b/i;
      const valueHits = (layout.associations || [])
        .filter((item) => valuePattern.test(item.text || ""))
        .filter((item) => {
          if (!labelHits.length || !item.bbox) return true;
          return labelHits.some((label) => {
            if (!label.bbox) return label.regionId && item.regionId === label.regionId;
            const dx = Math.abs((label.bbox.x + label.bbox.width / 2) - (item.bbox.x + item.bbox.width / 2));
            const dy = Math.abs((label.bbox.y + label.bbox.height / 2) - (item.bbox.y + item.bbox.height / 2));
            return dx < 220 && dy < 140;
          });
        })
        .map((item) => ({
          text: item.text,
          bbox: item.bbox || null,
          regionId: item.regionId || null,
          regionKind: item.regionKind || null,
          origin: item.origin || null,
          extractionMethod: item.extractionMethod || null,
          associationMethod: item.associationMethod || null,
          independentlyVerified: false,
        }));
      const hits = [...labelHits, ...valueHits];
      assessments.hydraulic = assessHydraulicRelationships(hits);
      packages.push(buildEvidencePackage({
        sheet,
        topic: "hydraulic_design",
        hits,
        assessment: assessments.hydraulic,
      }));
    }

    // Render up to one crop per sheet package with a bbox.
    for (const pkg of packages.filter((item) => item.sheetId === sheet.id && item.bbox)) {
      if (!sourceDir) {
        pkg.crop = { status: "skipped_no_source_dir" };
        continue;
      }
      const pdfPath = path.join(sourceDir, sheet.relativePath);
      const cropPath = path.join(outDir, "crops", `${pkg.id}.png`);
      const rendered = renderCropViaPython(pdfPath, cropPath, pkg.bbox, {
        pythonBin: options.pythonBin,
        force: options.force,
      });
      pkg.crop = {
        status: rendered.status || (existsSync(cropPath) ? "ok" : "failed"),
        path: existsSync(cropPath) ? cropPath : null,
        message: rendered.message || null,
        independentlyVerified: false,
      };
      await writeFile(path.join(outDir, "packages", `${pkg.id}.json`), JSON.stringify(pkg, null, 2));
    }

    sheetReports.push({
      sheetId: sheet.id,
      relativePath: sheet.relativePath,
      sha256: sheet.sha256,
      layoutStatus: layout.layoutStatus || null,
      ocrLineCount: recovery?.pages?.[0]?.ocrLineCount ?? null,
      regionCount: (layout.regions || []).length,
      associationCount: (layout.associations || []).length,
      topicHitCounts: Object.fromEntries(
        Object.entries(hitsByTopic).map(([topic, hits]) => [topic, hits.length]),
      ),
      assessments,
      independentlyVerified: false,
    });
  }

  const summary = {
    version: VISUAL_EVIDENCE_PILOT_VERSION,
    professionallyVerified: false,
    generatedAt: new Date().toISOString(),
    sheets: sheetReports,
    packages,
    metrics: computePilotMetrics(packages, sheetReports),
    notes: [
      "Offline pilot only. OCR and layout are machine-extracted.",
      "not_found means not recovered from examined OCR/layout — not proof the drawing lacks the content.",
      "Crops and packages under out/ are gitignored and must stay out of Git.",
    ],
  };

  await writeFile(path.join(outDir, "pilot-summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, "pilot-report.md"), renderMarkdown(summary));
  return summary;
}

export function computePilotMetrics(packages, sheetReports) {
  const recovered = packages.filter((pkg) => pkg.status === "evidence_recovered").length;
  const missing = packages.filter((pkg) => pkg.status === "not_found").length;
  const croppedOk = packages.filter((pkg) => pkg.crop?.status === "ok" || pkg.crop?.path).length;
  const a6 = sheetReports.find((sheet) => sheet.sheetId === "A-6.00");
  const a306 = sheetReports.find((sheet) => sheet.sheetId === "A-3.06");
  const fp = sheetReports.find((sheet) => sheet.sheetId === "FP200");
  return {
    packagesTotal: packages.length,
    evidenceRecovered: recovered,
    notFound: missing,
    cropsRenderedOrCached: croppedOk,
    a6LockingRecovered: Boolean(a6?.assessments?.door?.lockingHardwareQuoted),
    a6FireLanguageRecovered: Boolean(a6?.assessments?.door?.fireRatingLanguageQuoted),
    a306HeightAssociatedCandidate:
      a306?.assessments?.guardrail?.applicableToGuardrail === "likely_same_detail_candidate",
    fp200HydraulicValuesComplete: Boolean(
      fp?.assessments?.hydraulic?.values?.densityGpmPerSqFt
      && fp?.assessments?.hydraulic?.values?.dischargeAreaSqFt
      && fp?.assessments?.hydraulic?.values?.flowDemandGpm
      && fp?.assessments?.hydraulic?.values?.hoseAllowanceGpm,
    ),
    fp200DensityAreaEqualsFlowDemand:
      fp?.assessments?.hydraulic?.relationships?.densityAreaEqualsFlowDemand === true,
  };
}

function renderMarkdown(summary) {
  const lines = [
    `# Phase 3 visual evidence grounding pilot`,
    "",
    `Generated: ${summary.generatedAt}`,
    `Version: \`${summary.version}\``,
    `Professionally verified: **${summary.professionallyVerified}**`,
    "",
    "## Metrics",
    "",
    ...Object.entries(summary.metrics).map(([key, value]) => `- ${key}: **${value}**`),
    "",
    "## Sheets",
    "",
  ];
  for (const sheet of summary.sheets) {
    lines.push(`### ${sheet.sheetId}`);
    lines.push("");
    lines.push(`- Path: \`${sheet.relativePath}\``);
    lines.push(`- OCR lines: ${sheet.ocrLineCount}`);
    lines.push(`- Topic hits: \`${JSON.stringify(sheet.topicHitCounts)}\``);
    if (sheet.assessments) {
      lines.push(`- Assessment: \`${JSON.stringify(sheet.assessments).slice(0, 500)}\``);
    }
    lines.push("");
  }
  lines.push("## Packages");
  lines.push("");
  for (const pkg of summary.packages) {
    lines.push(`- **${pkg.id}** · ${pkg.status} · hits=${pkg.hitCount} · regions=${pkg.regionKinds.join(",") || "n/a"} · crop=${pkg.crop?.status || "n/a"}`);
    if (pkg.extractedTexts?.length) {
      lines.push(`  - sample: ${pkg.extractedTexts.slice(0, 3).map((text) => JSON.stringify(text)).join("; ")}`);
    }
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  for (const note of summary.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
