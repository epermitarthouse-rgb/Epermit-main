import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { buildArchitectReviewModel, fingerprintArchitectReview } from "./architectReview.ts";
import {
  architectReviewPdfFileName,
  renderArchitectReviewPdf,
  type ArchitectReviewPdfLayout,
  type ReportLogo,
} from "./brandedReport.ts";
import type { AnalyzerRunDataset } from "./client.ts";
import { DISCLAIMER_PARAGRAPHS, FOOTER_NOTICE, RUNNING_HEADER } from "./reportBranding.ts";
import { finding, fixtureDataset, job, review, run, stressDataset, uuidFor } from "./fixtures/architectReviewFixtures.ts";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));
const LOGO: ReportLogo = {
  data: readFileSync(join(here, "../../assets/commun-et-logo.jpg")).toString("base64"),
  format: "JPEG",
  width: 1920,
  height: 1156,
};
const GENERATED_AT = new Date("2026-10-28T15:00:00Z");
const winAnsi = new TextDecoder("windows-1252");

interface ParsedPdf {
  pages: string[][];
  bookmarks: string[];
  /** Link destinations by 1-based page number. */
  linkTargets: Map<number, number[]>;
}

function decodePdfString(raw: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      bytes.push(raw.charCodeAt(index));
      continue;
    }
    const next = raw[index + 1];
    if (/[0-7]/.test(next)) {
      const octal = raw.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)![0];
      bytes.push(parseInt(octal, 8));
      index += octal.length;
    } else {
      const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return winAnsi.decode(Uint8Array.from(bytes));
}

function parsePdf(bytes: Uint8Array): ParsedPdf {
  const source = Buffer.from(bytes).toString("latin1");
  const objects = new Map<number, string>();
  for (const match of source.matchAll(/(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)) objects.set(Number(match[1]), match[2]);
  const pageIds = [...objects.entries()]
    .filter(([, body]) => /\/Type \/Page\r?\n/.test(body))
    .map(([id]) => id)
    .sort((left, right) => left - right);
  const pageNumberById = new Map(pageIds.map((id, index) => [id, index + 1]));
  const pages = pageIds.map((id) => {
    const contentsId = Number(objects.get(id)!.match(/\/Contents (\d+) 0 R/)![1]);
    const body = objects.get(contentsId)!;
    const stream = body.match(/stream\r?\n([\s\S]*)\r?\nendstream/)![1];
    const content = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
    return [...content.matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj/g)].map((match) => decodePdfString(match[1]));
  });
  const bookmarks = [...objects.values()]
    .filter((body) => body.includes("/Parent") && !body.includes("/Type /Page"))
    .flatMap((body) => [...body.matchAll(/\/Title \(((?:\\[\s\S]|[^\\)])*)\)/g)].map((match) => decodePdfString(match[1])));
  const linkTargets = new Map<number, number[]>();
  for (const id of pageIds) {
    const targets = [...objects.get(id)!.matchAll(/\/Dest \[(\d+) 0 R/g)].map((match) => pageNumberById.get(Number(match[1]))!);
    linkTargets.set(pageNumberById.get(id)!, targets);
  }
  return { pages, bookmarks, linkTargets };
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

function bodyText(pdf: ParsedPdf, layout: ArchitectReviewPdfLayout): string {
  const furniture = new Set([RUNNING_HEADER, FOOTER_NOTICE, ...layout.sections.map((section) => section.title)]);
  return normalize(
    pdf.pages
      .flatMap((segments) => segments.filter((segment) => (
        !furniture.has(segment)
        && !/^DRAFT \u00b7 /.test(segment)
        && !/^Report [0-9A-F-]{14}( DRAFT)? \u00b7 \d+ \/ \d+$/.test(segment)
        && !/\(continued\)$/.test(segment)
      )))
      .join(" "),
  );
}

async function render(dataset: AnalyzerRunDataset, projectName = "Fixture project") {
  const model = buildArchitectReviewModel(dataset);
  const fingerprint = await fingerprintArchitectReview(dataset);
  const { doc, layout } = renderArchitectReviewPdf({ dataset, model, fingerprint, projectName, generatedAt: GENERATED_AT, logo: LOGO });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return { model, fingerprint, layout, bytes, pdf: parsePdf(bytes) };
}

function reviewedFixture() {
  const { dataset } = fixtureDataset();
  const ids = new Map(buildArchitectReviewModel(dataset).findings.map((item) => [item.reportId, item.findingId]));
  return {
    ...dataset,
    reviews: [
      review(ids.get("C-001")!, "accepted"),
      review(ids.get("C-002")!, "modified", { modified_response: "Reconcile total demand with the full hydraulic calculation." }),
      review(ids.get("W-010")!, "rejected"),
    ],
  };
}

describe("Branded architect review PDF: 252-finding fixture", () => {
  it("presents every included finding with its source content, citation and reviewer decision", async () => {
    const dataset = reviewedFixture();
    const { model, layout, pdf } = await render(dataset);
    const text = bodyText(pdf, layout);
    assert.equal(model.clientFindings.length, 251);
    for (const item of model.clientFindings) {
      assert.ok(text.includes(normalize(`${item.reportId} | ${item.title}`)), `${item.reportId} heading`);
      assert.ok(text.includes(normalize(`Observation (source): ${item.observation}`)), `${item.reportId} observation`);
      assert.ok(text.includes(normalize(`Drawing evidence (source): ${item.drawingEvidence}`)), `${item.reportId} evidence`);
      if (item.drawingLocation) assert.ok(text.includes(normalize(`Location (source): ${item.drawingLocation}`)), `${item.reportId} location`);
      if (item.codeReference) assert.ok(text.includes(normalize(`Original citation (not endorsed): ${item.codeReference}`)), `${item.reportId} citation`);
      if (item.recommendationRevised) {
        assert.ok(text.includes(normalize(`Recommended action (reviewer revised): ${item.presentedRecommendation}`)));
        assert.ok(text.includes(normalize(`Original recommendation (source): ${item.recommendation}`)));
      } else {
        assert.ok(text.includes(normalize(`Recommended action (source): ${item.recommendation}`)), `${item.reportId} recommendation`);
      }
      assert.ok(text.includes(`Source finding ${String(item.sourceSequence).padStart(3, "0")}`));
    }
    assert.match(text, /Reviewer decision: Accepted \u00b7 \d{2}\/\d{2}\/2026/);
    assert.match(text, /Reviewer decision: Modified \u00b7 \d{2}\/\d{2}\/2026/);
    assert.equal(
      (text.match(/Original citation \(not endorsed\):/g) || []).length,
      model.clientFindings.filter((item) => item.codeReference).length,
    );

    const withdrawn = model.withdrawnFindings[0];
    assert.equal(withdrawn.reportId, "W-010");
    assert.ok(!text.includes(normalize(withdrawn.observation)), "withdrawn finding content is not presented");
    const appendix = layout.sections.find((section) => section.key === "withdrawn")!;
    assert.ok(normalize(pdf.pages[appendix.page - 1].join(" ")).includes("W-010"));
  });

  it("places findings in severity order on the pages the layout records", async () => {
    const { model, layout, pdf } = await render(fixtureDataset().dataset);
    const order = model.clientFindings.map((item) => item.reportId);
    assert.deepEqual(order.slice(0, 5), ["C-001", "C-002", "C-003", "C-004", "W-001"]);
    let previousPage = 0;
    for (const item of model.clientFindings) {
      const page = layout.findingPages.get(item.reportId)!;
      assert.ok(page >= previousPage, `${item.reportId} is not before the previous finding`);
      previousPage = page;
      assert.ok(pdf.pages[page - 1].some((segment) => segment.startsWith(`${item.reportId} | `)), `${item.reportId} on page ${page}`);
    }
    const sectionPage = (key: string) => layout.sections.find((section) => section.key === key)!.page;
    assert.ok(sectionPage("critical") < sectionPage("warning"));
    assert.ok(sectionPage("warning") < sectionPage("advisory"));
    assert.equal(layout.findingPages.get("C-001"), sectionPage("critical"));
    assert.equal(layout.findingPages.get("W-001"), sectionPage("warning"));
    assert.equal(layout.findingPages.get("A-001"), sectionPage("advisory"));
  });

  it("carries the verbatim disclaimer, the running header and a footer with page numbers on every page", async () => {
    const { fingerprint, layout, pdf } = await render(fixtureDataset().dataset);
    const cover = normalize(pdf.pages[0].join(" "));
    assert.ok(cover.includes("PROFESSIONAL VERIFICATION REQUIRED"));
    for (const runs of DISCLAIMER_PARAGRAPHS) {
      assert.ok(cover.includes(normalize(runs.map((part) => part.text).join(""))), "disclaimer paragraph");
    }
    assert.ok(cover.includes("PermitPilot\u2122 Code Analyzer"));
    assert.ok(cover.includes(`Report version: ${fingerprint.label}`));
    assert.ok(cover.includes("Findings: 252 total \u00b7 Critical 4 \u00b7 Warning 83 \u00b7 Advisory 165"));
    assert.ok(cover.includes("Review scope: 82 completed, 0 failed, 82 total sheets"));
    assert.equal(layout.pageCount, pdf.pages.length);
    pdf.pages.forEach((segments, index) => {
      assert.ok(segments.includes(FOOTER_NOTICE), `footer on page ${index + 1}`);
      assert.ok(segments.includes(`Report ${fingerprint.label} \u00b7 ${index + 1} / ${pdf.pages.length}`), `page number on page ${index + 1}`);
      if (index > 0) assert.ok(segments.includes(RUNNING_HEADER), `running header on page ${index + 1}`);
    });
  });

  it("links the cover navigation and bookmarks to the right pages", async () => {
    const { model, layout, pdf } = await render(fixtureDataset().dataset);
    const sectionPage = (key: string) => layout.sections.find((section) => section.key === key)!.page;
    const coverTargets = new Set(pdf.linkTargets.get(1));
    for (const key of ["summary", "critical", "warning", "advisory", "inventory", "guide", "coverage", "record"]) {
      assert.ok(coverTargets.has(sectionPage(key)), `cover link to ${key}`);
    }
    assert.equal(pdf.bookmarks.length, layout.sections.length + model.clientFindings.length);
    assert.ok(pdf.bookmarks.includes("Critical findings \u00b7 4"));
    assert.ok(pdf.bookmarks.includes("C-002 | FP200 | Inconsistent Hydraulic Calculations"));
    for (const item of model.clientFindings) {
      assert.ok(pdf.bookmarks.some((title) => title.startsWith(`${item.reportId} | `)), `bookmark ${item.reportId}`);
    }
  });

  it("reproduces the client inventory table and the full-report traceability record", async () => {
    const { fingerprint, layout, pdf } = await render(fixtureDataset().dataset);
    const inventory = pdf.pages[layout.sections.find((section) => section.key === "inventory")!.page - 1];
    const rows = [
      ["Architectural", "22", "1", "26", "39", "66"],
      ["Plumbing", "14", "0", "14", "34", "48"],
      ["Fire Protection", "4", "1", "3", "6", "10"],
      ["TOTAL", "82", "4", "83", "165", "252"],
    ];
    for (const row of rows) {
      const start = inventory.indexOf(row[0]);
      assert.ok(start >= 0, row[0]);
      assert.deepEqual(inventory.slice(start, start + row.length), row);
    }
    const record = normalize(pdf.pages[layout.pageCount - 1].join(" "));
    assert.ok(record.includes(`Report fingerprint (SHA-256): ${fingerprint.digest}`));
    assert.ok(record.includes("Disclaimer text: commun-et-disclaimer.2026-10-26"));
    assert.ok(record.includes("Published findings: 252"));
  });

  it("is byte-for-byte reproducible for the same stored data and generation time", async () => {
    const dataset = reviewedFixture();
    const first = await render(dataset);
    const second = await render({ ...dataset, findings: [...dataset.findings].reverse(), jobs: [...dataset.jobs].reverse() });
    assert.deepEqual(second.bytes, first.bytes);
    assert.equal(architectReviewPdfFileName(dataset.run.id, first.fingerprint), `PermitPilot-Architect-Review-649fdaa6-${first.fingerprint.label}.pdf`);
  });
});

describe("Branded architect review PDF: edge cases", () => {
  it("marks an unfinished analysis as a draft on the cover and every page", async () => {
    const { dataset } = fixtureDataset();
    const draft = {
      ...dataset,
      run: { ...dataset.run, status: "processing" as const },
      jobs: dataset.jobs.map((item, index) => (index === 0 ? { ...item, status: "processing" as const } : item)),
    };
    const { layout, pdf } = await render(draft);
    assert.ok(normalize(pdf.pages[0].join(" ")).includes("DRAFT. The analysis has sheets that are not finished."));
    assert.equal(layout.sections.find((section) => section.key === "summary")!.page, 2, "cover fits on one page");
    pdf.pages.forEach((segments, index) => {
      assert.ok(segments.some((segment) => /^Report [0-9A-F-]{14} DRAFT \u00b7 /.test(segment)), `draft footer on page ${index + 1}`);
    });
  });

  it("shows an unrecognized severity unchanged in its own section and records characters it could not draw", async () => {
    const sheet = job({ id: "job-1", ordinal: 1, detected_sheet_number: "A-101", detected_sheet_title: "Plan" });
    const dataset: AnalyzerRunDataset = {
      run: run({ total_sheets: 1 }),
      jobs: [sheet],
      findings: [
        finding({ id: uuidFor(1), sheet_job_id: "job-1", finding_index: 0, severity: "warning", observation: "Riser height \u2265 7 inches." }),
        finding({ id: uuidFor(2), sheet_job_id: "job-1", finding_index: 1, severity: "major" as "warning" }),
      ],
    };
    const before = JSON.stringify(dataset);
    const { layout, pdf } = await render(dataset);
    assert.equal(JSON.stringify(dataset), before);
    const text = bodyText(pdf, layout);
    assert.ok(text.includes("Riser height >= 7 inches."));
    assert.equal(layout.substitutedCharacters, 1);
    assert.ok(layout.sections.some((section) => section.key === "other"));
    assert.ok(text.includes("U-001 | Observation"));
    assert.ok(text.includes("Stored severity: major"));
    assert.ok(text.includes("1 character(s) could not be drawn in the report font and were replaced. The stored text is unchanged."));
    assert.ok(text.includes('has unrecognized stored severity "major"'));
  });

  it("renders the 1,200-finding stress fixture with every ID and a bookmark per finding", async () => {
    const dataset = stressDataset();
    const started = performance.now();
    const { model, layout, pdf } = await render(dataset);
    const elapsed = performance.now() - started;
    assert.equal(model.clientFindings.length, 1100);
    assert.equal(pdf.bookmarks.length, layout.sections.length + 1100);
    for (const item of model.clientFindings) {
      assert.ok(layout.findingPages.has(item.reportId), item.reportId);
    }
    assert.ok(elapsed < 30000, `render took ${elapsed.toFixed(0)} ms`);
    console.log(`stress PDF: ${layout.pageCount} pages, ${elapsed.toFixed(0)} ms`);
  });
});
