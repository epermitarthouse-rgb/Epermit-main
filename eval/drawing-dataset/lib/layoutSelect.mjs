/**
 * Phase 2A.3 pilot sheet list and Phase 2A.4 full-set selection.
 * Filenames are source paths. FP200 keeps its trailing space in the filename.
 */

export const LAYOUT_VERSION = "phase2a3.layout.v1";
export const LAYOUT_FULL_VERSION = "phase2a4.layout.full.v1";
export const LAYOUT_PYTHON_VERSION = "phase2a3.layout.opencv.1";

export const DEFAULT_LAYOUT_SHEETS = [
  {
    relativePath: "A-1.00-00.pdf",
    discipline: "architectural",
    reason: "Outlined floor plan with notes and title block; hybrid OCR already recovered callouts.",
  },
  {
    relativePath: "FP200 .pdf",
    discipline: "fire_protection",
    reason: "Fire-protection sheet with denser live text for schedule/notes region tests.",
  },
  {
    relativePath: "M-3.0.pdf",
    discipline: "mechanical",
    reason: "Mechanical notes recovered by OCR; tests note-to-equipment association.",
  },
  {
    relativePath: "E-2.1-00.pdf",
    discipline: "electrical",
    reason: "Schedule-heavy electrical sheet for grid/table region hypotheses.",
  },
  {
    relativePath: "S-204.00.pdf",
    discipline: "structural",
    reason: "Structural sheet with dual published titles; layout must not merge identities.",
  },
];

/** One representative sheet per discipline family for Phase 2A.4 validation sampling. */
export const DISCIPLINE_VALIDATION_SAMPLES = [
  { relativePath: "A-1.00-00.pdf", discipline: "architectural" },
  { relativePath: "S-204.00.pdf", discipline: "structural" },
  { relativePath: "M-3.0.pdf", discipline: "mechanical" },
  { relativePath: "E-2.1-00.pdf", discipline: "electrical" },
  { relativePath: "P-1.5-00.pdf", discipline: "plumbing" },
  { relativePath: "FP200 .pdf", discipline: "fire_protection" },
  { relativePath: "EQ-1.00-0.pdf", discipline: "equipment" },
  { relativePath: "DM-1.00-00.pdf", discipline: "demolition" },
  { relativePath: "G-0.00-0.pdf", discipline: "general" },
  { relativePath: "CV-1.00-00.pdf", discipline: "civil" },
  { relativePath: "EN-1.00-0.pdf", discipline: "energy" },
  { relativePath: "MD-1.1.pdf", discipline: "mechanical_detail" },
];

export function disciplineFromFilename(relativePath) {
  const name = String(relativePath || "").trim();
  if (/^FP\d/i.test(name) || /^FP\s/i.test(name)) return "fire_protection";
  if (/^EQ[-.]/i.test(name)) return "equipment";
  if (/^DM[-.]/i.test(name)) return "demolition";
  if (/^MD[-.]/i.test(name)) return "mechanical_detail";
  if (/^CV[-.]/i.test(name)) return "civil";
  if (/^EN[-.]/i.test(name)) return "energy";
  if (/^G[-.]/i.test(name) || /^G\d/i.test(name)) return "general";
  if (/^A[-.]/i.test(name)) return "architectural";
  if (/^S[-.]/i.test(name)) return "structural";
  if (/^M[-.]/i.test(name)) return "mechanical";
  if (/^E[-.]/i.test(name)) return "electrical";
  if (/^P[-.]/i.test(name)) return "plumbing";
  return "other";
}

export function resolveLayoutSheets(inventory, requested = DEFAULT_LAYOUT_SHEETS) {
  const byPath = new Map((inventory.files || []).map((file) => [file.relativePath, file]));
  return requested.map((sheet) => {
    const file = byPath.get(sheet.relativePath) || null;
    return {
      ...sheet,
      file,
      present: Boolean(file),
      sha256: file?.sha256 || null,
      processingStatus: file?.processingStatus || "missing",
    };
  });
}

/**
 * Every extracted PDF in inventory order. Archive.zip and non-PDFs are excluded
 * but remain accountable via inventory/reconciliation reports.
 */
export function listAllLayoutSheets(inventory) {
  const pdfs = (inventory.files || []).filter((file) => file.format === "pdf");
  return pdfs.map((file) => ({
    relativePath: file.relativePath,
    discipline: disciplineFromFilename(file.relativePath),
    reason: "Phase 2A.4 full layout reconstruction",
    file,
    present: true,
    sha256: file.sha256 || null,
    processingStatus: file.processingStatus || "missing",
  }));
}

export function resolveValidationSamples(inventory, samples = DISCIPLINE_VALIDATION_SAMPLES) {
  const byPath = new Map((inventory.files || []).map((file) => [file.relativePath, file]));
  return samples.map((sample) => {
    const file = byPath.get(sample.relativePath) || null;
    return {
      ...sample,
      present: Boolean(file),
      sha256: file?.sha256 || null,
      processingStatus: file?.processingStatus || "missing",
      note: file
        ? "Selected for representative discipline validation; not professionally verified."
        : "Sample filename missing from inventory; recorded as unresolved validation gap.",
    };
  });
}
