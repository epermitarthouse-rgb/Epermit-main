import { describe, expect, it } from "vitest";
import {
  buildArlingtonScopeKey,
  normalizeArlingtonPermitNumber,
  normalizeArlingtonRequestedScope,
} from "@/lib/arlingtonScrapeJobIdentity";

describe("arlingtonScrapeJobIdentity", () => {
  it("matches backend scope key for full scrape", () => {
    const scope = normalizeArlingtonRequestedScope({
      tabs: ["info", "attachments", "plan_review"],
      planReviewScope: "all",
      autoContinueDownloads: true,
    });
    expect(buildArlingtonScopeKey(scope)).toBe(
      "tabs=attachments,info,plan_review|pr=all|att=1|dl=1|docs=1",
    );
  });

  it("normalizes permit numbers consistently", () => {
    expect(normalizeArlingtonPermitNumber(" cnew24-00737-ra2 ")).toBe("CNEW24-00737-RA2");
  });
});
