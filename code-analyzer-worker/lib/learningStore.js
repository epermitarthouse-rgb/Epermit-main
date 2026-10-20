"use strict";

const VERSIONS = "code_analyzer_learning_versions";
const GUIDANCE = "code_analyzer_learning_guidance";
const APPLICATIONS = "code_analyzer_learning_applications";

function missingTable(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "PGRST205" || code === "42P01" || /schema cache|does not exist|could not find the table/i.test(message);
}

/**
 * Promoted guidance for one project. Pending and rejected feedback is not returned.
 * A missing table leaves analysis on the current verifier path.
 */
async function loadActiveLearningGuidance(supabase, projectId) {
  if (!projectId) return [];
  const { parseStoredGuidance } = await import("../../src/lib/codeAnalyzer/learningLoopCore.mjs");
  const versions = await supabase
    .from(VERSIONS)
    .select("id")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .eq("status", "promoted")
    .limit(1);
  if (versions.error) {
    if (missingTable(versions.error)) return [];
    console.warn("[code-analyzer-worker] learning version lookup failed:", versions.error.message);
    return [];
  }
  const versionId = versions.data?.[0]?.id;
  if (!versionId) return [];
  const rows = await supabase
    .from(GUIDANCE)
    .select("id, project_id, tenant_id, feedback_id, version_id, status, scope, authority, conditions, effect, provenance")
    .eq("project_id", projectId)
    .eq("version_id", versionId)
    .eq("status", "promoted");
  if (rows.error) {
    if (missingTable(rows.error)) return [];
    console.warn("[code-analyzer-worker] learning guidance lookup failed:", rows.error.message);
    return [];
  }
  return (rows.data || []).map((row) => parseStoredGuidance(row, projectId)).filter(Boolean);
}

async function recordLearningApplications(supabase, projectId, runId, sheetId, applications) {
  const reused = new Set(["relabeled", "rebound", "unbound", "reordered", "withheld_false_positive", "open_check_added"]);
  const rows = (applications || [])
    .filter((item) => item?.guidance_id && reused.has(item.action))
    .map((item) => ({
      project_id: projectId,
      run_id: runId || null,
      sheet_id: sheetId || null,
      guidance_id: item.guidance_id,
      version_id: item.version_id || null,
      action: item.action,
      detail: {
        count: item.count || null,
        section: item.section || null,
        question_id: item.question_id || null,
        accuracyClaim: false,
      },
    }));
  if (!rows.length) return;
  const { error } = await supabase.from(APPLICATIONS).insert(rows);
  if (error && !missingTable(error)) {
    console.warn("[code-analyzer-worker] learning application log failed:", error.message);
  }
}

module.exports = {
  loadActiveLearningGuidance,
  recordLearningApplications,
};
