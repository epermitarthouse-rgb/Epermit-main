import { describe, expect, it } from "vitest";
import { pepcoDocumentViewErrorMessage } from "@/lib/uciApi";

describe("pepcoDocumentViewErrorMessage", () => {
  it("returns null when the preview opens successfully", () => {
    expect(pepcoDocumentViewErrorMessage({ ok: true })).toBeNull();
  });

  it("returns the generic message for API failures", () => {
    expect(pepcoDocumentViewErrorMessage({ ok: false, reason: "api_error" })).toBe(
      "The PEPCO document could not be opened for viewing.",
    );
  });

  it("returns a popup-blocked message instead of the generic route failure", () => {
    expect(pepcoDocumentViewErrorMessage({ ok: false, reason: "popup_blocked" })).toBe(
      "Your browser blocked the preview tab. Allow pop-ups for PermitPilot and try again.",
    );
  });
});
