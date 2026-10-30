/**
 * Bounded Stage 3 evidence pack for non-pilot sheets (all disciplines).
 * Reuses layout-full associations; prefers Vision OCR lines when present.
 */
import { createHash } from "node:crypto";

const MAX_REGION_SNIPPETS = 6;
const MAX_LINES_PER_REGION = 4;
const MAX_PROMPT_CHARS = 1100;

function oneLine(value, max = 200) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function packageId(sheetId, topic, texts) {
  const digest = createHash("sha1").update(`${sheetId}|${topic}|${texts.join("|")}`).digest("hex").slice(0, 12);
  return `${sheetId}.${topic}.${digest}`;
}

function isVisual(item) {
  return String(item.origin || "").includes("visual")
    || String(item.extractionMethod || "").includes("vision");
}

function rankAssociation(item) {
  let score = 0;
  if (isVisual(item)) score += 4;
  if (item.regionKind === "schedule_candidate") score += 3;
  if (item.regionKind === "notes_band") score += 2;
  if (item.regionKind === "title_block") score += 1;
  const len = String(item.text || "").length;
  if (len >= 12 && len <= 120) score += 1;
  return score;
}

function groupByRegion(associations) {
  const groups = new Map();
  for (const item of associations || []) {
    const key = item.regionId || item.regionKind || "unassigned";
    if (!groups.has(key)) {
      groups.set(key, {
        regionId: item.regionId || null,
        regionKind: item.regionKind || "unknown",
        lines: [],
      });
    }
    groups.get(key).lines.push(item);
  }
  return [...groups.values()];
}

export function inferSheetTopic(sheetId) {
  const id = String(sheetId || "").toUpperCase();
  if (/^A-3\.06/.test(id)) return "guardrail_detail_height";
  if (/^A-6\.00/.test(id)) return "door_schedule_structured";
  if (id === "FP200" || id.startsWith("FP200")) return "hydraulic_design";
  if (/^E-/.test(id)) return "electrical_notes_and_schedules";
  if (/^M-/.test(id)) return "mechanical_notes_and_schedules";
  if (/^FP/.test(id)) return "fire_protection_hydraulic";
  if (/^S-/.test(id)) return "structural_notes_and_details";
  if (/^C-/.test(id)) return "civil_site_notes";
  return "sheet_layout_summary";
}

export function extractGenericSheetEvidence(layout, options = {}) {
  const sheetId = options.sheetId || layout.sheetId || layout.relativePath?.replace(/\.pdf$/i, "") || "sheet";
  const topic = options.topic || inferSheetTopic(sheetId);
  const associations = (layout.associations || []).slice().sort((a, b) => rankAssociation(b) - rankAssociation(a));
  const regions = groupByRegion(associations);
  regions.sort((a, b) => {
    const kindScore = (kind) => (
      kind === "schedule_candidate" ? 5
        : kind === "notes_band" ? 4
          : kind === "drawing_field" ? 3
            : kind === "title_block" ? 2 : 1
    );
    return kindScore(b.regionKind) - kindScore(a.regionKind);
  });

  const regionSnippets = [];
  const extractedTexts = [];
  for (const group of regions.slice(0, MAX_REGION_SNIPPETS)) {
    const lines = group.lines
      .slice()
      .sort((a, b) => rankAssociation(b) - rankAssociation(a))
      .slice(0, MAX_LINES_PER_REGION)
      .map((item) => ({
        text: oneLine(item.text, 160),
        bbox: item.bbox || null,
        origin: item.origin || null,
        extractionMethod: item.extractionMethod || null,
        independentlyVerified: false,
      }))
      .filter((item) => item.text);
    if (!lines.length) continue;
    regionSnippets.push({
      regionId: group.regionId,
      regionKind: group.regionKind,
      lines,
      independentlyVerified: false,
    });
    for (const line of lines) extractedTexts.push(line.text);
  }

  const dims = (layout.counts?.dimensions ?? layout.structureFactCounts?.dimensions ?? 0);
  const notes = (layout.counts?.notes ?? layout.structureFactCounts?.notes ?? 0);
  const schedules = (layout.counts?.schedules ?? layout.structureFactCounts?.schedules ?? 0);
  const visualLines = associations.filter(isVisual).length;

  const status = regionSnippets.length ? "evidence_recovered" : "partial_recovery";
  const pack = {
    id: packageId(sheetId, topic, extractedTexts.slice(0, 12)),
    sheetId,
    topic,
    status,
    extractedTexts: extractedTexts.slice(0, 24),
    regionSnippets,
    assessment: {
      layoutStatus: layout.layoutStatus || null,
      regionSnippetCount: regionSnippets.length,
      structureFacts: { dimensions: dims, notes, schedules },
      visualOcrAssociations: visualLines,
      independentlyVerified: false,
    },
    limitations: [
      "Generic layout summary — not a full OCR transcript.",
      "independentlyVerified=false; PDF remains primary visual input.",
    ],
    provenance: {
      origin: "stage3_generic_layout_association",
      method: "macos-vision_layout_full",
      independentlyVerified: false,
      uncertainty: "Bounded excerpts only; absence in pack is not proof of absence on sheet.",
    },
    independentlyVerified: false,
  };
  pack.promptBlock = formatGenericStage3PromptBlock(pack);
  return pack;
}

export function formatGenericStage3PromptBlock(pack) {
  const lines = [
    `Stage3 OCR pack sheet=${pack.sheetId} topic=${pack.topic} status=${pack.status} independentlyVerified=false`,
    `structureFacts: dimensions=${pack.assessment?.structureFacts?.dimensions ?? "n/a"} notes=${pack.assessment?.structureFacts?.notes ?? "n/a"} schedules=${pack.assessment?.structureFacts?.schedules ?? "n/a"}`,
  ];
  for (const region of pack.regionSnippets || []) {
    const quoted = (region.lines || []).map((line) => oneLine(line.text, 120)).join(" | ");
    if (!quoted) continue;
    lines.push(`region=${region.regionKind || "unknown"} id=${region.regionId || "n/a"}: ${quoted}`);
    if (lines.join("\n").length > MAX_PROMPT_CHARS) break;
  }
  if (pack.limitations?.length) {
    lines.push(`limitations: ${pack.limitations.map((item) => oneLine(item, 100)).join(" ")}`);
  }
  return lines.join("\n").slice(0, MAX_PROMPT_CHARS);
}
