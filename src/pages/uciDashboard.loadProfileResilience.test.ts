import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const workspaceSource = readFileSync(
  join(__dirname, "..", "components", "uci", "LoadProfileWorkspace.tsx"),
  "utf8",
);

function actionBlock(start: string, end: string): string {
  const startIndex = dashboardSource.indexOf(start);
  assert.ok(startIndex >= 0, `missing action marker: ${start}`);
  const endIndex = dashboardSource.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing action end marker: ${end}`);
  return dashboardSource.slice(startIndex, endIndex);
}

describe("UCI Load Profile action resilience", () => {
  it("guards same-tick duplicate submissions for all three actions", () => {
    const analyze = actionBlock(
      "const handleLoadProfileAnalyze = async",
      "const handleLoadCandidateExtract = async",
    );
    const extract = actionBlock(
      "const handleLoadCandidateExtract = async",
      "const handleImportDocumentFindings = async",
    );
    const importFindings = actionBlock(
      "const handleImportDocumentFindings = async",
      "const handleLoadCandidateResolve = async",
    );

    assert.match(analyze, /loadProfileInFlightRef\.current/);
    assert.match(extract, /loadCandidateInFlightRef\.current/);
    assert.match(importFindings, /importFindingsInFlightRef\.current/);
  });

  it("always releases busy state so action buttons recover after failures", () => {
    const analyze = actionBlock(
      "const handleLoadProfileAnalyze = async",
      "const handleLoadCandidateExtract = async",
    );
    const extract = actionBlock(
      "const handleLoadCandidateExtract = async",
      "const handleImportDocumentFindings = async",
    );
    const importFindings = actionBlock(
      "const handleImportDocumentFindings = async",
      "const handleLoadCandidateResolve = async",
    );

    assert.match(analyze, /finally\s*\{[\s\S]*setLoadProfileBusy\(false\)/);
    assert.match(extract, /finally\s*\{[\s\S]*setLoadCandidateBusy\(false\)/);
    assert.match(importFindings, /finally\s*\{[\s\S]*setImportFindingsBusy\(false\)/);
    assert.match(workspaceSource, /disabled=\{analyzeBusy\}/);
    assert.match(workspaceSource, /disabled=\{candidateBusy \|\| !selectedPepcoApplicationId\}/);
    assert.match(workspaceSource, /disabled=\{importFindingsBusy \|\| !selectedPepcoApplicationId\}/);
  });

  it("keeps Source documents and manual upload visible before analysis", () => {
    assert.match(
      workspaceSource,
      /\{!summary \?\s*\([\s\S]*?Run load profile analysis[\s\S]*?\)\s*:\s*null\}/,
    );
    assert.doesNotMatch(
      workspaceSource,
      /\{!summary\s*\?[\s\S]{0,500}:\s*\(\s*<Tabs/,
      "the workspace tabs must not be gated on an analyzed load-profile summary",
    );
    assert.match(workspaceSource, /<TabsContent value="source_documents"/);
    assert.match(workspaceSource, />Upload supporting document</);
    assert.match(workspaceSource, /onManualUpload\(\s*manualUploadFiles,/);
  });

  it("enables batch upload only after one or more files are selected", () => {
    const uploadStart = workspaceSource.indexOf("Upload supporting document");
    const uploadEnd = workspaceSource.indexOf("Filename and ranking categories", uploadStart);
    assert.ok(uploadStart >= 0 && uploadEnd > uploadStart);
    const uploadBlock = workspaceSource.slice(uploadStart, uploadEnd);

    assert.match(uploadBlock, /type="file"[\s\S]{0,200}multiple/);
    assert.match(
      uploadBlock,
      /setManualUploadFiles\(Array\.from\(event\.target\.files \?\? \[\]\)\)/,
    );
    assert.match(
      uploadBlock,
      /disabled=\{manualUploadBusy \|\| manualUploadFiles\.length === 0\}/,
    );
    assert.doesNotMatch(
      uploadBlock,
      /disabled=\{[\s\S]{0,100}!selectedPepcoApplicationId[\s\S]{0,100}\}/,
      "application scope must not keep the button disabled after files are selected",
    );
  });

  it("routes every selected file through project storage and Agent 2 processing", () => {
    const manualUpload = actionBlock(
      "const handleAgent2ManualUpload = async",
      "const handleApplicationPackageBuild = async",
    );
    const uploadIndex = manualUpload.indexOf("executeProjectDocumentUpload");
    const processingIndex = manualUpload.indexOf("runCoordinationDocumentProcessing");
    const importIndex = manualUpload.indexOf("importCoordinationDocumentFindings");

    assert.ok(uploadIndex >= 0, "manual upload must use the shared project document uploader");
    assert.ok(processingIndex > uploadIndex, "document processing must run after storage upload");
    assert.ok(importIndex > processingIndex, "findings import must run after document processing");
    assert.match(
      manualUpload,
      /for \(const \[index, file\] of files\.entries\(\)\) \{[\s\S]*executeProjectDocumentUpload/,
    );
    assert.match(manualUpload, /manualUploadInFlightRef\.current/);
  });

  it("does not require a utility application for manual processing", () => {
    const manualUpload = actionBlock(
      "const handleAgent2ManualUpload = async",
      "const handleApplicationPackageBuild = async",
    );
    assert.doesNotMatch(manualUpload, /Select or synchronize a utility application/);
    assert.match(
      manualUpload,
      /runCoordinationDocumentProcessing\(detailId,\s*\{\s*external_application_id: externalApplicationId/,
    );
    assert.match(
      manualUpload,
      /importCoordinationDocumentFindings\(detailId,\s*\{\s*external_application_id: externalApplicationId/,
    );
    assert.doesNotMatch(
      workspaceSource,
      /if \(!coordinationId \|\| !selectedPepcoApplicationId\) return/,
    );
  });

  it("uses the document-scoped endpoint with distinct single and batch results", () => {
    const reprocess = actionBlock(
      "const handleAgent2DocumentReprocess = async",
      "const handleApplicationPackageBuild = async",
    );
    assert.match(reprocess, /executeSequentialDocumentReprocess/);
    assert.match(reprocess, /reprocessCoordinationDocument/);
    assert.match(reprocess, /document_id: documentId/);
    assert.match(reprocess, /if \(documentIds\.length === 1\)/);
    assert.match(reprocess, /summarizeDocumentReprocessBatch/);
    assert.match(workspaceSource, /Reprocess pending documents/);
    assert.match(workspaceSource, /Reprocessing \$\{reprocessProgress\.completed\}/);
    assert.match(workspaceSource, /\n\s+Reprocess\n/);
  });
});
