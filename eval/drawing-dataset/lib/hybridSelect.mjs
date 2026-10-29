/**
 * Fixed Phase 2A.2 hybrid-pilot sheet list.
 * These names are filenames in the source directory, not published identities.
 * S-204.00.pdf and S-300.00.pdf stay distinct. Archive.zip is not a drawing.
 */

export const HYBRID_VERSION = "phase2a2.hybrid.v1";
export const PYTHON_EXTRACT_VERSION = "phase2a2.hybrid.pymupdf.1";

export const DEFAULT_PILOT_SHEETS = [
  {
    relativePath: "A-1.00-00.pdf",
    discipline: "architectural",
    reason: "Outlined first-floor plan; 37 unread ink cells; four published findings.",
  },
  {
    relativePath: "S-204.00.pdf",
    discipline: "structural",
    reason: "One file carries two published titles for S-204.00.",
  },
  {
    relativePath: "S-300.00.pdf",
    discipline: "structural",
    reason: "Source PDF with no published finding identity; denser live text layer.",
  },
  {
    relativePath: "M-3.0.pdf",
    discipline: "mechanical",
    reason: "Mechanical plan; 36 unread ink cells and little text-layer coverage.",
  },
  {
    relativePath: "E-4.0-00.pdf",
    discipline: "electrical",
    reason: "Highest unread-ink count (41) among the 82 pages.",
  },
  {
    relativePath: "E-2.1-00.pdf",
    discipline: "electrical",
    reason: "Schedule-heavy electrical sheet for table/layout comparison.",
  },
  {
    relativePath: "P-1.5-00.pdf",
    discipline: "plumbing",
    reason: "Plumbing plan; includes the one text-layer evidence span already found.",
  },
  {
    relativePath: "FP100.pdf",
    discipline: "fire_protection",
    reason: "Fire-protection notes with denser live text than the CAD plans.",
  },
];

export const REQUIRED_ACCOUNTABILITY = ["S-204.00.pdf", "S-300.00.pdf", "Archive.zip"];

export function disciplinesCovered(sheets = DEFAULT_PILOT_SHEETS) {
  return [...new Set(sheets.map((sheet) => sheet.discipline))].sort();
}

export function resolvePilotSheets(inventory, requested = DEFAULT_PILOT_SHEETS) {
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

export function inventoryAccountability(inventory) {
  const files = inventory.files || [];
  const missing = REQUIRED_ACCOUNTABILITY.filter((name) => !files.some((file) => file.relativePath === name));
  const pdfCount = files.filter((file) => file.format === "pdf").length;
  const zip = files.find((file) => file.relativePath === "Archive.zip");
  return {
    walkedFiles: inventory.walkedFiles ?? files.length,
    recordedFiles: files.length,
    pdfCount,
    zipPresent: Boolean(zip),
    zipStatus: zip?.processingStatus || null,
    requiredPresent: missing.length === 0,
    missingRequired: missing,
    s204: files.find((file) => file.relativePath === "S-204.00.pdf") || null,
    s300: files.find((file) => file.relativePath === "S-300.00.pdf") || null,
  };
}
