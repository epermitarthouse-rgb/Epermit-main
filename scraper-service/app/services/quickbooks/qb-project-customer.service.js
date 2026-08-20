"use strict";

const qbApi = require("./qb-api.service.js");

function validateProjectClientPresent(project) {
  const name = project?.client_name != null ? String(project.client_name).trim() : "";
  const email =
    project?.client_email != null ? String(project.client_email).trim() : "";
  return name.length > 0 || email.length > 0;
}

function projectClientDisplayName(project) {
  return (
    (project?.client_name != null && String(project.client_name).trim()) ||
    (project?.client_email != null
      ? String(project.client_email).split("@")[0].trim()
      : "") ||
    ""
  );
}

function projectClientEmail(project) {
  return project?.client_email != null && String(project.client_email).trim()
    ? String(project.client_email).trim()
    : undefined;
}

/**
 * Canonical project → QuickBooks customer resolution (Billing + UCI).
 * Reuses projects.qb_customer_id when set; otherwise getOrCreateCustomer + persist.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} project
 * @param {object} [opts]
 */
async function resolveProjectQbCustomerId(supabase, project, opts = {}) {
  const projectId = String(project?.id || opts.projectId || "").trim();
  let customerId =
    project?.qb_customer_id != null && String(project.qb_customer_id).trim()
      ? String(project.qb_customer_id).trim()
      : opts.qbCustomerId != null && String(opts.qbCustomerId).trim()
        ? String(opts.qbCustomerId).trim()
        : "";

  if (customerId) return customerId;

  if (!validateProjectClientPresent(project)) {
    throw Object.assign(
      new Error("Project must have client_name and/or client_email."),
      { code: "quickbooks_customer_missing" },
    );
  }

  const displayName = projectClientDisplayName(project) || "Customer";
  const email = projectClientEmail(project);

  const createCustomerFn =
    typeof opts.getOrCreateCustomerFn === "function"
      ? opts.getOrCreateCustomerFn
      : (createOpts) => qbApi.getOrCreateCustomer(supabase, createOpts);

  let cust;
  try {
    cust = await createCustomerFn({ name: displayName, email });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`QuickBooks customer resolution failed: ${message}`), {
      code: "quickbooks_customer_missing",
    });
  }

  customerId = cust?.id != null ? String(cust.id).trim() : "";
  if (!customerId) {
    throw Object.assign(new Error("QuickBooks customer resolution failed: missing customer id."), {
      code: "quickbooks_customer_missing",
    });
  }

  if (projectId) {
    const { error } = await supabase
      .from("projects")
      .update({ qb_customer_id: customerId })
      .eq("id", projectId);
    if (error) {
      throw Object.assign(new Error(`Failed to save qb_customer_id: ${error.message}`), {
        code: "QB_CUSTOMER_SAVE_FAILED",
      });
    }
  }

  return customerId;
}

module.exports = {
  validateProjectClientPresent,
  projectClientDisplayName,
  projectClientEmail,
  resolveProjectQbCustomerId,
};
