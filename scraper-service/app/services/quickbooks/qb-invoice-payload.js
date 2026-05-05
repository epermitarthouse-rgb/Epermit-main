"use strict";

const {
  getNet10BusinessDayDueDate,
  formatYYYYMMDD,
  parseInputDate,
} = require("./qb-due-dates.js");

const MILESTONE_LABELS = {
  M1: "Initial / project setup milestone",
  M2: "Review / progress milestone",
  M3: "Final / issuance milestone",
};

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function assertNonEmptyString(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }
}

function qbSalesLine({ description, amount, qbItemId }) {
  const unitPrice = roundMoney(amount);
  return {
    DetailType: "SalesItemLineDetail",
    Amount: unitPrice,
    Description: description,
    SalesItemLineDetail: {
      ItemRef: { value: String(qbItemId) },
      Qty: 1,
      UnitPrice: unitPrice,
    },
  };
}

/**
 * Build a QuickBooks Online Invoice-shaped object (offline — not POSTed).
 *
 * @param {{
 *   project: {
 *     name: string,
 *     permit_number?: string | null,
 *     contract_value: number,
 *     service_type?: string | null,
 *   },
 *   milestone: 'M1'|'M2'|'M3',
 *   milestonePct: number,
 *   reimbursementAmount: number,
 *   reimbursementDescription?: string | null,
 *   qbCustomerId: string,
 *   qbItemId: string,
 *   invoiceDate: Date | string,
 * }} params
 * @returns {{
 *   payload: Record<string, unknown>,
 *   totals: {
 *     baseMilestoneAmount: number,
 *     reimbursementAmount: number,
 *     adminFeeAmount: number,
 *     totalInvoiceAmount: number,
 *   },
 * }}
 */
function generateInvoicePayload(params) {
  if (!params || typeof params !== "object") {
    throw new Error("generateInvoicePayload: invalid params.");
  }

  const {
    project,
    milestone,
    milestonePct,
    reimbursementAmount,
    reimbursementDescription,
    qbCustomerId,
    qbItemId,
    invoiceDate,
  } = params;

  if (!project || typeof project !== "object") {
    throw new Error("project is required.");
  }

  const contractValue = Number(project.contract_value);
  if (!Number.isFinite(contractValue) || contractValue <= 0) {
    throw new Error("project.contract_value must be a number greater than 0.");
  }

  const pct = Number(milestonePct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
    throw new Error("milestonePct must be between 0 and 1 (inclusive).");
  }

  const milestoneKey =
    typeof milestone === "string" ? milestone.trim().toUpperCase() : "";
  if (!MILESTONE_LABELS[milestoneKey]) {
    throw new Error(
      `milestone must be one of: ${Object.keys(MILESTONE_LABELS).join(", ")}.`,
    );
  }

  assertNonEmptyString(qbCustomerId, "qbCustomerId");
  assertNonEmptyString(qbItemId, "qbItemId");

  const reimburseRaw = Number(reimbursementAmount);
  if (!Number.isFinite(reimburseRaw) || reimburseRaw < 0) {
    throw new Error("reimbursementAmount cannot be negative.");
  }

  const reimbursement = roundMoney(reimburseRaw);
  if (reimbursement > 0) {
    assertNonEmptyString(
      reimbursementDescription,
      "reimbursementDescription",
    );
  }

  const invDateParsed = parseInputDate(invoiceDate);
  const TxnDate = formatYYYYMMDD(invDateParsed);
  const DueDate = getNet10BusinessDayDueDate(invoiceDate);

  const milestoneTitle = MILESTONE_LABELS[milestoneKey];
  const permitRef =
    project.permit_number != null && String(project.permit_number).trim()
      ? String(project.permit_number).trim()
      : "(no permit number)";
  const projectName =
    project.name != null && String(project.name).trim()
      ? String(project.name).trim()
      : "(unnamed project)";
  const serviceType =
    project.service_type != null && String(project.service_type).trim()
      ? String(project.service_type).trim()
      : "Permit management";

  const baseMilestoneAmount = roundMoney(contractValue * pct);
  const adminFeeAmount =
    reimbursement > 0 ? roundMoney(reimbursement * 0.15) : 0;

  const Line = [];

  Line.push(
    qbSalesLine({
      qbItemId,
      amount: baseMilestoneAmount,
      description: `${milestoneTitle} — ${serviceType} (${milestoneKey})`,
    }),
  );

  if (reimbursement > 0) {
    Line.push(
      qbSalesLine({
        qbItemId,
        amount: reimbursement,
        description: String(reimbursementDescription).trim(),
      }),
    );
    Line.push(
      qbSalesLine({
        qbItemId,
        amount: adminFeeAmount,
        description: "Administrative fee (15% on reimbursable expenses)",
      }),
    );
  }

  const totalInvoiceAmount = roundMoney(
    baseMilestoneAmount + reimbursement + adminFeeAmount,
  );

  const CustomerMemo =
    `Permit ${permitRef} — ${projectName}`.slice(0, 400);

  const PrivateNote =
    [
      `Project: ${projectName}`,
      `Permit: ${permitRef}`,
      `Milestone: ${milestoneKey} (${milestoneTitle})`,
      `Service type: ${serviceType}`,
      `TxnDate: ${TxnDate}`,
      `DueDate (Net 10 business days): ${DueDate}`,
    ].join(" | ").slice(0, 4000);

  const payload = {
    CustomerRef: { value: String(qbCustomerId).trim() },
    TxnDate,
    DueDate,
    CustomerMemo,
    PrivateNote,
    Line,
  };

  return {
    payload,
    totals: {
      baseMilestoneAmount,
      reimbursementAmount: reimbursement,
      adminFeeAmount,
      totalInvoiceAmount,
    },
  };
}

module.exports = {
  generateInvoicePayload,
  MILESTONE_LABELS,
};

/*
 * Manual check (no test runner):
 *   cd scraper-service && node -e "const {generateInvoicePayload}=require('./app/services/quickbooks/qb-invoice-payload'); console.log(JSON.stringify(generateInvoicePayload({project:{name:'Test',permit_number:'T',contract_value:10000},milestone:'M1',milestonePct:0.4,reimbursementAmount:100,reimbursementDescription:'Fee',qbCustomerId:'1',qbItemId:'2',invoiceDate:'2026-05-05'}),null,2))"
 */

if (require.main === module) {
  /* eslint-disable no-console */
  const demo = generateInvoicePayload({
    project: {
      name: "Test Project",
      permit_number: "TEST-123",
      contract_value: 10000,
      service_type: "Permit management",
    },
    milestone: "M1",
    milestonePct: 0.4,
    reimbursementAmount: 100,
    reimbursementDescription: "City filing fee",
    qbCustomerId: "123",
    qbItemId: "456",
    invoiceDate: "2026-05-05",
  });
  console.log("[qb-invoice-payload] demo totals:", demo.totals);
  console.log("[qb-invoice-payload] demo TxnDate / DueDate:", demo.payload.TxnDate, demo.payload.DueDate);
}
