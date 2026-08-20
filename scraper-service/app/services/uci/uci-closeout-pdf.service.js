"use strict";

/**
 * Professional closeout PDF for Agent 12.
 * Sections: cover summary; stage history table; communications; costs; energization evidence;
 * appendix with verbose transition audit.
 */

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { contentHash } = require("./uci-evidence.service.js");

const PAGE_SIZE = [612, 792];
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN * 2;

function winAnsiSafe(text) {
  return String(text ?? "")
    .replace(/\u2192/g, "->")
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function wrapText(text, font, size, maxWidth) {
  const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["-"];
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateOnly(value) {
  if (!value) return "-";
  const raw = String(value);
  const iso = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00.000Z` : iso);
  if (!Number.isFinite(d.getTime())) return winAnsiSafe(raw);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return formatDateOnly(value);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatLifecycleState(state) {
  const map = {
    NOT_STARTED: "Not started",
    IN_PROGRESS: "In progress",
    AWAITING_UTILITY: "Awaiting utility",
    BLOCKED: "Blocked",
    ESCALATED: "Escalated",
    COMPLETED: "Completed",
  };
  return map[String(state || "")] || winAnsiSafe(state || "-");
}

function asRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

function evidenceLabel(value) {
  if (value == null || value === "") return "On file";
  if (typeof value === "object") {
    const row = asRecord(value);
    if (typeof row.label === "string" && row.label.trim()) return winAnsiSafe(row.label);
    if (typeof row.kind === "string" && row.kind.trim()) return winAnsiSafe(row.kind);
    if (row.doc_id || row.document_id) return "Document on file";
    if (row.captured_at) return `Captured ${formatDateTime(row.captured_at)}`;
    return "On file";
  }
  return winAnsiSafe(value);
}

function detectSyntheticContext(params) {
  const { project = {}, record = {}, transitions = [] } = params;
  const meta = asRecord(record.metadata);
  const projectName = String(project.name || project.permit_number || "");
  const scope = String(record.scope_description || "");
  const reasons = [];
  if (meta.synthetic_data_auto_advanced === true) reasons.push("record flagged synthetic auto-advance");
  if (meta.uci_demo === true || meta.demo_mode === true) reasons.push("demo coordination metadata");
  if (/synthetic|uat|test only|demo/i.test(projectName)) reasons.push("project name indicates test/UAT");
  if (/synthetic|uat|test only|demo/i.test(scope)) reasons.push("scope indicates test/UAT");
  for (const t of transitions) {
    const tMeta = asRecord(t.metadata);
    if (tMeta.synthetic_data_auto_advanced === true) {
      reasons.push("lifecycle transition marked synthetic");
      break;
    }
  }
  return reasons.length ? reasons : null;
}

function coordinationStatusLine(record) {
  const stage = record.current_stage != null ? `Stage ${record.current_stage}` : "Stage -";
  const state = formatLifecycleState(record.current_stage_state);
  return `${stage} · ${state}`;
}

function transitionEventLabel(transition) {
  const parts = [];
  if (transition.reason) parts.push(String(transition.reason));
  const meta = asRecord(transition.metadata);
  if (meta.action) parts.push(String(meta.action).replace(/_/g, " "));
  if (transition.triggered_by_type) {
    parts.push(`${transition.triggered_by_type}${transition.triggered_by_id ? ` (${transition.triggered_by_id})` : ""}`);
  }
  return parts.length ? winAnsiSafe(parts.join(" · ")) : "-";
}

function varianceLabel(estimated, actual) {
  const est = Number(estimated);
  const act = Number(actual);
  if (!Number.isFinite(est) || !Number.isFinite(act)) return "-";
  const delta = act - est;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${formatMoney(delta)}`;
}

/**
 * @param {object} params
 * @returns {Promise<{ buffer: Buffer, hash: string, sections: string[] }>}
 */
async function buildCloseoutPdf(params) {
  const {
    project = {},
    provider = {},
    record = {},
    transitions = [],
    communications = [],
    costs = [],
    energization = {},
  } = params;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = new Date().toISOString();
  const syntheticReasons = detectSyntheticContext({ project, record, transitions });
  /** @type {import("pdf-lib").PDFPage[]} */
  const pages = [];

  let page = pdf.addPage(PAGE_SIZE);
  pages.push(page);
  let y = PAGE_SIZE[1] - MARGIN;

  const drawPageNumbers = () => {
    const total = pages.length;
    pages.forEach((p, index) => {
      const label = winAnsiSafe(`Page ${index + 1} of ${total}`);
      const size = 9;
      const width = font.widthOfTextAtSize(label, size);
      p.drawText(label, {
        x: PAGE_SIZE[0] - MARGIN - width,
        y: MARGIN - 22,
        size,
        font,
        color: rgb(0.45, 0.48, 0.52),
      });
    });
  };

  const ensureSpace = (needed = 24) => {
    if (y - needed >= MARGIN) return;
    page = pdf.addPage(PAGE_SIZE);
    pages.push(page);
    y = PAGE_SIZE[1] - MARGIN;
  };

  const writeLines = (text, opts = {}) => {
    const size = opts.size || 10;
    const useBold = opts.bold === true;
    const useFont = useBold ? bold : font;
    const color = opts.color || rgb(0.1, 0.12, 0.16);
    const indent = opts.indent || 0;
    const leading = opts.leading || size + 4;
    const maxWidth = opts.maxWidth || CONTENT_WIDTH - indent;
    for (const row of wrapText(text, useFont, size, maxWidth)) {
      ensureSpace(leading + 4);
      page.drawText(row, {
        x: MARGIN + indent,
        y,
        size,
        font: useFont,
        color,
      });
      y -= leading;
    }
  };

  const heading = (title) => {
    ensureSpace(36);
    y -= 10;
    writeLines(title, { bold: true, size: 13, color: rgb(0.06, 0.24, 0.36), leading: 18 });
    page.drawLine({
      start: { x: MARGIN, y: y + 6 },
      end: { x: MARGIN + CONTENT_WIDTH, y: y + 6 },
      thickness: 0.75,
      color: rgb(0.82, 0.86, 0.9),
    });
    y -= 6;
  };

  const field = (label, value) => {
    writeLines(`${label}: ${value == null || value === "" ? "-" : String(value)}`, { size: 10, leading: 14 });
  };

  const drawTableHeader = (columns) => {
    ensureSpace(22);
    const rowY = y;
    columns.forEach((col) => {
      page.drawText(winAnsiSafe(col.label), {
        x: MARGIN + col.x,
        y: rowY,
        size: 9,
        font: bold,
        color: rgb(0.2, 0.24, 0.3),
      });
    });
    y -= 12;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: MARGIN + CONTENT_WIDTH, y: y + 4 },
      thickness: 0.5,
      color: rgb(0.78, 0.82, 0.86),
    });
    y -= 4;
  };

  const drawTableRow = (columns, values, rowSize = 9) => {
    /** @type {string[][]} */
    const wrapped = values.map((value, index) =>
      wrapText(String(value ?? "-"), font, rowSize, columns[index].width),
    );
    const lines = Math.max(...wrapped.map((rows) => rows.length), 1);
    ensureSpace(lines * (rowSize + 3) + 6);
    for (let line = 0; line < lines; line += 1) {
      columns.forEach((col, index) => {
        const text = wrapped[index][line] || "";
        page.drawText(text, {
          x: MARGIN + col.x,
          y,
          size: rowSize,
          font,
          color: rgb(0.12, 0.14, 0.18),
        });
      });
      y -= rowSize + 3;
    }
    y -= 2;
  };

  // Cover / header
  writeLines("Utility Coordination Closeout Report", {
    bold: true,
    size: 20,
    color: rgb(0.04, 0.2, 0.32),
    leading: 24,
  });
  writeLines("Commun-ET · Energization closeout package", { size: 10, color: rgb(0.35, 0.38, 0.42), leading: 14 });
  y -= 6;

  if (syntheticReasons) {
    writeLines("SYNTHETIC / UAT DATA — Not provider-issued. For validation and audit only.", {
      bold: true,
      size: 10,
      color: rgb(0.72, 0.19, 0.12),
      leading: 14,
    });
    writeLines(syntheticReasons.join("; "), { size: 9, color: rgb(0.72, 0.19, 0.12), leading: 12 });
    y -= 4;
  }

  heading("Project summary");
  field("Project", project.name || project.permit_number || record.project_id);
  field("Utility provider", provider.name || record.utility_type || "-");
  field("Utility type", record.utility_type);
  field("Coordination status", coordinationStatusLine(record));
  field(
    "Energization date",
    formatDateOnly(energization.actual_date || record.energization_actual_date),
  );
  field("Account number", record.utility_account_number);
  field("Scope", record.scope_description);
  field("Typical schedule (P50)", formatDateOnly(record.predicted_p50_date));
  field("Conservative schedule (P90)", formatDateOnly(record.predicted_p90_date));
  field("Report generated", formatDateTime(generatedAt));

  heading("Stage history");
  const stageColumns = [
    { label: "Date", x: 0, width: 88 },
    { label: "Stage", x: 92, width: 52 },
    { label: "Status", x: 148, width: 88 },
    { label: "Event", x: 240, width: CONTENT_WIDTH - 240 },
  ];
  drawTableHeader(stageColumns);
  if (!transitions.length) {
    writeLines("No stage transitions recorded.", { size: 9, leading: 12 });
  } else {
    for (const t of transitions.slice(0, 24)) {
      drawTableRow(stageColumns, [
        formatDateTime(t.created_at),
        `${t.to_stage ?? t.from_stage ?? "-"}`,
        formatLifecycleState(t.to_state),
        transitionEventLabel(t),
      ]);
    }
    if (transitions.length > 24) {
      writeLines(`Showing 24 of ${transitions.length} transitions. See appendix for full audit.`, {
        size: 8,
        color: rgb(0.4, 0.44, 0.48),
        leading: 11,
      });
    }
  }

  heading("Communications");
  const commColumns = [
    { label: "Date", x: 0, width: 88 },
    { label: "Direction", x: 92, width: 64 },
    { label: "Type", x: 160, width: 96 },
    { label: "Subject", x: 260, width: CONTENT_WIDTH - 260 },
  ];
  drawTableHeader(commColumns);
  if (!communications.length) {
    writeLines("No communications recorded.", { size: 9, leading: 12 });
  } else {
    for (const c of communications.slice(0, 30)) {
      drawTableRow(commColumns, [
        formatDateTime(c.message_timestamp || c.created_at),
        c.direction || "-",
        c.classification || "-",
        c.raw_subject || c.subject || "-",
      ]);
    }
  }

  heading("Costs");
  const costColumns = [
    { label: "Type", x: 0, width: 72 },
    { label: "Estimate", x: 76, width: 72 },
    { label: "Actual", x: 152, width: 72 },
    { label: "Variance", x: 228, width: 72 },
    { label: "Paid", x: 304, width: 72 },
    { label: "Billed", x: 380, width: CONTENT_WIDTH - 380 },
  ];
  drawTableHeader(costColumns);
  if (!costs.length) {
    writeLines("No cost rows recorded.", { size: 9, leading: 12 });
  } else {
    for (const cost of costs) {
      drawTableRow(costColumns, [
        cost.cost_type || "-",
        formatMoney(cost.estimated_amount),
        formatMoney(cost.actual_amount),
        varianceLabel(cost.estimated_amount, cost.actual_amount),
        formatDateOnly(cost.paid_at),
        formatDateOnly(cost.client_billed_at),
      ]);
    }
  }

  heading("Energization evidence");
  field("Actual energization date", formatDateOnly(energization.actual_date || record.energization_actual_date));
  field(
    "Target vs actual conflict",
    record.energization_date_conflict === true ? "YES — resolved before closeout" : "None",
  );
  field("Utility confirmation", evidenceLabel(energization.utility_confirmation));
  field("Final meter reading", evidenceLabel(energization.final_meter_reading));
  field("Commissioning sign-off", evidenceLabel(energization.commissioning_signoff));

  heading("Appendix — transition audit");
  if (!transitions.length) {
    writeLines("No transitions to audit.", { size: 9, leading: 12 });
  } else {
    for (const t of transitions) {
      writeLines(
        `${formatDateTime(t.created_at)} · Stage ${t.from_stage ?? "-"} ${formatLifecycleState(t.from_state)} -> Stage ${t.to_stage ?? "-"} ${formatLifecycleState(t.to_state)}`,
        { bold: true, size: 9, leading: 12 },
      );
      writeLines(`Event: ${transitionEventLabel(t)}`, { size: 9, indent: 12, leading: 12 });
      if (t.reason) writeLines(`Reason: ${winAnsiSafe(t.reason)}`, { size: 9, indent: 12, leading: 12 });
      y -= 4;
    }
  }

  drawPageNumbers();

  const bytes = await pdf.save();
  const buffer = Buffer.from(bytes);
  return {
    buffer,
    hash: contentHash(buffer),
    title: "Utility Coordination Closeout Report",
    page_count: pdf.getPageCount(),
    sections: [
      "project_summary",
      "stage_transitions",
      "communications",
      "costs_with_paid_receipts",
      "energization_confirmation",
      "appendix_transition_audit",
    ],
  };
}

module.exports = {
  buildCloseoutPdf,
  formatDateOnly,
  formatDateTime,
};
