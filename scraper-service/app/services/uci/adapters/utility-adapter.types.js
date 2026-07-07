"use strict";

/**
 * @typedef {object} AdapterContext
 * @property {string} coordinationRecordId
 * @property {string} projectId
 * @property {string | null} tenantId
 * @property {string} providerSlug
 * @property {string} [syncedAt]
 */

/**
 * @typedef {object} NormalizedApplication
 * @property {string} external_application_id
 * @property {string | null} [external_job_id]
 * @property {string | null} [portal_status]
 * @property {string | null} [portal_milestone]
 * @property {string | null} [portal_last_updated_at]
 * @property {string | null} [portal_submitted_at]
 * @property {boolean} [action_required]
 * @property {string} record_source
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {object} NormalizedCommunication
 * @property {string} external_application_id
 * @property {string | null} [external_message_id]
 * @property {string} idempotency_key
 * @property {string | null} [direction]
 * @property {string} channel
 * @property {string | null} [raw_subject]
 * @property {string | null} [raw_body]
 * @property {string | null} [sender]
 * @property {string | null} [recipient]
 * @property {string | null} [message_timestamp]
 * @property {string | null} [thread_id]
 * @property {boolean} needs_human_attention
 * @property {Record<string, unknown>} agent_processed_metadata
 */

/**
 * @typedef {object} NormalizedStatusEvent
 * @property {string} external_application_id
 * @property {string} idempotency_key
 * @property {string} milestone_type
 * @property {string} status
 * @property {string} source
 * @property {string | null} [portal_status]
 * @property {string | null} [portal_milestone]
 * @property {string | null} [occurred_at]
 * @property {string | null} [actual_date]
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {object} UtilityAdapter
 * @property {string} providerSlug
 * @property {(raw: unknown, context: AdapterContext) => NormalizedApplication | null} normalizeApplication
 * @property {(raw: unknown, context: AdapterContext) => NormalizedCommunication[]} normalizeMessages
 * @property {(raw: unknown, context: AdapterContext) => NormalizedStatusEvent[]} normalizeStatusEvents
 * @property {(raw: unknown) => string | null} getExternalApplicationId
 * @property {(raw: unknown) => string | null} getExternalJobId
 */

module.exports = {};
