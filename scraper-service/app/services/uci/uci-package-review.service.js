"use strict";

const {
  APPLICATION_PACKAGE_IDEMPOTENCY_KEY,
  getApplicationById,
} = require("./uci-application-builder.service.js");

const ITEM_STATUSES = new Set(["confirmed", "needs_correction"]);
const REVIEW_VERSION = "agent-3-package-review-v2";

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
    throw Object.assign(new Error("Application is not an Agent 3 application package"), {
      statusCode: 400,
      code: "NOT_APPLICATION_PACKAGE",
    });
  }
  const metadata = asObject(application.agent_draft_metadata);
  const pkg = asObject(metadata.application_package);
  const review = asObject(pkg.package_review);
  return { metadata, pkg, review };
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

function itemReady(kind, snapshot) {
  if (kind === "field") return snapshot.status === "present";
  return (
    snapshot.status === "attached" &&
    (!snapshot.signature_required || snapshot.signature_status === "signed_manual_verified")
  );
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
        : stored.status === "needs_correction" && itemReady(kind, snapshot)
          ? "ready_for_re_review"
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
      };
    },
  );
  const allConfirmed =
    items.length > 0 &&
    items.every((item) => item.ready && item.status === "confirmed") &&
    String(pkg.package_status ?? "") === "ready_for_review";
  const packageCorrection = asObject(review.package_correction);
  const activeCorrectionCount =
    items.filter((item) => item.status === "needs_correction").length +
    (packageCorrection.active === true ? 1 : 0);
  let status = "draft";
  if (String(application.draft_status) === "reviewed" && review.reviewed_snapshot) {
    status = "reviewed";
  } else if (
    activeCorrectionCount > 0 ||
    String(application.draft_status) === "needs_changes"
  ) {
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

function withPackageReviewSummary(application) {
  return {
    ...application,
    package_review_summary: summarizePackageReview(application),
  };
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
  const { data, error } = await supabase
    .from("coordination_applications")
    .update({ agent_draft_metadata: nextMetadata, ...extraPatch })
    .eq("id", application.id)
    .select("*")
    .single();
  if (error) {
    throw Object.assign(new Error(error.message || "Failed to update package review"), {
      cause: error,
      statusCode: 500,
      code: "PACKAGE_REVIEW_UPDATE_FAILED",
    });
  }
  return data;
}

async function updatePackageReviewItem(supabase, params) {
  const application = await getApplicationById(supabase, params.applicationId);
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
    throw Object.assign(new Error("The current mapping is not ready to confirm"), {
      statusCode: 400,
      code: "PACKAGE_REVIEW_ITEM_NOT_READY",
    });
  }
  const correctionNote = String(params.note ?? "").trim();
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
  const application = await getApplicationById(supabase, params.applicationId);
  if (!application) {
    throw Object.assign(new Error("Application not found"), { statusCode: 404, code: "NOT_FOUND" });
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

async function reviewApplicationPackage(supabase, params) {
  const application = await getApplicationById(supabase, params.applicationId);
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
    package_correction:
      status === "needs_changes"
        ? {
            active: true,
            note: notes,
            requested_by_user_id: params.userId,
            requested_at: now,
            prior_reviewed_snapshot_captured_at: review.reviewed_snapshot?.captured_at ?? null,
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
    draft_status: status,
    reviewed_by: status === "reviewed" ? params.userId : null,
    reviewed_at: status === "reviewed" ? now : null,
  });
  return {
    application: withPackageReviewSummary(updated),
    review_status: status,
    reviewed_at: status === "reviewed" ? now : null,
    reviewed_by: status === "reviewed" ? params.userId : null,
    package_review: summarizePackageReview(updated),
  };
}

module.exports = {
  REVIEW_VERSION,
  currentItems,
  summarizePackageReview,
  withPackageReviewSummary,
  updatePackageReviewItem,
  confirmAllVerifiedFields,
  reviewApplicationPackage,
};
