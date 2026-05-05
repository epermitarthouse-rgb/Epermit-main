"use strict";

/**
 * Business-day helpers for QuickBooks due dates (offline; no API calls).
 *
 * Rules:
 * - Monday–Friday are business days; Saturday and Sunday are skipped.
 * - The start (invoice) date is never counted toward `businessDays`.
 * - Counting begins on the calendar day after `startDate`.
 */

function stripToLocalCalendarDate(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * @param {Date | string} input
 * @returns {Date}
 */
function parseInputDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error("Invalid date: Date object is NaN.");
    }
    return stripToLocalCalendarDate(input);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Invalid date: empty string.");

    const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) {
      const y = Number(ymd[1]);
      const m = Number(ymd[2]) - 1;
      const day = Number(ymd[3]);
      const dt = new Date(y, m, day);
      if (
        dt.getFullYear() !== y ||
        dt.getMonth() !== m ||
        dt.getDate() !== day
      ) {
        throw new Error(
          `Invalid date: "${trimmed}" is not a valid calendar date.`,
        );
      }
      return dt;
    }

    const dt = new Date(trimmed);
    if (Number.isNaN(dt.getTime())) {
      throw new Error(`Invalid date: "${trimmed}".`);
    }
    return stripToLocalCalendarDate(dt);
  }

  throw new Error(`Invalid date: expected Date or string, got ${typeof input}.`);
}

function addCalendarDays(date, delta) {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  out.setDate(out.getDate() + delta);
  return out;
}

function isBusinessDay(date) {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD (local calendar)
 */
function formatYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Advance `businessDays` weekdays starting the calendar day after `startDate`.
 * `startDate` itself does not consume any of those days.
 *
 * @param {Date | string} startDate
 * @param {number} businessDays non-negative integer
 * @returns {string} YYYY-MM-DD
 */
function addBusinessDays(startDate, businessDays) {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error("businessDays must be a non-negative integer.");
  }

  const start = parseInputDate(startDate);

  if (businessDays === 0) {
    return formatYYYYMMDD(start);
  }

  let cursor = addCalendarDays(start, 1);
  let remaining = businessDays;

  while (remaining > 0) {
    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
    if (remaining > 0) {
      cursor = addCalendarDays(cursor, 1);
    }
  }

  return formatYYYYMMDD(cursor);
}

/**
 * Net 10 business days from invoice date (start date excluded from count).
 *
 * @param {Date | string} [invoiceDate=new Date()]
 * @returns {string} YYYY-MM-DD
 */
function getNet10BusinessDayDueDate(invoiceDate = new Date()) {
  return addBusinessDays(invoiceDate, 10);
}

module.exports = {
  parseInputDate,
  addBusinessDays,
  getNet10BusinessDayDueDate,
  formatYYYYMMDD,
};

/*
 * Examples (local timezone):
 *
 *   addBusinessDays('2026-05-01', 0) → '2026-05-01'   (Thursday sample / depends on TZ)
 *   addBusinessDays('2026-05-01', 1) → first weekday strictly after 2026-05-01
 *   getNet10BusinessDayDueDate('2026-05-05') → 10 weekdays after 2026-05-06's counting window
 *
 * Manual log:
 *   cd scraper-service && node app/services/quickbooks/qb-due-dates.js
 */

if (require.main === module) {
  /* eslint-disable no-console */
  const samples = [
    ["2026-05-01", 0],
    ["2026-05-01", 1],
    ["2026-05-05", 10],
  ];
  console.log("[qb-due-dates] sample outputs:");
  for (const [start, n] of samples) {
    console.log(
      `  addBusinessDays(${JSON.stringify(start)}, ${n}) →`,
      addBusinessDays(start, n),
    );
  }
  console.log(
    "  getNet10BusinessDayDueDate('2026-05-05') →",
    getNet10BusinessDayDueDate("2026-05-05"),
  );
}
