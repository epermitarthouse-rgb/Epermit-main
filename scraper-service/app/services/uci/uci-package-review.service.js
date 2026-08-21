"use strict";

const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  findLoadProfileDraftApplication,
  getApplicationById,
} = require("./uci-application-builder.service.js");
const { getCoordinationRecordById } = require("./uci-records.service.js");

const ITEM_STATUSES = new Set(["confirmed", "needs_correction"]);
const REVIEW_VERSION = "agent-3-package-review-v2";
const PACKAGE_REVIEW_APPLICATION_SELECT =
  "id, coordination_record_id, project_id, application_type, package_documents, submission_method, utility_ticket_number, submitted_at, submitted_by, reviewed_by, reviewed_at, draft_status, agent_draft_metadata, idempotency_key, last_error, provider_slug, record_source, created_at, updated_at";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function packageContext(application) {
  if (
    !application ||
    String(application.record_source) !== "agent_draft" ||
    String(application.idempotency_key) !== APPLICATION_PACKAGE_IDEMPOTENCY_KEY
  ) {
    throw Object.assign(new Error("Application is not an Application Builder package"), {
      statusCode: 400,
      code: "NOT_APPLICATION_PACKAGE",
    });
  }
  const { hydrateApplicationVerifiedFields } = require("./uci-application-builder.service.js");
  const hydrated = hydrateApplicationVerifiedFields(application).application;
  const metadata = asObject(hydrated.agent_draft_metadata);
  const pkg = asObject(metadata.application_package);
  const review = asObject(pkg.package_review);
  return { metadata, pkg, review, application: hydrated };
}

function fieldSnapshot(field) {
  return {
    key: String(field.key ?? ""),
    label: String(field.label ?? field.key ?? ""),
    status: String(field.status ?? ""),
    value: clone(field.value ?? null),
    source: String(field.source ?? ""),
    address_source: field.address_source != null ? String(field.address_source) : null,
  };
}

function documentSnapshot(document) {
  return {
    key: String(document.key ?? ""),
    label: String(document.label ?? document.key ?? ""),
    status: String(document.status ?? ""),
    file_name: document.file_name != null ? String(document.file_name) : null,
    source: document.source != null ? String(document.source) : null,
    project_document_id:
      document.project_document_id != null ? String(document.project_document_id) : null,
    external_application_id:
      document.external_application_id != null ? String(document.external_application_id) : null,
    storage_path: document.storage_path != null ? String(document.storage_path) : null,
    content_hash: document.content_hash != null ? String(document.content_hash) : null,
    signature_required: document.signature_required === true,
    signature_status:
      document.signature_required === true ? String(document.signature_status ?? "unknown") : null,
    signature_verified_at:
      document.signature_verified_at != null ? String(document.signature_verified_at) : null,
  };
}

function currentItems(application) {
  const { pkg } = packageContext(application);
  const fields = Array.isArray(pkg.field_results)
    ? pkg.field_results.map(fieldSnapshot).filter((item) => item.key)
    : [];
  const documents = Array.isArray(application.package_documents)
    ? application.package_documents.map(documentSnapshot).filter((item) => item.key)
    : [];
  return { fields, documents };
}

const PERSISTED_PROJECT_DOCUMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPersistedProjectDocumentId(value) {
  const id = value != null ? String(value).trim() : "";
  if (!id) return false;
  if (/^generated-/i.test(id)) return false;
  return PERSISTED_PROJECT_DOCUMENT_ID.test(id);
}

function documentMappingReady(snapshot) {
  return (
    snapshot.status === "attached" &&
    isPersistedProjectDocumentId(snapshot.project_document_id) &&
    (!snapshot.signature_required || snapshot.signature_status === "signed_manual_verified")
  );
}

function findUnresolvedPackageDocumentReferences(documents) {
  const list = Array.isArray(documents) ? documents : [];
  /** @type {Array<{ key: string; code: string; label: string | null }>} */
  const unresolved = [];
  for (const raw of list) {
    const doc = asObject(raw);
    const key = doc.key != null ? String(doc.key) : "";
    if (!key || String(doc.status ?? "") !== "attached") continue;
    if (!isPersistedProjectDocumentId(doc.project_document_id)) {
      unresolved.push({
        key,
        code: "ATTACHMENT_DOCUMENT_ID_MISSING",
        label: doc.label != null ? String(doc.label) : key,
      });
    }
  }
  return unresolved;
}

function packageReviewFromApplication(application) {
  const metadata = asObject(application?.agent_draft_metadata);
  const pkg = asObject(metadata.application_package);
  return asObject(pkg.package_review);
}

function packageHasReviewedRecoverySnapshot(application) {
  if (String(application?.draft_status) === "reviewed") return true;
  const review = packageReviewFromApplication(application);
  return Boolean(review.reviewed_snapshot);
}

function mergedPackageDocumentsForRepair(application) {
  const live = Array.isArray(application?.package_documents) ? application.package_documents : [];
  const review = packageReviewFromApplication(application);
  const snapshotDocs = Array.isArray(review.reviewed_snapshot?.package_documents)
    ? review.reviewed_snapshot.package_documents
    : [];
  const byKey = new Map();
  for (const raw of snapshotDocs) {
    const doc = asObject(raw);
    const key = doc.key != null ? String(doc.key) : "";
    if (key) byKey.set(key, doc);
  }
  for (const raw of live) {
    const doc = asObject(raw);
    const key = doc.key != null ? String(doc.key) : "";
    if (key) byKey.set(key, doc);
  }
  return [...byKey.values()];
}

function packageDocumentsNeedRepair(application) {
  return findUnresolvedPackageDocumentReferences(mergedPackageDocumentsForRepair(application));
}

function itemReady(kind, snapshot) {
  if (kind === "field") return snapshot.status === "present";
  return documentMappingReady(snapshot);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function sameSnapshot(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function reviewItemKey(kind, key) {
  return `${kind}:${key}`;
}

function summarizePackageReview(application) {
  const { pkg, review } = packageContext(application);
  const { fields, documents } = currentItems(application);
  const storedItems = asObject(review.items);
  const items = [...fields.map((snapshot) => ({ kind: "field", snapshot })), ...documents.map((snapshot) => ({ kind: "document", snapshot }))].map(
    ({ kind, snapshot }) => {
      const id = reviewItemKey(kind, snapshot.key);
      const stored = asObject(storedItems[id]);
      const snapshotMatches = sameSnapshot(stored.mapping_snapshot, snapshot);
      const status = snapshotMatches
        ? stored.status === "confirmed" || stored.status === "needs_correction"
          ? stored.status
          : "not_reviewed"
        : stored.status === "confirmed" || stored.status === "needs_correction"
          ? itemReady(kind, snapshot)
            ? "ready_for_re_review"
            : "needs_correction"
          : "not_reviewed";
      return {
        id,
        kind,
        key: snapshot.key,
        status,
        ready: itemReady(kind, snapshot),
        snapshot,
        reviewed_by_user_id:
          stored.reviewed_by_user_id != null ? String(stored.reviewed_by_user_id) : null,
        reviewed_at: stored.reviewed_at != null ? String(stored.reviewed_at) : null,
        note: stored.note != null ? String(stored.note) : null,
        issue_area:
          stored.issue_area === "signature" || stored.issue_area === "mapping"
            ? stored.issue_area
            : kind === "document" &&
                asObject(stored.mapping_snapshot).signature_status !== snapshot.signature_status
              ? "signature"
              : "mapping",
      };
    },
  );
  const allConfirmed =
    items.length > 0 &&
    items.every((item) => item.ready && item.status === "confirmed") &&
    String(pkg.package_status ?? "") === "ready_for_review";
  const packageCorrection = asObject(review.package_correction);
  const activeCorrections = items.filter(
    (item) => item.status === "needs_correction" || item.status === "ready_for_re_review",
  );
  const activeCorrectionCount = activeCorrections.length;
  let status = "draft";
  if (String(application.draft_status) === "reviewed" && review.reviewed_snapshot) {
    status = "reviewed";
  } else if (activeCorrectionCount > 0) {
    status = "needs_changes";
  } else if (String(pkg.package_status ?? "") === "ready_for_review") {
    status = "ready_for_review";
  }
  return {
    version: REVIEW_VERSION,
    status,
    all_confirmed: allConfirmed,
    ready_for_final_review: allConfirmed && activeCorrectionCount === 0,
    active_correction_count: activeCorrectionCount,
    active_corrections: activeCorrections,
    confirmed_count: items.filter((item) => item.status === "confirmed").length,
    total_count: items.length,
    items,
    reviewed_by_user_id:
      review.reviewed_by_user_id != null
        ? String(review.reviewed_by_user_id)
        : application.reviewed_by != null
          ? String(application.reviewed_by)
          : null,
    reviewer_display: review.reviewer_display != null ? String(review.reviewer_display) : null,
    reviewed_at:
      review.reviewed_at != null
        ? String(review.reviewed_at)
        : application.reviewed_at != null
          ? String(application.reviewed_at)
          : null,
    reviewed_snapshot: review.reviewed_snapshot ? clone(review.reviewed_snapshot) : null,
    review_history: Array.isArray(review.review_history) ? clone(review.review_history) : [],
    package_correction:
      Object.keys(packageCorrection).length > 0 ? clone(packageCorrection) : null,
  };
}

function withPackageReviewSummary(application, loadSummary = null) {
  const {
    hydrateApplicationVerifiedFields,
    loadLiveLoadSummaryForPackage,
  } = require("./uci-application-builder.service.js");
  const hydratedSync = hydrateApplicationVerifiedFields(application, loadSummary).application;
  return {
    ...hydratedSync,
    load_summary: loadSummary ?? application.load_summary ?? {},
    package_review_summary: summarizePackageReview(hydratedSync),
  };
}

async function withPackageReviewSummaryAsync(supabase, application) {
  const { loadLiveLoadSummaryForPackage } = require("./uci-application-builder.service.js");
  const liveSummary = await loadLiveLoadSummaryForPackage(supabase, application);
  return withPackageReviewSummary(application, liveSummary);
}

async function getPackageReviewApplicationById(supabase, applicationId) {
  const { persistHydratedVerifiedFields } = require("./uci-application-builder.service.js");
  const { data, error } = await supabase
    .from("coordination_applications")
    .select(PACKAGE_REVIEW_APPLICATION_SELECT)
    .eq("id", applicationId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to load application package"), {
      cause: error,
      statusCode: 500,
      code: "APPLICATION_FETCH_FAILED",
    });
  }
  if (!data) return null;
  if (
    String(data.record_source ?? "") === "agent_draft" &&
    String(data.idempotency_key ?? "") === APPLICATION_PACKAGE_IDEMPOTENCY_KEY
  ) {
    return persistHydratedVerifiedFields(supabase, data);
  }
  return data;
}

function assertReviewPersistenceMatches(application, packageReview, extraPatch = {}) {
  if (extraPatch.draft_status != null) {
    const expected = String(extraPatch.draft_status);
    const actual = String(application?.draft_status ?? "");
    if (actual !== expected) {
      throw Object.assign(
        new Error(
          `Package review draft_status did not persist (expected ${expected}, got ${actual || "empty"})`,
        ),
        { statusCode: 500, code: "PACKAGE_REVIEW_PERSIST_MISMATCH" },
      );
    }
  }
  const persistedReview = packageReviewFromApplication(application);
  if (packageReview.reviewed_snapshot) {
    if (!persistedReview.reviewed_snapshot) {
      throw Object.assign(new Error("Reviewed snapshot did not persist on mark reviewed"), {
        statusCode: 500,
        code: "PACKAGE_REVIEW_PERSIST_MISMATCH",
      });
    }
    const expectedWorksheet = (
      Array.isArray(packageReview.reviewed_snapshot.package_documents)
        ? packageReview.reviewed_snapshot.package_documents
        : []
    ).find((doc) => String(asObject(doc).key) === "load_calculation_worksheet");
    const persistedWorksheet = (
      Array.isArray(persistedReview.reviewed_snapshot.package_documents)
        ? persistedReview.reviewed_snapshot.package_documents
        : []
    ).find((doc) => String(asObject(doc).key) === "load_calculation_worksheet");
    if (
      expectedWorksheet &&
      String(asObject(expectedWorksheet).project_document_id ?? "") !==
        String(asObject(persistedWorksheet).project_document_id ?? "")
    ) {
      throw Object.assign(
        new Error("Reviewed snapshot worksheet project_document_id did not persist"),
        { statusCode: 500, code: "PACKAGE_REVIEW_PERSIST_MISMATCH" },
      );
    }
  } else if (packageReview.reviewed_snapshot === null && persistedReview.reviewed_snapshot) {
    throw Object.assign(new Error("Reviewed snapshot clear did not persist"), {
      statusCode: 500,
      code: "PACKAGE_REVIEW_PERSIST_MISMATCH",
    });
  }
}

async function persistReviewMetadata(supabase, application, packageReview, extraPatch = {}) {
  const { metadata, pkg } = packageContext(application);
  const nextMetadata = {
    ...metadata,
    application_package: {
      ...pkg,
      package_review: packageReview,
    },
  };
  const patch = { agent_draft_metadata: nextMetadata, ...extraPatch };
  const { error } = await supabase
    .from("coordination_applications")
    .update(patch)
    .eq("id", application.id)
    .select("id")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update package review"), {
      cause: error,
      statusCode: 500,
      code: "PACKAGE_REVIEW_UPDATE_FAILED",
    });
  }
  const persisted = await getPackageReviewApplicationById(supabase, application.id);
  if (!persisted) {
    throw Object.assign(new Error("Application not found after package review update"), {
      statusCode: 500,
      code: "PACKAGE_REVIEW_PERSIST_VERIFY_FAILED",
    });
  }
  assertReviewPersistenceMatches(persisted, packageReview, extraPatch);
  return persisted;
}

async function updatePackageReviewItem(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, params.applicationId));
  if (!application) {
    throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  }
  const kind = String(params.kind ?? "").trim();
  const key = String(params.key ?? "").trim();
  const status = String(params.status ?? "").trim();
  if (!["field", "document"].includes(kind) || !key || !ITEM_STATUSES.has(status)) {
    throw Object.assign(new Error("kind, item_key, and a valid review status are required"), {
      statusCode: 400,
      code: "INVALID_PACKAGE_REVIEW_ITEM",
    });
  }
  const { pkg, review } = packageContext(application);
  if (String(application.draft_status) === "submitted") {
    throw Object.assign(new Error("Submitted applications cannot be reviewed"), {
      statusCode: 400,
      code: "ALREADY_SUBMITTED",
    });
  }
  if (String(application.draft_status) === "reviewed") {
    throw Object.assign(new Error("Reopen review before changing package requirements"), {
      statusCode: 409,
      code: "PACKAGE_REVIEW_LOCKED",
    });
  }
  const current = currentItems(application);
  const snapshot = current[kind === "field" ? "fields" : "documents"].find(
    (item) => item.key === key,
  );
  if (!snapshot) {
    throw Object.assign(new Error("Package review item not found"), {
      statusCode: 404,
      code: "PACKAGE_REVIEW_ITEM_NOT_FOUND",
    });
  }
  if (status === "confirmed" && !itemReady(kind, snapshot)) {
    const message =
      kind === "document" &&
      snapshot.status === "attached" &&
      !isPersistedProjectDocumentId(snapshot.project_document_id)
        ? `Document mapping is not ready to confirm — missing persisted project_document_id (${key})`
        : "The current mapping is not ready to confirm";
    throw Object.assign(new Error(message), {
      statusCode: 400,
      code: "PACKAGE_REVIEW_ITEM_NOT_READY",
    });
  }
  const correctionNote = String(params.note ?? "").trim();
  const issueArea =
    kind === "document" && params.issueArea === "signature" ? "signature" : "mapping";
  if (status === "needs_correction" && !correctionNote) {
    throw Object.assign(new Error("A correction note is required"), {
      statusCode: 400,
      code: "PACKAGE_REVIEW_CORRECTION_NOTE_REQUIRED",
    });
  }
  const now = new Date().toISOString();
  const itemId = reviewItemKey(kind, key);
  const priorItem = asObject(asObject(review.items)[itemId]);
  const auditEntry = {
    action: status === "confirmed" ? "confirm_for_package" : "needs_correction",
    status,
    actor_user_id: params.userId,
    at: now,
    note: correctionNote || null,
    issue_area: status === "needs_correction" ? issueArea : null,
    mapping_snapshot: snapshot,
  };
  const nextReview = {
    ...review,
    version: REVIEW_VERSION,
    status: status === "needs_correction" ? "needs_changes" : "ready_for_review",
    package_correction: {
      ...asObject(review.package_correction),
      active: false,
      cleared_at: now,
      cleared_by_user_id: params.userId,
    },
    items: {
      ...asObject(review.items),
      [itemId]: {
        ...priorItem,
        kind,
        key,
        status,
        mapping_snapshot: snapshot,
        reviewed_by_user_id: params.userId,
        reviewed_at: now,
        note: correctionNote || null,
        issue_area: status === "needs_correction" ? issueArea : null,
        audit_log: [...(Array.isArray(priorItem.audit_log) ? priorItem.audit_log : []), auditEntry],
      },
    },
    updated_at: now,
    updated_by_user_id: params.userId,
  };
  const updated = await persistReviewMetadata(supabase, application, nextReview, {
    draft_status:
      status === "needs_correction" || String(application.draft_status) === "reviewed"
        ? "needs_changes"
        : "draft",
    ...(String(application.draft_status) === "reviewed"
      ? { reviewed_by: null, reviewed_at: null }
      : {}),
  });
  const summary = summarizePackageReview(updated);
  return { application: withPackageReviewSummary(updated), package_review: summary };
}

async function confirmAllVerifiedFields(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, params.applicationId));
  if (!application) {
    throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  }
  if (String(application.draft_status) === "reviewed") {
    throw Object.assign(new Error("Reopen review before changing package requirements"), {
      statusCode: 409,
      code: "PACKAGE_REVIEW_LOCKED",
    });
  }
  const { review } = packageContext(application);
  const storedItems = asObject(review.items);
  const fields = currentItems(application).fields.filter((field) => {
    const stored = asObject(storedItems[reviewItemKey("field", field.key)]);
    return (
      field.status === "present" &&
      field.source.startsWith("load_summary.verified_values") &&
      stored.status !== "needs_correction"
    );
  });
  const now = new Date().toISOString();
  const nextItems = { ...asObject(review.items) };
  for (const snapshot of fields) {
    const itemId = reviewItemKey("field", snapshot.key);
    const priorItem = asObject(nextItems[itemId]);
    const auditEntry = {
      action: "bulk_confirm_verified_field",
      status: "confirmed",
      actor_user_id: params.userId,
      at: now,
      note: "Bulk-confirmed by operator",
      mapping_snapshot: snapshot,
    };
    nextItems[itemId] = {
      ...priorItem,
      kind: "field",
      key: snapshot.key,
      status: "confirmed",
      mapping_snapshot: snapshot,
      reviewed_by_user_id: params.userId,
      reviewed_at: now,
      note: "Bulk-confirmed by operator",
      audit_log: [...(Array.isArray(priorItem.audit_log) ? priorItem.audit_log : []), auditEntry],
    };
  }
  const nextReview = {
    ...review,
    version: REVIEW_VERSION,
    status: "ready_for_review",
    items: nextItems,
    updated_at: now,
    updated_by_user_id: params.userId,
  };
  const updated = await persistReviewMetadata(supabase, application, nextReview);
  const summary = summarizePackageReview(updated);
  return {
    application: withPackageReviewSummary(updated),
    package_review: summary,
    confirmed_count: fields.length,
  };
}

async function repairReviewedPackageDocuments(supabase, params) {
  const application =
    params.application ?? (await getPackageReviewApplicationById(supabase, params.applicationId));
  if (!application) {
    throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  }
  if (!packageHasReviewedRecoverySnapshot(application)) {
    throw Object.assign(
      new Error("Only reviewed application packages with unresolved document references can be repaired"),
      { statusCode: 409, code: "PACKAGE_NOT_REVIEWED" },
    );
  }
  if (String(application.draft_status) === "submitted") {
    throw Object.assign(new Error("Submitted applications cannot be repaired"), {
      statusCode: 400,
      code: "ALREADY_SUBMITTED",
    });
  }

  const unresolved = packageDocumentsNeedRepair(application);
  if (unresolved.length === 0) {
    throw Object.assign(new Error("No unresolved required document references found to repair"), {
      statusCode: 409,
      code: "PACKAGE_NOT_REPAIRABLE",
    });
  }

  const unsupported = unresolved.filter((entry) => entry.key !== "load_calculation_worksheet");
  if (unsupported.length > 0) {
    throw Object.assign(
      new Error(
        `Automatic repair is not available for: ${unsupported.map((entry) => entry.key).join(", ")}`,
      ),
      {
        statusCode: 409,
        code: "PACKAGE_REPAIR_UNSUPPORTED_SLOT",
        details: { unsupported_keys: unsupported.map((entry) => entry.key) },
      },
    );
  }

  const record = await getCoordinationRecordById(supabase, String(application.coordination_record_id));
  if (!record) {
    throw Object.assign(new Error("Coordination record not found"), {
      statusCode: 404,
      code: "NOT_FOUND",
    });
  }

  const [projectResult, applicationsResult] = await Promise.all([
    supabase.from("projects").select("*").eq("id", String(record.project_id)).maybeSingle(),
    supabase
      .from("coordination_applications")
      .select("id, record_source, idempotency_key, load_summary")
      .eq("coordination_record_id", String(record.id))
      .eq("project_id", String(record.project_id)),
  ]);
  if (projectResult.error || !projectResult.data) {
    throw Object.assign(new Error(projectResult.error?.message || "Failed to load project"), {
      statusCode: 500,
      code: "PROJECT_FETCH_FAILED",
    });
  }
  if (applicationsResult.error) {
    throw Object.assign(
      new Error(applicationsResult.error.message || "Failed to load coordination applications"),
      { statusCode: 500, code: "APPLICATIONS_FETCH_FAILED" },
    );
  }

  const loadProfileDraft = findLoadProfileDraftApplication(applicationsResult.data ?? []);
  const loadSummary =
    loadProfileDraft?.load_summary && typeof loadProfileDraft.load_summary === "object"
      ? loadProfileDraft.load_summary
      : application.load_summary && typeof application.load_summary === "object"
        ? application.load_summary
        : {};

  const worksheetSlot = mergedPackageDocumentsForRepair(application).find(
    (doc) => String(doc.key) === "load_calculation_worksheet",
  );
  const { persistWorksheetFromPackageSlot } = require("./uci-load-worksheet.service.js");
  const worksheet = await persistWorksheetFromPackageSlot(supabase, {
    record,
    project: projectResult.data,
    loadSummary,
    worksheetSlot,
    userId: params.userId,
  });

  const packageDocuments = Array.isArray(application.package_documents)
    ? application.package_documents.map((doc) => ({ ...asObject(doc) }))
    : [];
  const worksheetIndex = packageDocuments.findIndex(
    (doc) => String(doc.key) === "load_calculation_worksheet",
  );
  if (worksheetIndex >= 0) {
    packageDocuments[worksheetIndex] = { ...packageDocuments[worksheetIndex], ...worksheet, status: "attached" };
  } else {
    packageDocuments.push({ ...worksheet, status: "attached" });
  }

  const remainingUnresolved = findUnresolvedPackageDocumentReferences(packageDocuments);
  if (remainingUnresolved.length > 0) {
    throw Object.assign(new Error("Package repair did not resolve all required document references"), {
      statusCode: 500,
      code: "PACKAGE_REPAIR_INCOMPLETE",
      details: { unresolved: remainingUnresolved },
    });
  }

  const { review } = packageContext(application);
  const now = new Date().toISOString();
  const repairedKeys = unresolved.map((entry) => entry.key);
  const nextItems = { ...asObject(review.items) };
  for (const key of repairedKeys) {
    delete nextItems[reviewItemKey("document", key)];
  }

  const priorHistory = Array.isArray(review.review_history) ? review.review_history : [];
  const staleSnapshot = review.reviewed_snapshot ?? null;
  const repairEvent = {
    action: "repair_unresolved_document_references",
    actor_user_id: params.userId,
    at: now,
    repaired_keys: repairedKeys,
    prior_reviewed_snapshot_captured_at: staleSnapshot?.captured_at ?? null,
  };
  const nextReview = {
    ...review,
    version: REVIEW_VERSION,
    status: "ready_for_review",
    items: nextItems,
    reviewed_snapshot: null,
    review_history: staleSnapshot ? [...priorHistory, staleSnapshot] : priorHistory,
    correction_history: [
      ...(Array.isArray(review.correction_history) ? review.correction_history : []),
      repairEvent,
    ],
    package_correction: {
      ...asObject(review.package_correction),
      active: false,
      cleared_at: now,
      cleared_by_user_id: params.userId,
    },
    repair: {
      last_repaired_at: now,
      last_repaired_by_user_id: params.userId,
      repaired_keys: repairedKeys,
      worksheet_project_document_id: worksheet.project_document_id ?? null,
    },
    updated_at: now,
    updated_by_user_id: params.userId,
  };

  const updated = await persistReviewMetadata(supabase, application, nextReview, {
    package_documents: packageDocuments,
    draft_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
  });

  const summary = summarizePackageReview(updated);
  return {
    application: withPackageReviewSummary(updated),
    package_review: summary,
    repaired_keys: repairedKeys,
    worksheet_project_document_id: worksheet.project_document_id ?? null,
    requires_reconfirm_keys: repairedKeys,
    requires_final_review: true,
  };
}

async function reviewApplicationPackage(supabase, params) {
  const application =
    params.application ?? (await getApplicationById(supabase, params.applicationId));
  if (!application) {
    throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
  }
  const status = String(params.review?.status ?? "").trim().toLowerCase();
  if (status !== "reviewed" && status !== "needs_changes") {
    throw Object.assign(new Error('Review status must be "reviewed" or "needs_changes"'), {
      statusCode: 400,
      code: "INVALID_REVIEW_STATUS",
    });
  }
  const { pkg, review } = packageContext(application);
  if (String(application.draft_status) === "submitted") {
    throw Object.assign(new Error("Submitted applications cannot be reviewed"), {
      statusCode: 400,
      code: "ALREADY_SUBMITTED",
    });
  }
  const summary = summarizePackageReview(application);
  if (status === "reviewed" && !summary.ready_for_final_review) {
    throw Object.assign(
      new Error("Confirm every required package field and document before final review"),
      { statusCode: 400, code: "PACKAGE_REVIEW_ITEMS_INCOMPLETE" },
    );
  }
  if (status === "reviewed" && String(pkg.package_status ?? "") !== "ready_for_review") {
    throw Object.assign(new Error("Application package is not complete"), {
      statusCode: 400,
      code: "PACKAGE_NOT_READY",
    });
  }
  const now = new Date().toISOString();
  const notes = String(params.review?.notes ?? "").trim() || null;
  if (status === "needs_changes" && !notes) {
    throw Object.assign(new Error("A correction note is required when requesting changes"), {
      statusCode: 400,
      code: "PACKAGE_REVIEW_CORRECTION_NOTE_REQUIRED",
    });
  }
  const reviewedSnapshot =
    status === "reviewed"
      ? {
          snapshot_version: "agent-3-reviewed-package-snapshot-v1",
          package_review_version: REVIEW_VERSION,
          checklist_version: pkg.template_id ?? null,
          checklist_mode: pkg.checklist_mode ?? null,
          reviewer: {
            user_id: params.userId,
            display: params.reviewerDisplay ?? null,
          },
          captured_at: now,
          field_results: clone(Array.isArray(pkg.field_results) ? pkg.field_results : []),
          package_documents: clone(
            Array.isArray(application.package_documents) ? application.package_documents : [],
          ),
          signature_requirements: clone(
            Array.isArray(pkg.signature_requirements) ? pkg.signature_requirements : [],
          ),
          verified_load_snapshot: clone(asObject(pkg.verified_load_snapshot)),
          package_review_items: clone(asObject(review.items)),
          provenance_preserved: true,
        }
      : review.reviewed_snapshot ?? null;
  const priorHistory = Array.isArray(review.review_history) ? review.review_history : [];
  const correctionHistory = Array.isArray(review.correction_history)
    ? review.correction_history
    : [];
  const reopenEvent =
    status === "needs_changes"
      ? {
          action: "reopen_review",
          reason: notes,
          actor_user_id: params.userId,
          at: now,
          prior_reviewed_snapshot_captured_at: review.reviewed_snapshot?.captured_at ?? null,
        }
      : null;
  const nextReview = {
    ...review,
    version: REVIEW_VERSION,
    status: status === "reviewed" ? "reviewed" : "needs_changes",
    reviewed_by_user_id: status === "reviewed" ? params.userId : review.reviewed_by_user_id ?? null,
    reviewer_display:
      status === "reviewed" ? params.reviewerDisplay ?? null : review.reviewer_display ?? null,
    reviewed_at: status === "reviewed" ? now : review.reviewed_at ?? null,
    review_notes: notes,
    reviewed_snapshot: reviewedSnapshot,
    review_history:
      status === "reviewed" ? [...priorHistory, reviewedSnapshot] : priorHistory,
    correction_history:
      reopenEvent ? [...correctionHistory, reopenEvent] : correctionHistory,
    package_correction:
      status === "needs_changes"
        ? {
            active: false,
            note: notes,
            requested_by_user_id: params.userId,
            requested_at: now,
            prior_reviewed_snapshot_captured_at: review.reviewed_snapshot?.captured_at ?? null,
            cleared_at: now,
            cleared_by_user_id: params.userId,
          }
        : {
            ...asObject(review.package_correction),
            active: false,
            cleared_at: now,
            cleared_by_user_id: params.userId,
          },
    updated_at: now,
    updated_by_user_id: params.userId,
  };
  const updated = await persistReviewMetadata(supabase, application, nextReview, {
    draft_status: status === "reviewed" ? "reviewed" : "draft",
    reviewed_by: status === "reviewed" ? params.userId : null,
    reviewed_at: status === "reviewed" ? now : null,
  });
  const persistedSummary = summarizePackageReview(updated);
  if (status === "reviewed") {
    if (
      String(updated.draft_status) !== "reviewed" ||
      persistedSummary.status !== "reviewed" ||
      !persistedSummary.reviewed_snapshot
    ) {
      throw Object.assign(
        new Error("Mark reviewed did not persist reviewed status and immutable snapshot"),
        { statusCode: 500, code: "PACKAGE_REVIEW_PERSIST_MISMATCH" },
      );
    }
    const { blockStaleConfirmedPreparations } = require("./uci-submission-prepare.service.js");
    await blockStaleConfirmedPreparations(supabase, {
      applicationId: String(application.id),
      application: updated,
      reviewSummary: persistedSummary,
      userId: params.userId,
      reason: "reviewed_snapshot_changed",
    });
  }
  return {
    application: withPackageReviewSummary(updated),
    review_status: status,
    reviewed_at: status === "reviewed" ? now : null,
    reviewed_by: status === "reviewed" ? params.userId : null,
    package_review: persistedSummary,
    stale_preparations_blocked: status === "reviewed" ? true : undefined,
  };
}

module.exports = {
  REVIEW_VERSION,
  PACKAGE_REVIEW_APPLICATION_SELECT,
  currentItems,
  isPersistedProjectDocumentId,
  documentMappingReady,
  findUnresolvedPackageDocumentReferences,
  packageHasReviewedRecoverySnapshot,
  mergedPackageDocumentsForRepair,
  packageDocumentsNeedRepair,
  itemReady,
  summarizePackageReview,
  withPackageReviewSummary,
  getPackageReviewApplicationById,
  updatePackageReviewItem,
  confirmAllVerifiedFields,
  repairReviewedPackageDocuments,
  reviewApplicationPackage,
};
