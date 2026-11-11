"use strict";

/**
 * DOM extractors for DC ProjectDox HTML partials (see docs/permit-repository/DC_DEEP_EXTRACTION_REQUIREMENTS.md).
 *
 * Each export is a SELF-CONTAINED function that takes the partial's HTML string and returns plain data.
 * They are run with `page.evaluate(fn, html)` in a logged-in page, because Playwright serialises the
 * function source. Nothing may be captured from this module's scope. DOMParser builds an inert document:
 * scripts do not run and no resources load.
 *
 * Personal data: the reviewer's name, contact emails and phone numbers are never read. Reviewer and
 * applicant are returned as roles only.
 */

/**
 * Rendered Reviews tab DOM → rows in the shape consumed by normalize.reviewItems:
 * { ref, department, reviewer, reviewedAt, cycle, status, type, text, responses: [{by, at, text}], responseColumn }.
 * Returns null when there is no `#correctionsGrid`.
 *
 * Only valid on the DOM after the portal's script has filled the grid. The raw `/Project/ProjectCorrections`
 * partial holds row templates only (rows come from GetProjectCorrectionsByCycleInstance), so the live
 * transport reads the JSON instead; this extractor serves parity checks against rendered captures.
 */
function extractCorrectionRows(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const grid = doc.querySelector("#correctionsGrid");
  if (!grid) return null;

  // Visible text: block boundaries become spaces so "</p><p>" does not fuse words.
  const text = (el) => {
    if (!el) return "";
    let out = "";
    const BLOCK = /^(P|BR|DIV|LI|TR|TD|TH|H[1-6]|UL|OL|TABLE)$/;
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue;
      } else if (n.nodeType === 1) {
        const block = BLOCK.test(n.tagName);
        if (block) out += " ";
        for (const c of n.childNodes) walk(c);
        if (block) out += " ";
      }
    };
    walk(el);
    return out.replace(/\s+/g, " ").trim();
  };
  // Free text may quote a mailbox; addresses are scrubbed (contact emails are never persisted).
  const body = (el) => text(el).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]");
  const pad = (n) => String(n).padStart(2, "0");
  // "9/15/25 8:37 AM" → "2025-09-15T08:37:00" (wall clock, no offset; zone handled in normalize.js)
  const toLocalIso = (s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(s || "");
    if (!m) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hour = Number(m[4]) % 12;
    if (/pm/i.test(m[6])) hour += 12;
    return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}T${pad(hour)}:${m[5]}:00`;
  };

  const rowsById = new Map();
  for (const tr of grid.querySelectorAll("tr[correctionid]")) {
    const id = tr.getAttribute("correctionid");
    if (!rowsById.has(id)) rowsById.set(id, []);
    rowsById.get(id).push(tr);
  }

  const out = [];
  for (const [, trs] of rowsById) {
    const first = trs.find((tr) => tr.classList.contains("firstRow")) || trs[0];
    const second = trs[1] || null;
    const third = trs[2] || null;
    const last = trs.find((tr) => tr.classList.contains("lastRow")) || trs[trs.length - 1];

    const refText = text(first.querySelector("td.refColumn"));
    const refMatch = /Ref\.?\s*#\s*(\d+)/i.exec(refText);
    if (!refMatch) throw new Error("correction row without REF #");

    // Reviewer cell: the firstRow cell with both border classes and no own class. Presence only, name not read.
    const reviewerCell = Array.from(first.children).find(
      (td) => td.classList.contains("noborder-left") && td.classList.contains("noborder-right") && !td.classList.contains("datetime"),
    );
    const reviewerPresent = Boolean(reviewerCell && text(reviewerCell));

    const cycleMatch = /(\d+)/.exec(text(first.querySelector("td.cycle")));
    const responseCell = first.querySelector("td.commentResponse");
    const responseClass = responseCell ? responseCell.classList : null;
    const responseColumn = responseClass && responseClass.contains("info-only")
      ? "No response required."
      : responseClass && responseClass.contains("response-required")
        ? "Type your response here."
        : "none";

    const responses = [];
    for (const td of last.querySelectorAll("td.discussions table td")) {
      const label = td.querySelector("span.label");
      const labelText = text(label);
      const by = /reviewer response/i.test(labelText) ? "reviewer" : /responded by/i.test(labelText) ? "applicant" : null;
      if (!by) continue;
      const header = text(label.parentElement);
      const dateMatch = /(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))\s*$/i.exec(header);
      const entryBody = body(td).slice(header.length).trim();
      responses.push({ by, at: dateMatch ? toLocalIso(dateMatch[1]) : null, text: entryBody });
    }
    // DOM is newest-first; the normalizer keeps array order as the response sequence, so store oldest-first.
    responses.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));

    out.push({
      ref: Number(refMatch[1]),
      department: text(first.querySelector("td.department")) || null,
      reviewer: reviewerPresent ? "reviewer" : null,
      reviewedAt: toLocalIso(text(first.querySelector("td.datetime"))),
      cycle: cycleMatch ? Number(cycleMatch[1]) : null,
      status: text(second && second.querySelector("td.status")) || null,
      type: text(third && third.querySelector("td.correctionType")) || text(first.querySelector("td.correctionType")) || null,
      text: body(second && second.querySelector("td.commentText")) || null,
      responses,
      responseColumn,
    });
  }
  return out;
}

/**
 * Project Info partial (`/Project/ProjectInfo`) → allowlisted label values plus the label names seen.
 * Emails and phone numbers are never read. Dates are returned as YYYY-MM-DD. Returns null when the
 * partial has no project info container.
 */
function extractProjectInfoFields(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const container = doc.querySelector("#projectInfoContainer");
  if (!container) return null;

  // Visible text: block boundaries become spaces so "</p><p>" does not fuse words.
  const text = (el) => {
    if (!el) return "";
    let out = "";
    const BLOCK = /^(P|BR|DIV|LI|TR|TD|TH|H[1-6]|UL|OL|TABLE)$/;
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue;
      } else if (n.nodeType === 1) {
        const block = BLOCK.test(n.tagName);
        if (block) out += " ";
        for (const c of n.childNodes) walk(c);
        if (block) out += " ";
      }
    };
    walk(el);
    return out.replace(/\s+/g, " ").trim();
  };
  const ALLOWED = {
    "Description": "description",
    "Location": "address",
    "Contact": "contactOrg",
    "Project Owner": "ownerOrg",
    "Job Class": "jobClass",
    "Status": "statusRaw",
    "Review Cycle": "reviewCycle",
    "Project Start/End": "startEnd",
    "Latitude": "latitude",
    "Longitude": "longitude",
  };

  const values = {};
  const labelsSeen = [];
  for (const tr of container.querySelectorAll("table.project-fields tr")) {
    const th = tr.querySelector("th");
    if (!th) continue;
    const label = text(th).replace(/:$/, "").trim();
    labelsSeen.push(label);
    const key = ALLOWED[label];
    if (!key) continue;
    const td = tr.querySelector("td");
    if (key === "startEnd") {
      const spans = Array.from(td.querySelectorAll("span.start-date"));
      const pick = (word) => {
        const s = spans.find((x) => new RegExp(word, "i").test(text(x.querySelector(".start-date-label"))));
        if (!s) return null;
        const v = text(s).replace(new RegExp(`^${word}:?\\s*`, "i"), "").trim();
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
        return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
      };
      values.startDate = pick("Start");
      values.endDate = pick("End");
      continue;
    }
    values[key] = text(td) || null;
  }
  return { values, labelsSeen };
}

/**
 * SSRS "Plan Review - Review Comments" viewer page (`/WebForms/ReportViewer.aspx?ReportID=14...`) →
 * { rows, totalPages, projectName, workflowStartedAt, generatedAt } or null when no Review Comments table
 * is present. Rows use the normalize.reviewItems shape.
 *
 * SSRS class names are generated per render, so the table is found by its seven header texts (same
 * classification as lib/reviewCommentsExcelStructuredRows.js) and cells are read by column index.
 * REVIEWED BY is "DEPT<br>NAME<br>M/D/YY h:mm AM": the name line is skipped. DISCUSSION entries start with
 * "Responded by: NAME - <date>" (applicant) or "Reviewer Response: NAME - <date>" (reviewer); the name is
 * skipped and entries are separated by a dashed line.
 */
function extractReviewCommentsReport(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");

  // Visible lines: <br> and block boundaries end a line.
  const lines = (el) => {
    if (!el) return [];
    let out = "";
    const BLOCK = /^(P|DIV|LI|TR|TD|TH|H[1-6]|UL|OL|TABLE)$/;
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue.replace(/\u00a0/g, " ");
      } else if (n.nodeType === 1) {
        if (n.tagName === "BR") {
          out += "\n";
          return;
        }
        const block = BLOCK.test(n.tagName);
        if (block) out += "\n";
        for (const c of n.childNodes) walk(c);
        if (block) out += "\n";
      }
    };
    walk(el);
    return out.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  };
  const scrub = (s) => s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]");
  const pad = (n) => String(n).padStart(2, "0");
  const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i;
  const toLocalIso = (s) => {
    const m = DATE_RE.exec(s || "");
    if (!m) return null;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hour = Number(m[4]) % 12;
    if (/pm/i.test(m[7])) hour += 12;
    return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}T${pad(hour)}:${m[5]}:${m[6] || "00"}`;
  };
  const classify = (t) => {
    const h = t.replace(/\s+/g, " ").trim().toUpperCase();
    if (/^REF\s*#?$/.test(h.replace(/\./g, ""))) return "ref";
    if (h === "CYCLE") return "cycle";
    if (h === "REVIEWED BY") return "reviewedBy";
    if (h === "TYPE") return "type";
    if (h === "FILENAME") return "filename";
    if (h === "DISCUSSION") return "discussion";
    if (h === "STATUS") return "status";
    return null;
  };
  const KEYS = ["ref", "cycle", "reviewedBy", "type", "filename", "discussion", "status"];

  let header = null;
  let columns = null;
  for (const tr of doc.querySelectorAll("tr")) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const map = {};
    cells.forEach((c, i) => {
      const k = classify(c.textContent || "");
      if (k && map[k] === undefined) map[k] = i;
    });
    if (KEYS.every((k) => map[k] !== undefined)) {
      header = tr;
      columns = map;
      break;
    }
  }
  if (!header) return null;

  const rows = [];
  for (let tr = header.nextElementSibling; tr; tr = tr.nextElementSibling) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const cell = (k) => cells[columns[k]] || null;
    const refText = lines(cell("ref")).join(" ");
    if (!/^\d+$/.test(refText)) continue;

    const reviewed = lines(cell("reviewedBy"));
    const reviewedDate = reviewed.slice(1).find((l) => DATE_RE.test(l)) || null;
    const typeLines = lines(cell("type"));
    const cycleMatch = /^(\d+)$/.exec(lines(cell("cycle")).join(" "));
    const fileName = lines(cell("filename")).join(" ") || null;
    const status = lines(cell("status")).join(" ") || null;

    const responses = [];
    let current = null;
    for (const line of lines(cell("discussion"))) {
      if (/^-{5,}$/.test(line)) {
        current = null;
        continue;
      }
      const head = /^(Responded by|Reviewer Response):/i.exec(line);
      if (head) {
        current = { by: /reviewer/i.test(head[1]) ? "reviewer" : "applicant", at: toLocalIso(line), text: "" };
        responses.push(current);
        continue;
      }
      if (current) current.text = current.text ? `${current.text} ${scrub(line)}` : scrub(line);
    }
    responses.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));

    rows.push({
      ref: Number(refText),
      department: reviewed[0] || null,
      reviewer: reviewed.length >= 3 ? "reviewer" : null,
      reviewedAt: toLocalIso(reviewedDate),
      cycle: cycleMatch ? Number(cycleMatch[1]) : null,
      status,
      type: typeLines[0] || null,
      text: scrub(typeLines.slice(1).join(" ")) || null,
      fileName,
      responses: responses.map((r) => ({ by: r.by, at: r.at, text: r.text || null })),
      responseColumn: status === "Info Only" ? "No response required." : "none",
    });
  }

  const pagesEl = doc.querySelector('[id$="_TotalPages"]');
  const pagesMatch = /^(\d+)$/.exec(((pagesEl && pagesEl.textContent) || "").trim());
  const bodyText = lines(doc.body).join("\n");
  const after = (label, re) => {
    const m = new RegExp(`${label}:\\s*\\n?\\s*(${re})`, "i").exec(bodyText);
    return m ? m[1] : null;
  };
  return {
    rows,
    totalPages: pagesMatch ? Number(pagesMatch[1]) : null,
    projectName: after("Project Name", "[A-Z0-9-]+"),
    workflowStartedAt: toLocalIso(after("Workflow Started", "\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+\\d{1,2}:\\d{2}:\\d{2}\\s*[AP]M")),
    generatedAt: toLocalIso(after("Report Generated", "\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s+\\d{1,2}:\\d{2}\\s*[AP]M")),
  };
}

module.exports = { extractCorrectionRows, extractProjectInfoFields, extractReviewCommentsReport };
