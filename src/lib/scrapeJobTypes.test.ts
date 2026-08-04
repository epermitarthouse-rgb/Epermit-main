import { describe, expect, it } from "vitest";
import {
  isScrapeJobTerminal,
  SCRAPE_JOB_TERMINAL_STATUSES,
  scrapeOutcomeFromJobStatus,
} from "@/lib/scrapeJobTypes";
import { ARLINGTON_ACTIVE_JOB_STATUSES } from "@/lib/arlingtonScrapeJobIdentity";

describe("scrape job terminal status consistency", () => {
  it("partial_external_blocker and completed_with_warnings are terminal", () => {
    expect(isScrapeJobTerminal("partial_external_blocker")).toBe(true);
    expect(isScrapeJobTerminal("completed_with_warnings")).toBe(true);
    expect(SCRAPE_JOB_TERMINAL_STATUSES).toContain("partial_external_blocker");
    expect(SCRAPE_JOB_TERMINAL_STATUSES).toContain("completed_with_warnings");
  });

  it("terminal partial statuses are not Arlington active lookup statuses", () => {
    expect(ARLINGTON_ACTIVE_JOB_STATUSES).not.toContain("partial_external_blocker");
    expect(ARLINGTON_ACTIVE_JOB_STATUSES).not.toContain("completed_with_warnings");
    expect(ARLINGTON_ACTIVE_JOB_STATUSES).not.toContain("cancelled");
  });

  it("maps terminal partial outcomes to done for intake chain", () => {
    expect(scrapeOutcomeFromJobStatus("completed_with_warnings")).toBe("done");
    expect(scrapeOutcomeFromJobStatus("partial_external_blocker")).toBe("done");
  });
});
