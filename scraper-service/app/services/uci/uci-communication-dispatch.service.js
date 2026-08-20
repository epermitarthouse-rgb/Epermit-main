"use strict";

/**
 * Post-classify dispatch for Stage 7–10 consumers.
 * Low confidence / flagged / unmatched = NO write.
 */

const { LOW_CONFIDENCE_THRESHOLD } = require("./uci-communication-categories.js");
const { isFlaggedForReview } = require("./uci-ack-acceptance.service.js");
const { handleCostLifecycleEvent } = require("./uci-cost-tracker.service.js");
const { appendEquipmentEta } = require("./uci-equipment-tracker.service.js");
const { confirmMeterSetDate } = require("./uci-meter-set-choreographer.service.js");
const { captureEnergizationDate } = require("./uci-energization-closeout.service.js");
const { normalizeCostType } = require("./uci-lifecycle-constants.js");

function asMeta(row) {
  if (row?.agent_processed_metadata && typeof row.agent_processed_metadata === "object") {
    return /** @type {Record<string, unknown>} */ (row.agent_processed_metadata);
  }
  return {};
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function extractedFields(communication) {
  const meta = asMeta(communication);
  return asRecord(meta.extracted_fields);
}

function parseAmount(value) {
  if (value == null) return null;
  if (typeof value === "object" && value.value != null) return Number(value.value);
  const n = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  if (typeof value === "object" && value.value) return String(value.value);
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-\d{2}/) || text.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
  return match ? match[0] : null;
}

function mayWrite(communication) {
  const confidence = Number(communication.classification_confidence);
  if (!(confidence >= LOW_CONFIDENCE_THRESHOLD)) return { ok: false, reason: "low_confidence" };
  const meta = asMeta(communication);
  if (isFlaggedForReview(meta)) return { ok: false, reason: "flagged_for_review" };
  const match = asRecord(meta.match);
  if (match.matched === false || meta.unmatched === true) return { ok: false, reason: "unmatched" };
  if (!communication.coordination_record_id) return { ok: false, reason: "unmatched" };
  if (String(communication.classification || "") === "unclassified") return { ok: false, reason: "unclassified" };
  return { ok: true };
}

async function dispatchCiacInvoice(supabase, communication) {
  const fields = extractedFields(communication);
  const amount = parseAmount(fields.actual_amount || fields.amount || fields.invoice_amount);
  const costType = normalizeCostType(fields.cost_type) || "CIAC";
  const recordId = String(communication.coordination_record_id);
  const projectId = String(communication.project_id);

  const { data: existingRows } = await supabase
    .from("coordination_costs")
    .select("*")
    .eq("coordination_record_id", recordId)
    .eq("project_id", projectId)
    .eq("cost_type", costType);

  const rows = Array.isArray(existingRows) ? existingRows : [];
  const target = rows.find((r) => !r.actual_amount) || rows[0] || null;

  /** @type {Record<string, unknown> | null} */
  let cost = target;
  let created = false;
  if (target) {
    const { data } = await supabase
      .from("coordination_costs")
      .update({
        actual_amount: amount,
        actual_received_at: new Date().toISOString(),
        actual_source: "utility_email",
        invoice_received_doc_ref: communication.id,
      })
      .eq("id", target.id)
      .select("*")
      .single();
    cost = data;
  } else {
    const { upsertCostRecord } = require("./uci-costs.service.js");
    const result = await upsertCostRecord(supabase, {
      coordinationRecordId: recordId,
      projectId,
      cost: {
        cost_type: costType,
        actual_amount: amount,
        actual_received_at: new Date().toISOString(),
        actual_source: "utility_email",
        invoice_received_doc_ref: communication.id,
      },
      skipLifecycle: true,
    });
    cost = result.cost;
    created = result.created;
  }

  const lifecycle = await handleCostLifecycleEvent(supabase, {
    cost,
    previous: target,
    created,
  });
  return { consumer: "ciac_invoice", cost: lifecycle.cost, created };
}

async function dispatchEquipmentEta(supabase, communication) {
  const fields = extractedFields(communication);
  const eta = parseDate(fields.eta || fields.current_eta || fields.delivery_date);
  const { data: items } = await supabase
    .from("coordination_equipment")
    .select("*")
    .eq("coordination_record_id", communication.coordination_record_id)
    .eq("project_id", communication.project_id);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return { consumer: "equipment_eta_update", updated: false, reason: "no_equipment" };
  }
  const target =
    list.find((i) => String(i.equipment_type || "") === String(fields.equipment_type || i.equipment_type)) ||
    list[0];
  const result = await appendEquipmentEta(supabase, {
    equipmentId: String(target.id),
    projectId: String(communication.project_id),
    eta,
    source: "utility_email",
    status: fields.status ? String(fields.status) : null,
  });
  return { consumer: "equipment_eta_update", updated: true, equipment: result.equipment };
}

async function dispatchInspectionReleaseRequest(supabase, communication) {
  void supabase;
  return {
    consumer: "inspection_release_request",
    wrote_received_at: false,
    needs_attention: true,
    reason: "request_only_do_not_set_received_at",
    communication_id: communication.id,
  };
}

async function dispatchMeterSetScheduling(supabase, communication) {
  const { data: record } = await supabase
    .from("coordination_records")
    .select("*")
    .eq("id", communication.coordination_record_id)
    .maybeSingle();
  const fields = extractedFields(communication);
  const date = parseDate(fields.scheduled_date || fields.meter_set_date || fields.date);
  if (Number(record?.current_stage) === 9 && record?.inspection_release_received_at && date) {
    const scheduled = await confirmMeterSetDate(supabase, {
      coordinationRecordId: String(record.id),
      scheduledDate: date,
    });
    return { consumer: "meter_set_scheduling", applied: scheduled.scheduled === true, scheduled };
  }
  return {
    consumer: "meter_set_scheduling",
    applied: false,
    proposed_date: date,
    needs_attention: true,
    reason: "stage_9_or_release_missing",
  };
}

async function dispatchAcknowledgment(supabase, communication) {
  const { maybeAutoCompleteFromCommunication } = require("./uci-ack-acceptance.service.js");
  const result = await maybeAutoCompleteFromCommunication(supabase, { communication });
  return { consumer: "acknowledgment", ...result };
}

async function dispatchCosOrDesign(supabase, communication) {
  const { maybeEnterStage6FromCommunication } = require("./uci-stage6-entry.service.js");
  const classification = String(communication.classification || "");
  const entered = await maybeEnterStage6FromCommunication(supabase, {
    communication,
    deps: { skipAnalysis: true },
  });
  return { consumer: classification, ...entered };
}

async function dispatchEnergizationConfirmation(supabase, communication) {
  const fields = extractedFields(communication);
  const date = parseDate(fields.energization_date || fields.actual_date || fields.date);
  if (!date) {
    return { consumer: "energization_confirmation", captured: false, reason: "no_date" };
  }
  const captured = await captureEnergizationDate(supabase, {
    coordinationRecordId: String(communication.coordination_record_id),
    actualDate: date,
    source: "energization_confirmation",
    communicationId: communication.id,
  });
  return { consumer: "energization_confirmation", captured: true, ...captured };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {object} params
 */
async function dispatchClassifiedCommunication(supabase, params) {
  const { communication } = params;
  const gate = mayWrite(communication);
  if (!gate.ok) {
    return { dispatched: false, reason: gate.reason, consumer: null };
  }

  const classification = String(communication.classification || "");
  /** @type {Record<string, unknown>} */
  let result;
  switch (classification) {
    case "acknowledgment":
      result = await dispatchAcknowledgment(supabase, communication);
      break;
    case "class_of_service":
    case "design_review_response":
      result = await dispatchCosOrDesign(supabase, communication);
      break;
    case "ciac_invoice":
      result = await dispatchCiacInvoice(supabase, communication);
      break;
    case "equipment_eta_update":
      result = await dispatchEquipmentEta(supabase, communication);
      break;
    case "inspection_release_request":
      result = await dispatchInspectionReleaseRequest(supabase, communication);
      break;
    case "meter_set_scheduling":
      result = await dispatchMeterSetScheduling(supabase, communication);
      break;
    case "energization_confirmation":
      result = await dispatchEnergizationConfirmation(supabase, communication);
      break;
    case "request_for_information":
    case "escalation_or_problem":
      result = {
        consumer: classification,
        needs_attention: true,
        reason: classification === "request_for_information" ? "utility_rfi" : "utility_escalation",
      };
      break;
    case "unclassified":
      return { dispatched: false, reason: "unclassified", consumer: null };
    default:
      return { dispatched: false, reason: "not_lifecycle_consumer", consumer: null };
  }

  await supabase
    .from("coordination_communications")
    .update({
      agent_processed_metadata: {
        ...asMeta(communication),
        lifecycle_dispatch: result.needs_attention ? "needs_attention" : "applied",
        lifecycle_result: result,
      },
      needs_human_attention:
        communication.needs_human_attention === true || result.needs_attention === true,
    })
    .eq("id", communication.id);

  return { dispatched: true, ...result };
}

module.exports = {
  mayWrite,
  dispatchClassifiedCommunication,
  dispatchCiacInvoice,
  dispatchEquipmentEta,
  dispatchInspectionReleaseRequest,
  dispatchMeterSetScheduling,
  dispatchEnergizationConfirmation,
  dispatchAcknowledgment,
  dispatchCosOrDesign,
};
