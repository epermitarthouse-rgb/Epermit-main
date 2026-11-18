"use strict";

/**
 * Montgomery County MD ProjectDox normalizers. The Web API payloads have the DC shapes (capture 2026-11-18), so
 * every section normalizer is the shared one; only the adapter key, the jurisdiction, the status vocabulary and
 * discovery (the projects grid JSON instead of the DC dashboard table) differ.
 */

const shared = require("../dc-projectdox/normalize");
const { MONTGOMERY } = require("../projectdox-tenants");

const ADAPTER_KEY = MONTGOMERY.key;
const JURISDICTION = MONTGOMERY.jurisdiction;

/** Project statuses seen on the portal; anything else is "other" with the portal text kept in status_raw. */
const STATUS_MAP = Object.freeze({
  "pending upload": "upload",
  "in review": "in_review",
  "preapproval corrections": "resubmit",
  approved: "approved",
});

/** Permit numbers on the portal: COMBUILD-1154415, SIGN-1159714. */
const PERMIT_NUMBER = /^[A-Z]{2,12}-\d{4,9}$/;

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function mapStatus(raw) {
  const s = str(raw);
  if (!s) return null;
  return STATUS_MAP[s.toLowerCase()] || "other";
}

/** Status JSON → permit fields, with the Montgomery status vocabulary. */
function statusFields(data) {
  return { ...shared.statusFields(data), status: mapStatus(data && data.ProjectStatus) };
}

/** GetPagedActiveProjects → listing rows ({ permit, projectId, status, templateId, ... }), templates excluded. */
function rowsFromPagedProjects(data) {
  const items = data && Array.isArray(data.Items) ? data.Items : null;
  if (!items) return null;
  return items
    .filter((p) => p && p.IsProjectTemplate !== true)
    .map((p) => ({
      permit: str(p.Name),
      projectId: str(p.ProjectID),
      status: str(p.Status),
      templateId: str(p.ProjectTemplateID),
      templateName: str(p.ProjectTemplateName),
      description: str(p.Description),
      address: [p.Address1, p.City, p.State, p.PostalCode].map(str).filter(Boolean).join(", ") || str(p.Location),
    }));
}

/**
 * Listing row → discovery record. A row whose name is not a portal permit number is refused, so a project the
 * portal names differently is reported as skipped instead of being stored under a made-up identity.
 */
function discoveryRecord(row) {
  const portalId = str(row.projectId ?? row.ProjectID);
  if (!portalId || !/^\d{1,12}$/.test(portalId)) throw new Error(`project row ${row.permit || "?"} has no ProjectID`);
  const permit = str(row.permit);
  if (!permit || !PERMIT_NUMBER.test(permit.toUpperCase())) throw new Error(`project row ${portalId} has no portal permit number`);
  return {
    portal_record_id: portalId,
    fields: {
      jurisdiction: JURISDICTION,
      permit_number: permit.toUpperCase(),
      permit_number_normalized: shared.normalizePermitNumber(permit),
      status: mapStatus(row.status),
      status_raw: str(row.status),
      title: str(row.title),
      description: str(row.description),
      address: str(row.address),
    },
  };
}

module.exports = {
  ...shared,
  ADAPTER_KEY,
  JURISDICTION,
  STATUS_MAP,
  PERMIT_NUMBER,
  mapStatus,
  statusFields,
  rowsFromPagedProjects,
  discoveryRecord,
};
