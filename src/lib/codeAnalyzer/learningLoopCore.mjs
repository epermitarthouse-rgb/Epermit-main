"use strict";

/**
 * Controlled learning for Code Analyzer V2.
 *
 * Approved corrections become project-scoped interpretation and retrieval
 * guidance. They are not code requirements. Pending feedback, model output,
 * and previously generated findings are never authoritative.
 *
 * The independent verifier still decides whether a measurement is proven and
 * whether a code excerpt is authoritative. This module cannot create a
 * threshold, waive an exception, or mark a check verified.
 */

export const CATEGORIES = [
  ["extraction_element", "Wrong element"],
  ["extraction_dimension", "Wrong dimension"],
  ["extraction_calculation", "Wrong calculation"],
  ["extraction_label", "Wrong drawing label"],
  ["dimension_association", "Wrong dimension association"],
  ["missed_evidence", "Missed drawing evidence"],
  ["code_retrieval", "Wrong code section retrieved"],
  ["jurisdiction_mapping", "Wrong jurisdiction mapping"],
  ["false_positive", "False positive finding"],
  ["false_negative", "Missed finding"],
  ["applicability", "Wrong applicability"],
  ["exception_handling", "Wrong exception handling"],
  ["confirmed_finding", "Reviewer confirmed a finding"],
];

const EFFECT_KINDS = new Set([
  "relabel_element",
  "bind_dimension",
  "unbind_dimension",
  "prefer_section",
  "suppress_false_positive",
  "flag_missed_evidence",
  "interpretation_note",
]);

const FORBIDDEN_EFFECT_KEYS = [
  "threshold",
  "minimum",
  "maximum",
  "code_text",
  "requirement",
  "adopted_value",
  "exception_override",
  "verifier_bypass",
  "authoritative",
  "shall",
];

const CODE_RULE_NOTE = /\b(?:code|ibc|ifc|ipc|imc|nfpa)\b[^.\n]{0,80}\b(?:shall|must|minimum|maximum)\b/i;
export const METRICS = ["extraction", "association", "retrieval", "false_positive", "false_negative", "reuse"];

function clone(value) {
  if (value == null) return value;
  return structuredClone(value);
}

function clean(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function signatureOf(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function sameToken(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a) && a === b;
}

function labelHits(text, pattern) {
  const needle = String(pattern || "").trim().toLowerCase();
  if (needle.length < 3) return false;
  return String(text || "").toLowerCase().includes(needle);
}

function jurisdictionCompatible(condition, actual) {
  if (!condition) return true;
  const compact = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const left = compact(condition);
  const right = compact(actual);
  if (!right) return false;
  if (left === right) return true;
  const dc = (value) =>
    value === "dc" || value === "washingtondc" || value === "districtofcolumbia" || value === "12adcmr";
  return dc(left) && dc(right);
}

function editionCompatible(condition, actual) {
  if (!condition) return true;
  const year = (value) => String(value || "").match(/(?:19|20)\d{2}/)?.[0] || String(value || "").trim().toLowerCase();
  const left = year(condition);
  const right = year(actual);
  if (!right) return false;
  return left === right;
}

export function effectKindForCategory(category) {
  switch (category) {
    case "extraction_element":
    case "extraction_label":
      return "relabel_element";
    case "dimension_association":
    case "extraction_dimension":
    case "extraction_calculation":
      return "bind_dimension";
    case "code_retrieval":
    case "jurisdiction_mapping":
      return "prefer_section";
    case "false_positive":
      return "suppress_false_positive";
    case "false_negative":
    case "missed_evidence":
      return "flag_missed_evidence";
    default:
      return "interpretation_note";
  }
}

export function metricForEffect(kind) {
  switch (kind) {
    case "relabel_element":
      return "extraction";
    case "bind_dimension":
    case "unbind_dimension":
      return "association";
    case "prefer_section":
      return "retrieval";
    case "suppress_false_positive":
      return "false_positive";
    case "flag_missed_evidence":
      return "false_negative";
    default:
      return "reuse";
  }
}

function forbiddenKey(effect) {
  if (!effect || typeof effect !== "object") return null;
  const keys = Object.keys(effect).map((key) => key.toLowerCase());
  return FORBIDDEN_EFFECT_KEYS.find((key) => keys.includes(key)) || null;
}

export function guidanceErrors(guidance) {
  const errors = [];
  if (!guidance?.project_id) errors.push("A correction must stay inside one project.");
  if (guidance.authority && guidance.authority !== "human_reviewed_interpretation") {
    errors.push("Learning cannot be stored as a code requirement.");
  }
  const scope = guidance.scope;
  if (scope !== "sheet" && scope !== "project_pattern") errors.push("Scope must be this sheet or a project pattern.");
  const conditions = guidance.conditions || {};
  const effect = guidance.effect || {};
  const blocked = forbiddenKey(effect);
  if (blocked) errors.push(`Learning cannot set ${blocked}.`);
  if (!EFFECT_KINDS.has(effect.kind)) errors.push("Unknown learning effect.");
  if (CODE_RULE_NOTE.test(effect.note || "")) {
    errors.push("The note states a code obligation. Record a drawing interpretation instead.");
  }
  const label = clean(conditions.label_pattern, 80);
  const sheetNumber = clean(conditions.sheet_number, 160);
  const sheetId = clean(conditions.sheet_id, 80);
  const issueSignature = signatureOf(effect.issue_signature);
  const section = clean(effect.section_locator || conditions.section_locator, 40);
  if (scope === "sheet" && !sheetNumber && !sheetId) {
    errors.push("A sheet correction needs the sheet name or sheet id.");
  }
  if (effect.kind === "relabel_element") {
    if (!/^[a-z][a-z0-9_]{1,60}$/.test(String(effect.element_type || ""))) {
      errors.push("The corrected element type must be a short classification label.");
    }
    if (!label || label.length < 3) errors.push("Relabeling needs the printed label that was misread.");
  }
  if (effect.kind === "bind_dimension" || effect.kind === "unbind_dimension") {
    if (!label || label.length < 3) errors.push("Association corrections need the printed dimension or label.");
    if (effect.kind === "bind_dimension" && !["element", "calculation"].includes(effect.bind_to)) {
      errors.push("Say whether the dimension binds to an element or a calculation.");
    }
  }
  if (effect.kind === "prefer_section") {
    if (!section || section.length < 2) errors.push("Name the code section locator that should be preferred.");
  }
  if (effect.kind === "suppress_false_positive" && issueSignature.length < (scope === "project_pattern" ? 12 : 8)) {
    errors.push("A false positive needs the finding title it applies to.");
  }
  if ((effect.kind === "flag_missed_evidence" || effect.kind === "interpretation_note") && clean(effect.note, 500)?.length < 8) {
    errors.push("Write a short correction the next review can read.");
  }
  if (scope === "project_pattern") {
    const narrow = (label && label.length >= 3) || (section && section.length >= 2) || issueSignature.length >= 12;
    if (!narrow) errors.push("A project pattern needs a label, section locator, or finding title. It cannot apply to every sheet.");
  }
  return errors;
}

function emptyConditions(extra) {
  return {
    sheet_number: null,
    sheet_id: null,
    discipline: null,
    element_type: null,
    label_pattern: null,
    code_edition: null,
    jurisdiction: null,
    section_locator: null,
    fact_kind: null,
    ...(extra || {}),
  };
}

function normalizeGuidance(input) {
  const effect = input?.effect || {};
  const conditions = input?.conditions || {};
  const section = clean(effect.section_locator || conditions.section_locator, 40);
  return {
    id: input.id || null,
    project_id: input.project_id || null,
    tenant_id: input.tenant_id || null,
    feedback_id: input.feedback_id || null,
    version_id: input.version_id || null,
    status: input.status || "validated",
    scope: input.scope === "project_pattern" ? "project_pattern" : "sheet",
    authority: "human_reviewed_interpretation",
    conditions: emptyConditions({
      sheet_number: clean(conditions.sheet_number, 160),
      sheet_id: clean(conditions.sheet_id, 80),
      discipline: clean(conditions.discipline, 40),
      element_type: clean(conditions.element_type, 60),
      label_pattern: clean(conditions.label_pattern, 80),
      code_edition: clean(conditions.code_edition, 40),
      jurisdiction: clean(conditions.jurisdiction, 80),
      section_locator: section,
      fact_kind: clean(conditions.fact_kind, 40),
    }),
    effect: {
      kind: effect.kind,
      element_type: clean(effect.element_type, 60),
      bind_to: effect.bind_to === "calculation" ? "calculation" : effect.bind_to === "element" ? "element" : null,
      section_locator: section,
      note: clean(effect.note, 500),
      issue_signature: signatureOf(effect.issue_signature) || null,
    },
    provenance: input.provenance || null,
  };
}

export function buildGuidanceFromFeedback(feedback) {
  if (!feedback || feedback.status !== "approved") {
    return { ok: false, errors: ["Only an approved correction can become learning."] };
  }
  if (feedback.approval_basis !== "human_approval" && feedback.approval_basis !== "trusted_ground_truth") {
    return { ok: false, errors: ["Approval was not recorded as human or trusted ground truth."] };
  }
  if (feedback.source_kind === "ai_suggestion" && feedback.approval_basis !== "human_approval") {
    return { ok: false, errors: ["An AI suggestion stays untrusted until a person approves it."] };
  }
  const proposed = feedback.proposed_correction || {};
  const guidance = normalizeGuidance({
    id: feedback.guidance_id || `guidance-${feedback.id}`,
    project_id: feedback.project_id,
    tenant_id: feedback.tenant_id || null,
    feedback_id: feedback.id,
    status: "validated",
    scope: proposed.scope,
    conditions: proposed.conditions,
    effect: {
      ...(proposed.effect || {}),
      kind: proposed.effect?.kind || effectKindForCategory(feedback.category),
    },
    provenance: {
      feedback_id: feedback.id,
      approved_by: feedback.approved_by || null,
      approved_at: feedback.approved_at || null,
      source_kind: feedback.source_kind || null,
      approval_basis: feedback.approval_basis || null,
    },
  });
  const errors = guidanceErrors(guidance);
  if (errors.length) return { ok: false, errors };
  return { ok: true, guidance, errors: [] };
}

export function parseStoredGuidance(row, projectId) {
  if (!row || row.status !== "promoted" || row.authority !== "human_reviewed_interpretation") return null;
  if (projectId && row.project_id !== projectId) return null;
  const guidance = normalizeGuidance(row);
  if (guidanceErrors(guidance).length) return null;
  return guidance;
}

function sheetMatches(conditions, context) {
  if (conditions.sheet_id && context.sheetId && conditions.sheet_id === context.sheetId) return true;
  return sameToken(conditions.sheet_number, context.sheetNumber) || sameToken(conditions.sheet_number, context.fileName);
}

export function matchGuidance(guidance, context) {
  const projectId = context?.projectId || null;
  return (guidance || []).filter((item) => {
    if (!item || item.authority !== "human_reviewed_interpretation") return false;
    if (!projectId || item.project_id !== projectId) return false;
    if (item.tenant_id && context.tenantId && item.tenant_id !== context.tenantId) return false;
    if (item.status && !["promoted", "validated"].includes(item.status)) return false;
    const conditions = item.conditions || {};
    if (item.scope === "sheet" && !sheetMatches(conditions, context || {})) return false;
    if (conditions.discipline && !sameToken(conditions.discipline, context.discipline)) return false;
    if (!jurisdictionCompatible(conditions.jurisdiction, context.jurisdiction)) return false;
    if (!editionCompatible(conditions.code_edition, context.codeYear || context.codeEdition)) return false;
    return guidanceErrors(item).length === 0;
  });
}

function elementText(element) {
  return [element?.source_label, element?.tag, element?.text, element?.type].filter(Boolean).join(" ");
}

export function applyExtractionLearning(document, guidance, context) {
  const matched = matchGuidance(guidance, context).filter((item) =>
    ["relabel_element", "bind_dimension", "unbind_dimension"].includes(item.effect.kind),
  );
  if (!document || !matched.length) return { document, applications: [] };
  const next = clone(document);
  const applications = [];
  for (const item of matched) {
    const pattern = item.conditions.label_pattern;
    if (item.effect.kind === "relabel_element") {
      let changed = 0;
      for (const element of next.elements || []) {
        const priorType = item.conditions.element_type;
        if (priorType && element.type !== priorType && element.type !== item.effect.element_type) continue;
        if (!labelHits(elementText(element), pattern)) continue;
        if (element.type === item.effect.element_type) continue;
        const before = element.type;
        element.type = item.effect.element_type;
        element.properties = {
          ...(element.properties || {}),
          learning: {
            guidance_id: item.id,
            before_type: before,
            authority: "human_reviewed_interpretation",
            verified: false,
          },
        };
        changed += 1;
      }
      applications.push({ guidance_id: item.id, version_id: item.version_id || null, action: changed ? "relabeled" : "no_matching_element", count: changed });
    }
    if (item.effect.kind === "bind_dimension" || item.effect.kind === "unbind_dimension") {
      let changed = 0;
      for (const dimension of next.dimensions || []) {
        const haystack = [dimension.context_text, dimension.original_content, dimension.value_text].filter(Boolean).join(" ");
        if (!labelHits(haystack, pattern)) continue;
        const before = {
          binding_status: dimension.binding_status,
          association_status: dimension.association_status,
          related_element_ids: [...(dimension.related_element_ids || [])],
          related_calculation_ids: [...(dimension.related_calculation_ids || [])],
          value_numeric: dimension.value_numeric,
        };
        if (item.effect.kind === "unbind_dimension") {
          dimension.binding_status = "unbound";
          dimension.association_status = "none";
          dimension.related_element_ids = [];
          dimension.related_calculation_ids = [];
        } else if (item.effect.bind_to === "calculation") {
          const calculation = (next.calculations || []).find((entry) => labelHits(JSON.stringify(entry), pattern));
          dimension.binding_status = "reviewer_bound";
          dimension.association_status = "reviewer_bound";
          dimension.related_element_ids = [];
          dimension.related_calculation_ids = calculation ? [calculation.id] : dimension.related_calculation_ids || [];
        } else {
          const targetType = item.effect.element_type || item.conditions.element_type;
          const priorType = item.conditions.element_type;
          const element = (next.elements || []).find((entry) => {
            if (!labelHits(elementText(entry), pattern)) return false;
            if (!targetType) return true;
            return entry.type === targetType || entry.type === priorType;
          });
          dimension.binding_status = "reviewer_bound";
          dimension.association_status = "reviewer_bound";
          dimension.related_element_ids = element ? [element.id] : [];
        }
        dimension.value_numeric = before.value_numeric;
        dimension.association_basis = {
          method: "human_reviewed_interpretation",
          guidance_id: item.id,
          verified: false,
          before,
        };
        changed += 1;
      }
      applications.push({
        guidance_id: item.id,
        version_id: item.version_id || null,
        action: changed ? (item.effect.kind === "unbind_dimension" ? "unbound" : "rebound") : "no_matching_dimension",
        count: changed,
      });
    }
  }
  if (!applications.some((item) => item.count > 0)) return { document, applications };
  next.learning_overlay = applications;
  return { document: next, applications };
}

function sectionLabel(hit) {
  return String(hit?.section || hit?.sectionNumber || hit?.id || "");
}

function moveLocatorForward(hits, locator) {
  const list = Array.isArray(hits) ? [...hits] : [];
  const needle = String(locator || "").trim().toLowerCase();
  if (!needle) return { hits: list, action: "missing_locator" };
  const index = list.findIndex((hit) => sectionLabel(hit).toLowerCase().includes(needle));
  if (index < 0) return { hits: list, action: "not_in_corpus" };
  if (index === 0) return { hits: list, action: "already_first" };
  const [hit] = list.splice(index, 1);
  list.unshift(hit);
  return { hits: list, action: "reordered" };
}

export function applyRetrievalLearning(retrieval, guidance, context) {
  const matched = matchGuidance(guidance, context).filter((item) => item.effect.kind === "prefer_section");
  if (!retrieval || !matched.length) return { retrieval, applications: [] };
  const applications = [];
  const packages = (retrieval.packages || []).map((pack) => {
    let code = pack.code || [];
    let codeContext = pack.codeContext || [];
    for (const item of matched) {
      const locator = item.effect.section_locator;
      const authoritative = moveLocatorForward(code, locator);
      code = authoritative.hits;
      let action = authoritative.action;
      if (action === "not_in_corpus") {
        const contextMove = moveLocatorForward(codeContext, locator);
        codeContext = contextMove.hits;
        action = contextMove.action === "not_in_corpus" ? "not_in_corpus" : "context_only_not_authoritative";
      }
      applications.push({ guidance_id: item.id, version_id: item.version_id || null, action, section: locator, question_id: pack.questionId || null });
    }
    return { ...pack, code, codeContext };
  });
  return { retrieval: { ...retrieval, packages }, applications };
}

function issueText(issue) {
  return [issue?.title, issue?.description, issue?.codeReference, issue?.location].filter(Boolean).join(" ");
}

function findingMatches(item, issue) {
  const expected = signatureOf(item.effect.issue_signature);
  const actual = signatureOf(issue?.title);
  if (!expected || !actual) return false;
  if (item.scope === "project_pattern" && expected.length < 12) return false;
  if (!(actual === expected || actual.includes(expected))) return false;
  const section = item.effect.section_locator || item.conditions.section_locator;
  if (section && !String(issue.codeReference || "").toLowerCase().includes(String(section).toLowerCase())) return false;
  return true;
}

function recountPublished(summary, issues) {
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    ...(summary || {}),
    totalIssues: issues.length,
    critical,
    warnings,
    advisory: Math.max(0, issues.length - critical - warnings),
    learning: {
      accuracyClaim: false,
      verifierOverallScore: summary?.overallScore ?? null,
      verifierIssueCount: summary?.totalIssues ?? issues.length,
    },
  };
}

function applyFindingBundle(bundle, guidance, context) {
  const matched = matchGuidance(guidance, context).filter((item) =>
    item.effect.kind === "suppress_false_positive" || item.effect.kind === "flag_missed_evidence",
  );
  if (!bundle || !matched.length) return { bundle, applications: [] };
  const next = clone(bundle);
  const applications = [];
  const rejected = [...(next.rejectedCandidates || [])];
  let issues = [...(next.issues || [])];
  for (const item of matched) {
    if (item.effect.kind === "suppress_false_positive") {
      const kept = [];
      let withheld = 0;
      for (const issue of issues) {
        if (!findingMatches(item, issue)) {
          kept.push(issue);
          continue;
        }
        withheld += 1;
        rejected.push({
          ...issue,
          learningDisposition: "withheld_false_positive",
          learningGuidanceId: item.id,
          learningAuthority: "human_reviewed_interpretation",
          published: false,
        });
      }
      issues = kept;
      applications.push({ guidance_id: item.id, version_id: item.version_id || null, action: withheld ? "withheld_false_positive" : "no_matching_finding", count: withheld });
    } else {
      const id = `learning-open-${item.id}`;
      if (!issues.some((issue) => issue.id === id)) {
        issues.push({
          id,
          title: item.effect.note || "Reviewer-flagged possible miss",
          description:
            "A reviewer flagged a possible miss. This stays unverified until authoritative code text and drawing evidence both support a decision. The note is not a code requirement and does not waive an exception.",
          severity: "advisory",
          category: "Learning",
          codeReference: item.effect.section_locator || "unverified",
          codeYear: context.codeYear || "",
          location: context.fileName || context.sheetNumber || "",
          suggestedFix: "Check the cited drawing evidence before treating this as a deficiency.",
          findingType: "verification_question",
          verified: false,
          validationDisposition: "open_check",
          learningAuthority: "human_reviewed_interpretation",
          learningGuidanceId: item.id,
          userVisible: true,
        });
        applications.push({ guidance_id: item.id, version_id: item.version_id || null, action: "open_check_added", count: 1 });
      }
    }
  }
  for (const issue of issues) {
    if (issue.learningGuidanceId && issue.findingType === "confirmed_violation") {
      issue.findingType = "verification_question";
      issue.verified = false;
    }
    if (issue.learningGuidanceId) issue.verified = false;
  }
  next.issues = issues;
  next.rejectedCandidates = rejected;
  next.summary = recountPublished(next.summary, issues);
  return { bundle: next, applications };
}

export function applyFindingLearning(result, guidance, context) {
  if (!result || typeof result !== "object") return { result, applications: [] };
  if (result.ibc || result.local) {
    const applications = [];
    const next = { ...result };
    if (result.ibc) {
      const applied = applyFindingBundle(result.ibc, guidance, context);
      next.ibc = applied.bundle;
      applications.push(...applied.applications);
    }
    if (result.local) {
      const applied = applyFindingBundle(result.local, guidance, context);
      next.local = applied.bundle;
      applications.push(...applied.applications);
    }
    if (!applications.length) return { result, applications };
    next.learning = { accuracyClaim: false, applications };
    return { result: next, applications };
  }
  const applied = applyFindingBundle(result, guidance, context);
  if (!applied.applications.length) return { result, applications: [] };
  return {
    result: { ...applied.bundle, learning: { accuracyClaim: false, applications: applied.applications } },
    applications: applied.applications,
  };
}

export function formatLearningPrompt(guidance, context, extractionApplications, retrievalApplications) {
  const notes = matchGuidance(guidance, context).filter((item) =>
    item.effect.kind === "interpretation_note" || item.effect.note,
  );
  const lines = [];
  for (const item of notes) {
    if (!item.effect.note) continue;
    lines.push(`- ${item.effect.note}`);
  }
  for (const item of extractionApplications || []) {
    if (!item.count) continue;
    lines.push(`- Applied ${item.action} from correction ${item.guidance_id}.`);
  }
  const seenRetrieval = new Set();
  for (const item of retrievalApplications || []) {
    const key = `${item.action}:${item.section}`;
    if (seenRetrieval.has(key)) continue;
    seenRetrieval.add(key);
    if (item.action === "reordered") lines.push(`- Prefer the already-retrieved section ${item.section}. No code text was added.`);
    if (item.action === "not_in_corpus") {
      lines.push(`- Section ${item.section} was requested by a reviewer and was not in the authoritative excerpts, so it was not added.`);
    }
  }
  if (!lines.length) return "";
  return [
    "HUMAN-REVIEWED DRAWING INTERPRETATION for this project only.",
    "This is not a code requirement, does not change an adopted threshold, does not waive an exception, and does not verify compliance.",
    ...lines,
  ].join("\n").slice(0, 900);
}

export function transitionFeedback(record, action, actor) {
  const current = record || {};
  const next = { ...current };
  const userId = actor?.userId || null;
  if (action === "start_review") {
    if (current.status !== "pending") return { ok: false, error: "Only pending feedback can move into evidence review." };
    if (!userId) return { ok: false, error: "A reviewer identity is required." };
    next.status = "evidence_review";
    next.evidence_reviewed_by = userId;
    next.evidence_reviewed_at = actor.at || new Date().toISOString();
    return { ok: true, record: next };
  }
  if (action === "approve") {
    if (current.status !== "evidence_review") return { ok: false, error: "Evidence review is required before approval." };
    if (!userId) return { ok: false, error: "A reviewer identity is required." };
    if (actor.attestation !== true) return { ok: false, error: "Approval requires attestation that the original evidence was reviewed." };
    if (actor.approvalBasis !== "human_approval" && actor.approvalBasis !== "trusted_ground_truth") {
      return { ok: false, error: "Approval must be a human decision or an explicit trusted ground-truth source." };
    }
    if (current.source_kind === "ai_suggestion" && actor.approvalBasis !== "human_approval") {
      return { ok: false, error: "An AI suggestion cannot become learning without human approval." };
    }
    if (!["human_reviewer", "ai_suggestion", "trusted_ground_truth"].includes(current.source_kind)) {
      return { ok: false, error: "This source cannot become learning." };
    }
    next.status = "approved";
    next.approved_by = userId;
    next.approved_at = actor.at || new Date().toISOString();
    next.approval_basis = actor.approvalBasis;
    return { ok: true, record: next };
  }
  if (action === "reject") {
    if (!["pending", "evidence_review"].includes(current.status)) return { ok: false, error: "This feedback can no longer be rejected." };
    if (!userId) return { ok: false, error: "A reviewer identity is required." };
    next.status = "rejected";
    next.rejected_by = userId;
    next.rejected_at = actor.at || new Date().toISOString();
    next.rejection_reason = clean(actor.reason, 500);
    return { ok: true, record: next };
  }
  if (action === "supersede") {
    if (current.status !== "approved") return { ok: false, error: "Only an approved correction can be superseded." };
    next.status = "superseded";
    next.superseded_by = actor.supersededBy || null;
    return { ok: true, record: next };
  }
  return { ok: false, error: "Unknown learning action." };
}

function snapshotDocument(feedback) {
  const original = feedback.original_output || {};
  if (original.elements || original.dimensions || original.calculations) return original;
  return { elements: [], dimensions: [], calculations: [] };
}

function snapshotFindings(feedback) {
  const original = feedback.original_output || {};
  if (Array.isArray(original.issues)) return original;
  if (original.issue) return { issues: [original.issue], rejectedCandidates: [], summary: { totalIssues: 1, overallScore: null } };
  return { issues: [], rejectedCandidates: [], summary: {} };
}

function examplePasses(example, guidance) {
  const applicable = (guidance || []).filter((item) => item.project_id === example.context.projectId);
  if (example.metric === "extraction") {
    const applied = applyExtractionLearning(example.before, applicable, example.context);
    return (applied.document?.elements || []).some((element) =>
      labelHits(elementText(element), example.expected.label_pattern) && element.type === example.expected.element_type,
    );
  }
  if (example.metric === "association") {
    const applied = applyExtractionLearning(example.before, applicable, example.context);
    const dimension = (applied.document?.dimensions || []).find((item) =>
      labelHits([item.context_text, item.original_content].join(" "), example.expected.label_pattern),
    );
    if (!dimension) return false;
    if (example.expected.unbound) return dimension.binding_status === "unbound";
    if (example.expected.bind_to === "calculation") return (dimension.related_calculation_ids || []).length > 0;
    return (dimension.related_element_ids || []).length > 0 && dimension.association_status === "reviewer_bound";
  }
  if (example.metric === "retrieval") {
    const applied = applyRetrievalLearning(example.before, applicable, example.context);
    const locator = String(example.expected.section_locator || "").toLowerCase();
    const packages = applied.retrieval?.packages || [];
    return packages.some((pack) => sectionLabel(pack.code?.[0]).toLowerCase().includes(locator));
  }
  if (example.metric === "false_positive") {
    const applied = applyFindingLearning(example.before, applicable, example.context);
    const issues = applied.result?.issues || [];
    return !issues.some((issue) => signatureOf(issue.title) === signatureOf(example.expected.issue_signature));
  }
  if (example.metric === "false_negative") {
    const applied = applyFindingLearning(example.before, applicable, example.context);
    const issues = applied.result?.issues || [];
    return issues.some((issue) =>
      issue.learningGuidanceId
      && issue.findingType === "verification_question"
      && issue.verified === false
      && (!example.expected.guidance_id || issue.learningGuidanceId === example.expected.guidance_id),
    );
  }
  const notes = formatLearningPrompt(applicable, example.context, [], []);
  return notes.includes(String(example.expected.note || "").slice(0, 40));
}

export function exampleFromFeedback(feedback, guidance) {
  const proposed = feedback.proposed_correction || {};
  const effect = proposed.effect || {};
  const conditions = proposed.conditions || {};
  const metric = metricForEffect(effect.kind);
  const before = metric === "false_positive" || metric === "false_negative"
    ? snapshotFindings(feedback)
    : metric === "retrieval"
      ? (feedback.original_output?.packages ? { packages: feedback.original_output.packages } : feedback.original_output)
      : snapshotDocument(feedback);
  return {
    id: feedback.id,
    metric,
    context: {
      projectId: feedback.project_id,
      tenantId: feedback.tenant_id || null,
      sheetId: conditions.sheet_id || feedback.sheet_id || null,
      sheetNumber: conditions.sheet_number || null,
      fileName: conditions.sheet_number || null,
      discipline: conditions.discipline || null,
      jurisdiction: conditions.jurisdiction || feedback.jurisdiction || null,
      codeYear: conditions.code_edition || feedback.code_edition || null,
    },
    before,
    expected: {
      element_type: effect.element_type || null,
      label_pattern: conditions.label_pattern || null,
      section_locator: effect.section_locator || null,
      issue_signature: effect.issue_signature || feedback.original_output?.issue?.title || null,
      note: effect.note || null,
      unbound: effect.kind === "unbind_dimension",
      bind_to: effect.bind_to || null,
      guidance_id: guidance?.id || null,
    },
  };
}

export function evaluateExamples(examples, beforeGuidance, afterGuidance) {
  const metrics = Object.fromEntries(METRICS.map((metric) => [metric, { labeled: 0, improved: 0, regressed: 0 }]));
  const rows = [];
  for (const example of examples || []) {
    if (!METRICS.includes(example.metric)) continue;
    const beforePass = examplePasses(example, beforeGuidance || []);
    const afterPass = examplePasses(example, afterGuidance || []);
    let outcome = "unchanged_incorrect";
    if (beforePass && !afterPass) outcome = "regression";
    else if (!beforePass && afterPass) outcome = "improvement";
    else if (beforePass && afterPass) outcome = "unchanged_correct";
    metrics[example.metric].labeled += 1;
    if (outcome === "improvement") metrics[example.metric].improved += 1;
    if (outcome === "regression") metrics[example.metric].regressed += 1;
    rows.push({ feedback_id: example.id, metric: example.metric, outcome, before_passed: beforePass, after_passed: afterPass });
  }
  const evaluation = {
    accuracyClaim: false,
    labeledCount: rows.length,
    improvements: rows.filter((row) => row.outcome === "improvement").length,
    regressions: rows.filter((row) => row.outcome === "regression").length,
    unchangedCorrect: rows.filter((row) => row.outcome === "unchanged_correct").length,
    unchangedIncorrect: rows.filter((row) => row.outcome === "unchanged_incorrect").length,
    metrics,
    examples: rows,
  };
  return evaluation;
}

export function canPromote(evaluation) {
  if (!evaluation || evaluation.accuracyClaim === true) return { ok: false, reason: "Accuracy cannot be claimed from this evaluation." };
  if (evaluation.confidence != null || evaluation.finding_count != null) {
    return { ok: false, reason: "Finding counts and model confidence are not acceptance metrics." };
  }
  if (!evaluation.labeledCount) return { ok: false, reason: "Add at least one reviewer-labeled example before promotion." };
  if (evaluation.regressions > 0) return { ok: false, reason: "Promotion is blocked because a labeled example regressed." };
  if (!evaluation.improvements) return { ok: false, reason: "The labeled examples did not show a measured improvement." };
  return { ok: true, reason: null };
}

export function promoteVersion(versions, guidanceRows, evaluation, actor) {
  const decision = canPromote(evaluation);
  if (!decision.ok) return { ok: false, error: decision.reason };
  if (!guidanceRows?.length) return { ok: false, error: "Nothing to promote." };
  const projectId = guidanceRows[0].project_id;
  if (guidanceRows.some((item) => item.project_id !== projectId)) return { ok: false, error: "Refusing to mix projects in one learning version." };
  const active = (versions || []).find((item) => item.project_id === projectId && item.is_active);
  const versionNumber = Math.max(0, ...(versions || []).filter((item) => item.project_id === projectId).map((item) => item.version_number || 0)) + 1;
  const version = {
    id: actor?.versionId || `version-${versionNumber}`,
    project_id: projectId,
    version_number: versionNumber,
    status: "promoted",
    is_active: true,
    previous_version_id: active?.id || null,
    evaluation,
    guidance_ids: guidanceRows.map((item) => item.id),
    promoted_by: actor?.userId || null,
  };
  const nextVersions = (versions || []).map((item) => item.id === active?.id ? { ...item, is_active: false } : item).concat(version);
  const guidance = guidanceRows.map((item) => ({ ...item, version_id: version.id, status: "promoted" }));
  return {
    ok: true,
    version,
    versions: nextVersions,
    guidance,
    audit: { action: "promoted", version_id: version.id, previous_version_id: version.previous_version_id, evaluation },
  };
}

export function activeGuidance(guidance, versions, projectId) {
  const active = (versions || []).find((item) => item.project_id === projectId && item.is_active && item.status === "promoted");
  if (!active) return [];
  return (guidance || []).filter((item) => item.project_id === projectId && item.version_id === active.id && item.status === "promoted");
}

export function rollbackVersions(versions, guidance, projectId, actor) {
  const active = (versions || []).find((item) => item.project_id === projectId && item.is_active && item.status === "promoted");
  if (!active) return { ok: false, error: "No active learning version to roll back.", versions, guidance };
  const nextVersions = versions.map((item) => {
    if (item.id === active.id) return { ...item, is_active: false, status: "rolled_back", rolled_back_by: actor?.userId || null };
    if (active.previous_version_id && item.id === active.previous_version_id) return { ...item, is_active: true, status: "promoted" };
    return item;
  });
  const nextGuidance = (guidance || []).map((item) =>
    item.version_id === active.id ? { ...item, status: "rolled_back" } : item,
  );
  return {
    ok: true,
    versions: nextVersions,
    guidance: nextGuidance,
    rolledBack: active.id,
    restored: active.previous_version_id || null,
    audit: { action: "rolled_back", version_id: active.id, restored_version_id: active.previous_version_id || null, reason: actor?.reason || null },
  };
}

export function validateProposed(projectId, proposed) {
  return buildGuidanceFromFeedback({
    id: "preview",
    project_id: projectId,
    status: "approved",
    approval_basis: "human_approval",
    source_kind: "human_reviewer",
    proposed_correction: proposed,
  });
}

export function draftFromIssue(issue, context) {
  const title = clean(issue?.title, 180) || "";
  return {
    category: "false_positive",
    scope: "sheet",
    conditions: emptyConditions({
      sheet_number: clean(context?.fileName, 160),
      sheet_id: clean(context?.sheetId, 80),
      discipline: clean(context?.discipline, 40),
      code_edition: clean(context?.codeYear, 40),
      jurisdiction: clean(context?.jurisdiction, 80),
      section_locator: clean(issue?.codeReference, 40),
    }),
    effect: {
      kind: "suppress_false_positive",
      element_type: null,
      bind_to: null,
      section_locator: clean(issue?.codeReference, 40),
      note: "",
      issue_signature: title,
    },
    original_output: {
      source: "published_finding",
      issue: {
        id: issue?.id || null,
        title: issue?.title || null,
        description: issue?.description || null,
        codeReference: issue?.codeReference || null,
        findingType: issue?.findingType || null,
        severity: issue?.severity || null,
        location: issue?.location || null,
      },
    },
    drawing_evidence: {
      file_name: context?.fileName || null,
      sheet_id: context?.sheetId || null,
      document_id: context?.documentId || null,
      location: issue?.location || null,
      code_reference: issue?.codeReference || null,
    },
  };
}

