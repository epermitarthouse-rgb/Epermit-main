#!/usr/bin/env node
/**
 * Verify Phase 2 fixes against the real 1513 P St NW scanned form.
 * Uses stored LLM-shaped extraction (combined measure paragraph) when --mock is passed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

loadEnv(path.join(root, "scraper-service/.env"));

const { analyzeCodeModification, extractPdfPageTexts, HEURISTIC_FIELD_WARNINGS } =
  await import(
    path.join(root, "scraper-service/app/services/compliance/code-modification.service.js")
  );

const COMBINED_MEASURE =
  "In lieu of providing a second means of egress stairs, the following life safety measures are proposed: Provide a two-hour fire rated enclosed stairway serving all occupied levels, provide a fully automatic sprinkler system throughout the building, provide a fully monitored fire alarm and emergency notification system, maintain an occupant load below 49 people per floor. Incorporated DOB recommendations from June 9, 2026 PDRM include a standpipe, maintain a common path of travel distance of less than 75'-0\", provide permanent signage identifying and limiting the maximum occupant load of the rooftop amenity area.";

const STORED_VISION = {
  projectAddress: "1513 P St NW, Washington DC, 20005",
  requestedModification:
    "The code modification request is for the use of a targeted equivalency strategy for alternative life safety design implementation methods in lieu of providing a second egress stair requirement per 2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006.",
  citedSections: [
    {
      citation:
        "2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006",
      year: null,
      source: "applicant",
      label: "Applicant-cited code",
    },
  ],
  impracticalReason:
    "The existing building footprint is approximately 12,000 square feet per floor. The project includes a renovation and vertical expansion of an existing two story office building with a cellar to include a new third floor addition and occupiable roof. Per 2017 DCMR 12A, DC Building Code with Amendments (2015 IBC) Chapter 10, Section 1006 a second means of egress is required. Due to the limited floor area and low occupant load (48 for the whole building), adding a second egress stair would significantly reduce the amount of usable and rentable space within the building.",
  compliesWithIntent: true,
  proposedMeasures: [{ id: "measure-1", description: COMBINED_MEASURE, sourcePageNumber: 2 }],
  floodHazardApplicable: false,
  extractionWarnings: [],
};

async function downloadPdf() {
  const filePath =
    "f1f84c83-36f6-4664-b34b-614b2881f09d/c3b28078-b090-4e1c-8f22-336933626e05/39ed971e-8f26-4b8a-a17e-83e2d2ee872b_1513_P_St_NW_Code_Modification_Form_10.01.24.pdf";
  const url = `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/project-documents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) throw new Error(`PDF download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function mockOpenAi(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify(payload) } }],
        }),
      },
    },
  };
}

function summarize(outcome) {
  const extracted = outcome.result.extracted_request;
  return {
    address: extracted.projectAddress,
    requestedModificationPreview: extracted.requestedModification.slice(0, 120) + "...",
    citedSections: extracted.citedSections.length,
    measureCount: extracted.proposedMeasures.length,
    measures: extracted.proposedMeasures.map((m) => ({
      id: m.id,
      sourcePageNumber: m.sourcePageNumber ?? null,
      description: m.description.slice(0, 90) + (m.description.length > 90 ? "..." : ""),
    })),
    extractionWarnings: outcome.result.extraction_warnings,
    evidenceRows: outcome.result.evidence.length,
    overallStatus: outcome.result.overall_status,
  };
}

function assertFixes(report) {
  const stale = [
    HEURISTIC_FIELD_WARNINGS.requestedModification,
    HEURISTIC_FIELD_WARNINGS.citedSections,
    HEURISTIC_FIELD_WARNINGS.proposedMeasures,
  ];
  const hasStale = report.extractionWarnings.some((w) => stale.includes(w));
  if (hasStale) {
    throw new Error(`Stale extraction warnings remain: ${JSON.stringify(report.extractionWarnings)}`);
  }
  if (report.measureCount < 5) {
    throw new Error(`Expected >= 5 split measures, got ${report.measureCount}`);
  }
}

const useMock = process.argv.includes("--mock") || !process.env.OPENAI_API_KEY;
const pdfBuffer = fs.existsSync("/tmp/1513-mod-form.pdf")
  ? fs.readFileSync("/tmp/1513-mod-form.pdf")
  : await downloadPdf();
const pages = await extractPdfPageTexts(pdfBuffer.toString("base64"));

let openai;
if (useMock) {
  openai = mockOpenAi(STORED_VISION);
  console.log("Mode: mock vision payload (stored 1513 extraction shape)");
} else {
  const OpenAI = (await import("openai")).default;
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.log("Mode: live OpenAI vision extract");
}

const outcome = await analyzeCodeModification({
  openai,
  formPages: pages,
  formImages: [{ pageNumber: 2, imageBase64: "placeholder", imageType: "image/png" }],
  formDocument: { id: "2aea3869-2181-40e3-aad5-9b2bee552c60" },
  logInfo: () => {},
  logError: console.error,
});

const report = summarize(outcome);
assertFixes(report);
console.log(JSON.stringify({ ok: true, report }, null, 2));
