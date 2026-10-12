#!/usr/bin/env node
/** Re-index Riverside spec + DC/both analysis rerun on existing V2 live project. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, createWriteStream, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { extractPdfPagesFromFile } = require("../code-analyzer-worker/lib/pdfExtract.js");
const { indexSpecificationDocument } = require("../code-analyzer-worker/lib/specIndex.js");
const OpenAI = require("openai");

const PROJECT_ID = process.env.RIVERSIDE_PROJECT_ID || "a301638e-4c07-46d9-bf54-19bd1715296d";
const USER_ID = "f1f84c83-36f6-4664-b34b-614b2881f09d";
const SPEC_PATH =
  "/Users/javerianaveed/epermit/riverside /24-070 Riverside Condominium Permit Set/SPEC #24-070.pdf";

function loadEnv() {
  const text = readFileSync(new URL("../code-analyzer-worker/.env", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { data: specDoc } = await sb
    .from("project_documents")
    .select("id, file_name, content_hash, user_id")
    .eq("project_id", PROJECT_ID)
    .ilike("file_name", "SPEC #24-070.pdf")
    .single();
  if (!specDoc) throw new Error("Spec document not found on project");

  const pageTexts = {};
  for await (const page of extractPdfPagesFromFile(SPEC_PATH)) {
    pageTexts[page.pageNumber] = page.text;
  }

  const indexResult = await indexSpecificationDocument(sb, openai, {
    projectId: PROJECT_ID,
    documentId: specDoc.id,
    userId: specDoc.user_id || USER_ID,
    fileName: specDoc.file_name,
    contentFingerprint: specDoc.content_hash || "riverside-rerun",
    pageTexts,
  });
  console.log("Spec index", indexResult);

  const { count: chunkCount } = await sb
    .from("project_document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("project_id", PROJECT_ID)
    .eq("source_class", "specification");

  const { data: sheets } = await sb
    .from("code_analyzer_sheets")
    .select("id")
    .eq("project_id", PROJECT_ID)
    .eq("excluded", false);
  const sheetIds = (sheets || []).map((s) => s.id);

  const { createHash } = await import("crypto");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ sheetIds, t: Date.now(), spec: indexResult.chunks }))
    .digest("hex");

  const { data: runRows, error: runErr } = await sb.rpc("create_code_analyzer_run_async_v2", {
    p_project_id: PROJECT_ID,
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
  console.log("Run", run?.id, "jobs", runRows?.[0]?.jobs_created);

  for (let i = 0; i < 360; i++) {
    const { data: jobs } = await sb
      .from("code_analyzer_sheet_jobs")
      .select("status")
      .eq("run_id", run.id);
    const completed = (jobs || []).filter((j) => j.status === "completed").length;
    if (i % 6 === 0) console.log("progress", completed, "/", jobs?.length);
    if (jobs?.length && completed === jobs.length) break;
    await sleep(10000);
  }

  const { data: runRow } = await sb.from("code_analyzer_runs").select("index_completeness,status").eq("id", run.id).single();
  const { data: anns } = await sb
    .from("document_annotations")
    .select("data")
    .eq("project_id", PROJECT_ID)
    .eq("analysis_run_id", run.id);

  const issues = (anns || []).filter((a) => a.data?.compliance_issue).map((a) => a.data);
  const meta = (anns || []).filter((a) => a.data?.compliance_metadata).map((a) => a.data);
  const specRetrieved = meta.map((m) => m.spec_chunks_retrieved).filter((n) => n > 0);
  const withRefs = issues.filter((i) => (i.spec_references || i.specReferences || []).length > 0);

  const { data: chunks } = await sb.from("project_document_chunks").select("section_number, section_title, chunk_text").eq("project_id", PROJECT_ID).eq("source_class", "specification").limit(3);

  console.log(JSON.stringify({
    runId: run.id,
    runStatus: runRow?.status,
    coverage: runRow?.index_completeness?.analysisCoverage,
    specSections: indexResult.sections,
    specChunksIndexed: chunkCount,
    specRetrievedCounts: specRetrieved,
    maxSpecRetrieved: Math.max(0, ...specRetrieved, ...meta.map((m) => m.spec_chunks_retrieved || 0)),
    findings: issues.length,
    findingsWithSpecRefs: withRefs.length,
    ibc: issues.filter((i) => i.codeType === "ibc").length,
    local: issues.filter((i) => i.codeType === "local").length,
    sampleChunks: chunks,
    sampleRefs: withRefs.slice(0, 3),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
