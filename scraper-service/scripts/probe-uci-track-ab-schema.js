"use strict";

const fs = require("fs");
const path = require("path");

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const root = path.resolve(__dirname, "../..");
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, "scraper-service/.env")),
};

const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  process.stdout.write(
    JSON.stringify({ ok: false, reason: "missing_supabase_url_or_service_role" }) + "\n",
  );
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
};

async function probe(table, select) {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`;
  const res = await fetch(endpoint, { headers });
  const text = await res.text();
  let message = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.message) message = parsed.message;
    else if (parsed && parsed.code) message = `${parsed.code}: ${parsed.hint || parsed.details || ""}`.trim();
  } catch {
    message = text.slice(0, 240);
  }
  return {
    table,
    status: res.status,
    ok: res.ok,
    error: res.ok ? null : message,
  };
}

async function rows(table, select, extra = "") {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}`;
  const res = await fetch(endpoint, { headers });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 240);
  }
  return { status: res.status, ok: res.ok, data };
}

(async () => {
  const checks = await Promise.all([
    probe(
      "coordination_records",
      "id,utility_provider_id,current_stage_entered_at,prediction_baseline_source,prediction_sample_size,prediction_reason,predicted_p50_date,predicted_p90_date,inspection_release_received_at,meter_set_scheduled_at,site_readiness_confirmed_at,site_contact_name,closeout_package_doc_id,energization_date_conflict",
    ),
    probe(
      "coordination_applications",
      "id,load_summary,graph_message_id,graph_internet_message_id,email_bounced_at,draft_status",
    ),
    probe(
      "coordination_costs",
      "id,client_approval_status,billing_hold,qb_sync_status,actual_source,estimated_source,cost_type",
    ),
    probe(
      "coordination_equipment",
      "id,check_in_method,last_response_at,last_weeks_of_slip,next_check_in_at,current_eta,status",
    ),
    probe("coordination_milestones", "id,milestone_type,status,target_date,actual_date,parent_stage"),
    probe("projects", "id,utility_coordination_completed_at"),
    probe("utility_stage_duration_baselines", "id,source,p50_business_days,from_stage,utility_type,ownership_type"),
    probe("submission_transmission_attempts", "id,graph_message_id,status,idempotency_key"),
    probe(
      "coordination_cos_design_records",
      "id,source_text_excerpt,parse_meta,document_refs,extracted_fields,review_status,agent_metadata",
    ),
  ]);

  const nullProviders = await rows(
    "coordination_records",
    "id,project_id,utility_type,current_stage,current_stage_state,utility_provider_id",
    "&utility_provider_id=is.null&limit=5",
  );
  const allKeys = await rows(
    "coordination_records",
    "project_id,utility_type,scope_description",
    "&limit=1000",
  );
  const duplicates = [];
  if (Array.isArray(allKeys.data)) {
    const seen = new Map();
    for (const row of allKeys.data) {
      const key = `${row.project_id}|${row.utility_type}|${row.scope_description ?? ""}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, count] of seen.entries()) {
      if (count > 1) duplicates.push({ key, count });
    }
  }
  const baselines = await rows("utility_stage_duration_baselines", "source", "&limit=20");
  const sources = Array.isArray(baselines.data)
    ? [...new Set(baselines.data.map((r) => r.source))]
    : [];
  const p50 = await rows(
    "coordination_records",
    "id,predicted_p50_date,predicted_p90_date,prediction_baseline_source",
    "&predicted_p50_date=not.is.null&limit=3",
  );

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        host: new URL(url).host,
        checks,
        null_provider_sample_count: Array.isArray(nullProviders.data) ? nullProviders.data.length : null,
        null_provider_ok: nullProviders.ok,
        duplicate_type_scope_keys: duplicates,
        baseline_sources_seen: sources,
        predicted_dates_sample_ok: p50.ok,
        predicted_dates_sample_count: Array.isArray(p50.data) ? p50.data.length : 0,
      },
      null,
      2,
    ) + "\n",
  );
})().catch((err) => {
  process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
  process.exit(1);
});
