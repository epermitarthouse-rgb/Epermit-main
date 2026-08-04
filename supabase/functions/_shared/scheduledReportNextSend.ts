/**
 * Timezone-aware next-run calculation for scheduled checklist reports.
 * Pure helpers — safe for Deno edge functions and Node/Vite (via src re-export).
 */

export type ReportFrequency = "weekly" | "monthly";

export interface NextSendScheduleInput {
  frequency: ReportFrequency;
  dayOfWeek?: number | null; // 0=Sun .. 6=Sat
  dayOfMonth?: number | null; // 1-28
  sendTime: string; // HH:mm or HH:mm:ss
  timezone: string; // IANA
  /** Instant after which the next run must fall (exclusive). Defaults to now. */
  after?: Date;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun .. 6=Sat
}

function parseSendTime(sendTime: string): { hour: number; minute: number; second: number } {
  const parts = (sendTime || "09:00:00").split(":").map((p) => Number(p));
  const hour = Number.isFinite(parts[0]) ? Math.min(23, Math.max(0, parts[0])) : 9;
  const minute = Number.isFinite(parts[1]) ? Math.min(59, Math.max(0, parts[1])) : 0;
  const second = Number.isFinite(parts[2]) ? Math.min(59, Math.max(0, parts[2])) : 0;
  return { hour, minute, second };
}

function getZonedParts(date: Date, timeZone: string): WallParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });

  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  let hour = Number(map.hour);
  if (hour === 24) hour = 0;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Iterates to converge across DST transitions.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(desiredAsUtcMs);

  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(instant, timeZone);
    const actualAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = desiredAsUtcMs - actualAsUtcMs;
    if (diff === 0) break;
    instant = new Date(instant.getTime() + diff);
  }

  return instant;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function addMonthsClamped(
  year: number,
  month: number,
  day: number,
  monthsToAdd: number,
): { year: number; month: number; day: number } {
  const total = year * 12 + (month - 1) + monthsToAdd;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { year: y, month: m, day };
}

/**
 * Returns the next send instant as a UTC ISO string, strictly after `after`.
 * Uses weekly day_of_week / monthly day_of_month, send_time, and IANA timezone (DST-safe).
 */
export function computeNextSendAt(input: NextSendScheduleInput): string {
  const after = input.after ?? new Date();
  const timeZone = input.timezone || "UTC";
  const { hour, minute, second } = parseSendTime(input.sendTime);
  const afterParts = getZonedParts(after, timeZone);

  if (input.frequency === "weekly") {
    const targetDay = ((input.dayOfWeek ?? 1) % 7 + 7) % 7;
    let daysAhead = (targetDay - afterParts.weekday + 7) % 7;
    let wall = addCalendarDays(afterParts.year, afterParts.month, afterParts.day, daysAhead);
    let candidate = zonedWallTimeToUtc(
      wall.year,
      wall.month,
      wall.day,
      hour,
      minute,
      second,
      timeZone,
    );

    let guard = 0;
    while (candidate.getTime() <= after.getTime() && guard < 8) {
      wall = addCalendarDays(wall.year, wall.month, wall.day, 7);
      candidate = zonedWallTimeToUtc(
        wall.year,
        wall.month,
        wall.day,
        hour,
        minute,
        second,
        timeZone,
      );
      guard++;
    }

    return candidate.toISOString();
  }

  const targetDom = Math.min(28, Math.max(1, input.dayOfMonth ?? 1));
  let year = afterParts.year;
  let month = afterParts.month;
  let candidate = zonedWallTimeToUtc(year, month, targetDom, hour, minute, second, timeZone);

  let guard = 0;
  while (candidate.getTime() <= after.getTime() && guard < 14) {
    const next = addMonthsClamped(year, month, targetDom, 1);
    year = next.year;
    month = next.month;
    candidate = zonedWallTimeToUtc(year, month, targetDom, hour, minute, second, timeZone);
    guard++;
  }

  return candidate.toISOString();
}

/** Build Resend `from` header from REPORTS_FROM_EMAIL (or fallback). */
export function resolveReportsFromEmail(
  envFrom: string | undefined | null,
  displayName = "Insight|DesignCheck",
): string {
  const raw = (envFrom || "").trim();
  if (!raw) {
    return `${displayName} <reports@localhost.invalid>`;
  }
  if (raw.includes("<") && raw.includes(">")) {
    return raw;
  }
  return `${displayName} <${raw}>`;
}
