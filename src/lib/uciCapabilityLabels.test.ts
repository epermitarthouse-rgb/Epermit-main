import { describe, expect, it } from "vitest";
import {
  formatUciCapabilityLabel,
  formatUciOperatorMessage,
  formatUciPackageVersionLabel,
  formatUciSentSummary,
} from "./uciCapabilityLabels";

describe("uciCapabilityLabels", () => {
  it("maps numeric agent labels to capability names", () => {
    expect(formatUciCapabilityLabel("Agent 3")).toBe("Application Builder");
    expect(formatUciCapabilityLabel("agent_2_load_profile")).toBe("Load Profile Analyzer");
    expect(formatUciCapabilityLabel("agent_1_provider_resolution")).toBe(
      "Utility Provider Mapper",
    );
    expect(formatUciCapabilityLabel("agent_4_submission")).toBe(
      "Submission and Confirmation Tracker",
    );
  });

  it("formats reviewed package snapshot versions", () => {
    expect(formatUciPackageVersionLabel("agent-3-reviewed-package-snapshot-v1")).toBe(
      "Application Builder · Reviewed package v1",
    );
  });

  it("formats a compact sent summary", () => {
    expect(
      formatUciSentSummary({
        completedAt: "2026-08-18T14:15:00.000Z",
        from: "dzahid@commun-et.com",
        to: [{ email: "dzahid@commun-et.com" }],
        attachmentCount: 6,
      }),
    ).toMatch(/^Sent .+ · dzahid@commun-et\.com → dzahid@commun-et\.com · 6 attachments$/);
  });

  it("humanizes internal operator messages", () => {
    expect(
      formatUciOperatorMessage(
        "Live email submission is disabled — set UCI_EMAIL_LIVE_SUBMISSION_ENABLED=true after explicit approval",
      ),
    ).toBe("Email sending is not enabled in this environment.");
    expect(
      formatUciOperatorMessage("Transmission sent via Graph /me/sendMail (Stage 5 not advanced)"),
    ).toBe("Transmission sent");
  });
});
