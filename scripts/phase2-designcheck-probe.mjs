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

const projectId = process.argv[2];
const standardRunId = process.argv[3];
const res = await fetch(
  `${base}/document_annotations?project_id=eq.${projectId}&select=id,analysis_run_id,data&limit=20`,
  { headers },
);
const rows = await res.json();
const standard = rows.filter((r) => r.analysis_run_id === standardRunId);
const mod = rows.filter((r) => r.analysis_run_id && r.analysis_run_id !== standardRunId);
console.log(
  JSON.stringify(
    {
      total: rows.length,
      standardRunAnnotations: standard.length,
      otherRunAnnotations: mod.length,
      standardRunId,
    },
    null,
    2,
  ),
);
