#!/usr/bin/env node
import fs from "fs";
import path from "path";

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

loadEnv(path.join(process.cwd(), "scraper-service/.env"));
const base = `${process.env.SUPABASE_URL}/rest/v1`;
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  Accept: "application/json",
};

async function q(table, query) {
  const res = await fetch(`${base}/${table}?${query}`, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`${table} ${res.status}: ${body}`);
  return JSON.parse(body);
}

const projectId = process.argv[2];
const [runs, reviews] = await Promise.all([
  q(
    "code_analyzer_runs",
    `project_id=eq.${projectId}&select=id,analysis_type,status,form_document_id,created_at&order=created_at.desc`,
  ),
  q(
    "code_modification_reviews",
    `project_id=eq.${projectId}&select=id,run_id,extracted_request,extraction_warnings,created_at&order=created_at.desc&limit=3`,
  ),
]);
console.log(JSON.stringify({ projectId, currentRuns: runs.filter((r) => r.status === "current"), latestReview: reviews[0] }, null, 2));
