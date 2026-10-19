import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exportComplianceReportPDF } from "./complianceReportPDF.ts";

/** Render the real jsPDF document and return the text runs it draws. */
async function renderPdfText(options: Parameters<typeof exportComplianceReportPDF>[0]): Promise<string> {
  let blob: Blob | null = null;
  const url = URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
  const original = { create: url.createObjectURL, revoke: url.revokeObjectURL };
  const g = globalThis as unknown as { document?: unknown };
  const originalDocument = g.document;
  url.createObjectURL = (b: Blob) => {
    blob = b;
    return "blob:test";
  };
  url.revokeObjectURL = () => {};
  g.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
  try {
    exportComplianceReportPDF(options);
  } finally {
    url.createObjectURL = original.create;
    url.revokeObjectURL = original.revoke;
    g.document = originalDocument;
  }
  assert.ok(blob, "PDF was produced");
  const raw = Buffer.from(await (blob as Blob).arrayBuffer()).toString("latin1");
  return [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1]).join("\n");
}

const issue = (id: string, codeType: "ibc" | "local") => ({
  id,
  category: "Egress",
  title: `Finding ${id}`,
  description: "Exit width is not dimensioned.",
  severity: "warning" as const,
  codeReference: "IBC 1005.1",
  codeYear: "2021",
  location: "Plan",
  suggestedFix: "Dimension the exit width.",
  codeType,
  codeSourceStatus: "unverified",
});

const summary = (totalIssues: number) => ({
  totalIssues,
  critical: 0,
  warnings: totalIssues,
  advisory: 0,
  overallScore: null,
  reviewState: totalIssues ? "reviewed_findings" : "reviewed_clear",
  codeCoverageVerified: false,
});

describe("PDF export reviewer decisions", () => {
  it("prints Accept, Modify with the edited text, N/A, and Unreviewed on the finding that owns each decision", async () => {
    const shared = issue("issue-1", "ibc");
    const edited = "Raise the service counter to 36 inches.";
    const text = await renderPdfText({
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      summary: summary(4),
      issues: [shared, shared, shared, shared],
      responses: {
        "file-accept:issue-1": { status: "accepted", originalFix: shared.suggestedFix },
        "file-modify:issue-1": { status: "modified", originalFix: shared.suggestedFix, modifiedResponse: edited },
        "file-na:issue-1": { status: "rejected", originalFix: shared.suggestedFix },
        "issue-1": { status: "accepted", originalFix: shared.suggestedFix, modifiedResponse: "LEAKED EDIT" },
      },
      jurisdictionNotes: "",
      filesAnalyzed: 4,
      fileSections: [
        { fileId: "file-accept", fileName: "A-101.pdf", summary: summary(1), issues: [shared] },
        { fileId: "file-modify", fileName: "A-102.pdf", summary: summary(1), issues: [shared] },
        { fileId: "file-na", fileName: "A-103.pdf", summary: summary(1), issues: [shared] },
        { fileId: "file-open", fileName: "A-104.pdf", summary: summary(1), issues: [shared] },
      ],
      responseKeyForIssue: (item, fileId) => (fileId ? `${fileId}:${item.id}` : item.id),
    });
    assert.equal((text.match(/Response: Accept/g) ?? []).length, 1);
    assert.equal((text.match(/Response: Modify/g) ?? []).length, 1);
    assert.equal((text.match(/Response: N\/A/g) ?? []).length, 1);
    assert.equal((text.match(/Response: Unreviewed/g) ?? []).length, 1);
    assert.equal((text.match(/Raise the service counter to 36 inches/g) ?? []).length, 1);
    assert.equal(text.includes("LEAKED EDIT"), false);
  });

  it("keeps each sheet's decision on its own finding when issue ids repeat across sheets", async () => {
    const a = issue("issue-1", "ibc");
    const b = issue("issue-1", "local");
    const text = await renderPdfText({
      jurisdiction: "general",
      projectType: "commercial",
      codeYear: "2021",
      summary: summary(2),
      issues: [a, b],
      responses: { "file-a:issue-1": { status: "accepted", originalFix: a.suggestedFix } },
      jurisdictionNotes: "",
      filesAnalyzed: 3,
      fileSections: [
        { fileId: "file-a", fileName: "A-101.pdf", summary: summary(1), issues: [a] },
        { fileId: "file-b", fileName: "E-101.pdf", summary: summary(1), issues: [b] },
        { fileId: "file-c", fileName: "G-001.pdf", summary: summary(0), issues: [] },
      ],
      responseKeyForIssue: (item, fileId) => (fileId ? `${fileId}:${item.id}` : item.id),
    });
    assert.equal((text.match(/Response: Accept/g) ?? []).length, 1);
    assert.equal((text.match(/Response: Unreviewed/g) ?? []).length, 1);
    assert.match(text, /Total Issues Found: 2/);
    assert.match(text, /No findings identified for this file\./);
    assert.doesNotMatch(text, /\b(?:0|100)%/);
  });
});
