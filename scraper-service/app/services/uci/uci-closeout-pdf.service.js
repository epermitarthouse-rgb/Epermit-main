"use strict";

/**
 * Five-section closeout PDF for Agent 12.
 * Sections: project summary; stage transitions; comms; costs with paid receipts; energization confirmation.
 */

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { contentHash } = require("./uci-evidence.service.js");

function winAnsiSafe(text) {
  return String(text || "")
    .replace(/\u2192/g, "->")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function line(value) {
  if (value == null || value === "") return "-";
  if (typeof value === "object") return winAnsiSafe(JSON.stringify(value));
  return winAnsiSafe(value);
}

function wrapText(text, max = 92) {
  const words = String(text || "").split(/\s+/);
  /** @type {string[]} */
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${winAnsiSafe(word)}` : winAnsiSafe(word);
    if (next.length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["—"];
}

/**
 * @param {object} params
 * @returns {Promise<{ buffer: Buffer, hash: string, sections: string[] }>}
 */
async function buildCloseoutPdf(params) {
  const {
    project = {},
    record = {},
    transitions = [],
    communications = [],
    costs = [],
    energization = {},
  } = params;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 760;

  const ensureSpace = (needed = 24) => {
    if (y < needed) {
      page = pdf.addPage([612, 792]);
      y = 760;
    }
  };

  const write = (text, opts = {}) => {
    const size = opts.size || 11;
    const useBold = opts.bold === true;
    const color = opts.color || rgb(0.1, 0.12, 0.16);
    for (const row of wrapText(winAnsiSafe(text), opts.max || 92)) {
      ensureSpace(18);
      page.drawText(row, {
        x: opts.x || 48,
        y,
        size,
        font: useBold ? bold : font,
        color,
      });
      y -= opts.leading || 14;
    }
  };

  const section = (title) => {
    y -= 8;
    ensureSpace(28);
    write(title, { bold: true, size: 14, leading: 20 });
  };

  write("Utility Coordination Closeout Package", { bold: true, size: 18, leading: 22 });
  write("Five-section energization closeout - Commun-ET", { size: 10, leading: 16 });

  section("1. Project summary");
  write(`Project: ${line(project.name || project.permit_number || record.project_id)}`);
  write(`Coordination record: ${line(record.id)}`);
  write(`Utility type: ${line(record.utility_type)}`);
  write(`Scope: ${line(record.scope_description)}`);
  write(`Account: ${line(record.utility_account_number)}`);
  write(`Stage: ${line(record.current_stage)} ${line(record.current_stage_state)}`);
  write(`Typical (P50): ${line(record.predicted_p50_date)}  Conservative (P90): ${line(record.predicted_p90_date)}`);

  section("2. Stage transitions");
  if (!transitions.length) write("No transitions recorded.");
  for (const t of transitions) {
    write(
      `${line(t.created_at)}  ${line(t.from_stage)}/${line(t.from_state)} -> ${line(t.to_stage)}/${line(t.to_state)}  ${line(t.reason)}`,
      { size: 9, leading: 12 },
    );
  }

  section("3. Communications");
  if (!communications.length) write("No communications recorded.");
  for (const c of communications) {
    write(
      `${line(c.message_timestamp || c.created_at)}  ${line(c.direction)}  ${line(c.classification)}  ${line(c.raw_subject)}`,
      { size: 9, leading: 12 },
    );
  }

  section("4. Costs with paid receipts");
  if (!costs.length) write("No cost rows recorded.");
  for (const cost of costs) {
    write(
      `${line(cost.cost_type)}  est ${line(cost.estimated_amount)}  actual ${line(cost.actual_amount)}  paid ${line(cost.paid_at)}  billed ${line(cost.client_billed_at)}  receipt ${line(cost.invoice_received_doc_ref || cost.paid_receipt_doc_ref || cost.payment_method)}`,
      { size: 9, leading: 12 },
    );
  }

  section("5. Energization confirmation");
  write(`Actual energization date: ${line(energization.actual_date || record.energization_actual_date)}`);
  write(`Date conflict: ${record.energization_date_conflict === true ? "YES — blocked" : "none"}`);
  write(`Utility confirmation: ${line(energization.utility_confirmation || "on file")}`);
  write(`Final meter reading: ${line(energization.final_meter_reading || "on file")}`);
  write(`Commissioning sign-off: ${line(energization.commissioning_signoff || "on file")}`);

  const bytes = await pdf.save();
  const buffer = Buffer.from(bytes);
  return {
    buffer,
    hash: contentHash(buffer),
    sections: [
      "project_summary",
      "stage_transitions",
      "communications",
      "costs_with_paid_receipts",
      "energization_confirmation",
    ],
  };
}

module.exports = {
  buildCloseoutPdf,
};
