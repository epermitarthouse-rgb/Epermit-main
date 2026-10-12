#!/usr/bin/env node
/**
 * Live Riverside V2 acceptance — upload, ingest, DC+both async analysis, metrics.
 * Usage: node scripts/live-riverside-v2-acceptance.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const RIVERSIDE_DIR =
  "/Users/javerianaveed/epermit/riverside /24-070 Riverside Condominium Permit Set";
const BEFORE_RUN_ID = "f0e87391-5183-4fca-a1b6-54706726eae2";
const BEFORE_PROJECT_ID = "4a452dbb-ff1d-4109-b34c-7265de4bee8c";
const USER_ID = "f1f84c83-36f6-4664-b34b-614b2881f09d";

function loadEnv() {
  const envPath = new URL("../code-analyzer-worker/.env", import.meta.url);
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sanitizeStorageFileName(name) {
  return name.replace(/[^\w.\-()+ ]+/g, "_");
}

function buildPath(userId, projectId, fileName) {
  const objectId = randomUUID();
  const storageFileName = sanitizeStorageFileName(fileName);
  return {
    filePath: `${userId}/${projectId}/${objectId}_${storageFileName}`,
    objectId,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MEASURABLE_RE =
  /\b(width|clearance|slope|ramp|rise|run|riser|tread|dimension|distance|spacing|44\s*in|48\s*in|1:12)\b/i;
const PARKED_RE = /\b(parked\s+vehicles?|vehicle(s)?\s+obstruct)\b/i;

async function collectBeforeMetrics(sb) {
  const { data: anns } = await sb
    .from("document_annotations")
    .select("data")
    .eq("project_id", BEFORE_PROJECT_ID)
    .eq("analysis_run_id", BEFORE_RUN_ID);
  const issues = (anns || []).filter((a) => a.data?.compliance_issue).map((a) => a.data);
  return summarizeIssues(issues, "before");
}

function summarizeIssues(issues, label) {
  const semantic = new Set();
  let dupes = 0;
  for (const i of issues) {
    const key = `${i.category}|${i.codeReference}|${String(i.title || "").toLowerCase().slice(0, 60)}`;
    if (semantic.has(key)) dupes++;
    semantic.add(key);
  }
  return {
    label,
    total: issues.length,
    confirmed: issues.filter((i) => i.finding_type === "confirmed_violation" || i.findingType === "confirmed_violation").length,
    potential: issues.filter((i) => (i.finding_type || i.findingType) === "potential_concern").length,
    verify: issues.filter((i) => (i.finding_type || i.findingType) === "missing_information").length,
    critical: issues.filter((i) => i.severity === "critical").length,
    criticalNoStrong: issues.filter(
      (i) =>
        i.severity === "critical" &&
        (i.finding_type || i.findingType) === "confirmed_violation" &&
        i.evidence_strength !== "strong" &&
        i.evidenceStrength !== "strong",
    ).length,
    unsupportedDimensional: issues.filter(
      (i) =>
        (i.finding_type || i.findingType) === "confirmed_violation" &&
        MEASURABLE_RE.test(`${i.title} ${i.description}`),
    ).length,
    falsePositives: issues.filter((i) => PARKED_RE.test(`${i.title} ${i.description}`)).length,
    duplicates: dupes,
    specRefs: issues.filter((i) => (i.spec_references || i.specReferences || []).length > 0).length,
    ibc: issues.filter((i) => i.codeType === "ibc" || !i.codeType).length,
    local: issues.filter((i) => i.codeType === "local").length,
  };
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const before = await collectBeforeMetrics(sb);

  const projectName = `Riverside V2 Live Acceptance ${new Date().toISOString().slice(0, 10)}`;
  const { data: project, error: projErr } = await sb
    .from("projects")
    .insert({ name: projectName, user_id: USER_ID, status: "draft" })
    .select("id")
    .single();
  if (projErr) throw projErr;
  const projectId = project.id;
  console.log("Created project", projectId, projectName);

  const pdfFiles = readdirSync(RIVERSIDE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();
  const uploadedDocs = [];

  for (const fileName of pdfFiles) {
    const buf = readFileSync(join(RIVERSIDE_DIR, fileName));
    const contentHash = sha256(buf);
    const { filePath } = buildPath(USER_ID, projectId, fileName);
    const { error: upErr } = await sb.storage
      .from("project-documents")
      .upload(filePath, buf, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(`Upload ${fileName}: ${upErr.message}`);

    const { data: doc, error: insErr } = await sb
      .from("project_documents")
      .insert({
        project_id: projectId,
        user_id: USER_ID,
        file_name: fileName,
        file_path: filePath,
        file_size: buf.length,
        file_type: "application/pdf",
        document_type: "specification",
        description: "Riverside V2 live acceptance source PDF",
        content_hash: contentHash,
      })
      .select("id, file_name")
      .single();
    if (insErr) throw insErr;

    const { data: enq, error: enqErr } = await sb.rpc("enqueue_code_analyzer_ingestion_job", {
      p_project_id: projectId,
      p_document_id: doc.id,
      p_user_id: USER_ID,
      p_content_fingerprint: contentHash,
      p_analyzer_class: null,
    });
    if (enqErr) throw enqErr;
    uploadedDocs.push({ ...doc, contentHash, job: enq?.[0]?.job });
    console.log("Uploaded + enqueued", fileName);
  }

  // Wait for ingestion
  const docIds = uploadedDocs.map((d) => d.id);
  let ingestionDone = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const { data: jobs } = await sb
      .from("code_analyzer_ingestion_jobs")
      .select("id, status, document_id, analyzer_class, progress_detail, last_error")
      .eq("project_id", projectId);
    const terminal = new Set(["completed", "partial", "failed", "cancelled"]);
    const allTerminal = (jobs || []).length === docIds.length && (jobs || []).every((j) => terminal.has(j.status));
    const processing = (jobs || []).filter((j) => !terminal.has(j.status)).length;
    console.log(`Ingestion poll ${attempt + 1}: ${(jobs || []).length} jobs, ${processing} in flight`);
    if (allTerminal) {
      ingestionDone = true;
      break;
    }
    await sleep(5000);
  }

  const { data: ingestionJobs } = await sb
    .from("code_analyzer_ingestion_jobs")
    .select("*")
    .eq("project_id", projectId);
  const { data: rootDocs } = await sb
    .from("project_documents")
    .select("id, file_name, document_type, analyzer_class, analyzer_processing_status")
    .eq("project_id", projectId)
    .is("parent_document_id", null);
  const { data: sheets } = await sb
    .from("code_analyzer_sheets")
    .select("id, file_name, excluded, source_document_id, image_document_id")
    .eq("project_id", projectId);
  const includedSheets = (sheets || []).filter((s) => !s.excluded);

  const { count: specSectionCount } = await sb
    .from("code_analyzer_spec_sections")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  const { count: specChunkCount } = await sb
    .from("project_document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("source_class", "specification");

  if (!ingestionDone) {
    console.warn("Ingestion did not finish within timeout");
  }

  const sheetIds = includedSheets.map((s) => s.id);
  const fingerprint = sha256(JSON.stringify({ sheetIds, mode: "dc-both-live" }));

  const { data: runRows, error: runErr } = await sb.rpc("create_code_analyzer_run_async_v2", {
    p_project_id: projectId,
    p_user_id: USER_ID,
    p_analysis_type: "standard_compliance",
    p_jurisdiction: "dc",
    p_project_type: "Commercial",
    p_code_year: "2021",
    p_analysis_mode: "both",
    p_source_fingerprint: fingerprint,
    p_sheet_ids: sheetIds,
    p_analysis_modes: ["ibc", "local"],
    p_form_document_id: null,
    p_analysis_instructions: null,
    p_index_completeness: null,
  });
  if (runErr) throw runErr;
  const run = runRows?.[0]?.run;
  const jobsCreated = runRows?.[0]?.jobs_created;
  console.log("Run created", run?.id, "jobs", jobsCreated);

  let runComplete = false;
  let lastProgress = null;
  for (let attempt = 0; attempt < 360; attempt++) {
    const { data: jobs } = await sb
      .from("code_analyzer_sheet_jobs")
      .select("id, status, analysis_mode, sheet_id, last_error")
      .eq("run_id", run.id);
    const completed = (jobs || []).filter((j) => j.status === "completed").length;
    const failed = (jobs || []).filter((j) => j.status === "failed").length;
    const pending = (jobs || []).length - completed - failed;
    lastProgress = { total: jobs?.length || 0, completed, failed, pending };
    if (attempt % 6 === 0) console.log("Analysis progress", lastProgress);
    if ((jobs || []).length > 0 && pending === 0) {
      runComplete = true;
      break;
    }
    await sleep(10000);
  }

  const { data: runRow } = await sb.from("code_analyzer_runs").select("*").eq("id", run.id).single();

  const { data: anns } = await sb
    .from("document_annotations")
    .select("data, document_id")
    .eq("project_id", projectId)
    .eq("analysis_run_id", run.id);

  const { data: chunkRows } = await sb
    .from("project_document_chunks")
    .select("section_number, section_title, page_start, chunk_text, document_id")
    .eq("project_id", projectId)
    .eq("source_class", "specification")
    .limit(500);

  const issues = [];
  const metaRows = [];
  for (const a of anns || []) {
    if (a.data?.compliance_metadata) metaRows.push(a.data);
    if (a.data?.compliance_issue) issues.push(a.data);
  }

  const specChunksByKey = new Set(
    (chunkRows || []).map(
      (c) =>
        `${String(c.section_number || "").toLowerCase()}|${String(c.section_title || "").toLowerCase()}|${c.page_start || ""}`,
    ),
  );

  const findingDetails = issues.map((i) => {
    const refs = i.spec_references || i.specReferences || [];
    const validRefs = refs.filter((ref) => {
      const sn = String(ref.sectionNumber || ref.section_number || "").toLowerCase();
      return (chunkRows || []).some(
        (c) => String(c.section_number || "").toLowerCase().trim() === sn.trim(),
      );
    });
    return {
      findingType: i.finding_type || i.findingType,
      evidenceStrength: i.evidence_strength || i.evidenceStrength,
      severity: i.severity,
      codeReference: i.codeReference,
      codeType: i.codeType,
      specReferences: refs,
      validSpecReferences: validRefs,
      sheet: i.sheet_file_name || i.location,
      title: i.title,
      page: i.page_number,
    };
  });

  const qualityChecks = {
    dimensionalConfirmedViolations: issues.filter(
      (i) =>
        (i.finding_type || i.findingType) === "confirmed_violation" &&
        MEASURABLE_RE.test(`${i.title} ${i.description}`),
    ).length,
    criticalWithoutStrong: issues.filter(
      (i) =>
        i.severity === "critical" &&
        (i.evidence_strength || i.evidenceStrength) !== "strong",
    ).length,
    parkedVehicleFP: issues.filter((i) => PARKED_RE.test(`${i.title} ${i.description}`)).length,
    missingAsConfirmed: issues.filter(
      (i) =>
        (i.finding_type || i.findingType) === "confirmed_violation" &&
        /\b(not shown|cannot be verified|verification required)\b/i.test(`${i.title} ${i.description}`),
    ).length,
  };

  const semantic = new Set();
  let duplicatePersisted = 0;
  for (const i of issues) {
    const key = `${i.codeType}|${i.category}|${i.codeReference}|${String(i.title || "").toLowerCase().slice(0, 50)}`;
    if (semantic.has(key)) duplicatePersisted++;
    semantic.add(key);
  }

  const sheetsWithFindings = new Set(issues.map((i) => i.sheet_id).filter(Boolean));
  const analyzedSheetIds = new Set();
  for (const m of metaRows) if (m.sheet_id) analyzedSheetIds.add(m.sheet_id);

  const coverage = runRow?.index_completeness?.analysisCoverage || {
    eligibleSheetCount: includedSheets.length,
    sheetsAnalyzed: analyzedSheetIds.size,
    sheetsWithFindings: sheetsWithFindings.size,
    sheetsWithoutFindings: includedSheets
      .filter((s) => analyzedSheetIds.has(s.id) && !sheetsWithFindings.has(s.id))
      .map((s) => s.file_name),
  };

  const specRetrieval = metaRows.map((m) => ({
    sheet: m.sheet_file_name,
    spec_chunks_retrieved: m.spec_chunks_retrieved,
    jurisdictionDiagnostics: m.jurisdictionDiagnostics,
  }));

  const after = summarizeIssues(issues, "after");

  const ingestionReport = (ingestionJobs || []).map((j) => {
    const doc = (rootDocs || []).find((d) => d.id === j.document_id);
    return {
      file: doc?.file_name,
      status: j.status,
      analyzer_class: j.analyzer_class,
      sheets_created: j.progress_detail?.sheets_created,
      error: j.last_error,
    };
  });

  const report = {
    projectId,
    runId: run.id,
    runStatus: runRow?.status,
    runJurisdiction: runRow?.jurisdiction,
    runAnalysisMode: runRow?.analysis_mode,
    ingestionComplete: ingestionDone,
    analysisComplete: runComplete,
    lastProgress,
    uploadedSourceDocuments: pdfFiles.length,
    rootDocuments: rootDocs,
    ingestionReport,
    sheetCount: sheets?.length,
    includedSheetCount: includedSheets.length,
    specSectionCount,
    specChunkCount,
    before,
    after,
    qualityChecks,
    duplicatePersisted,
    findingDetails,
    specRetrieval,
    coverage,
    ibcJobs: (await sb.from("code_analyzer_sheet_jobs").select("status").eq("run_id", run.id).eq("analysis_mode", "ibc")).data,
    localJobs: (await sb.from("code_analyzer_sheet_jobs").select("status").eq("run_id", run.id).eq("analysis_mode", "local")).data,
  };

  const outPath = "/tmp/riverside-live-v2-report.json";
  await import("fs").then((fs) => fs.writeFileSync(outPath, JSON.stringify(report, null, 2)));
  console.log("Wrote", outPath);
  console.log(JSON.stringify({ before: report.before, after: report.after, qualityChecks, coverage, runComplete }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
