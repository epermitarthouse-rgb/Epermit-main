import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pepcoDocumentViewErrorMessage } from "./uciApi.ts";

describe("pepcoDocumentViewErrorMessage", () => {
  it("returns null when the preview opens successfully", () => {
    assert.equal(pepcoDocumentViewErrorMessage({ ok: true }), null);
  });

  it("returns the generic message for API failures", () => {
    assert.equal(
      pepcoDocumentViewErrorMessage({ ok: false, reason: "api_error" }),
      "The PEPCO document could not be opened for viewing.",
    );
  });

  it("returns a popup-blocked message instead of the generic route failure", () => {
    assert.equal(
      pepcoDocumentViewErrorMessage({ ok: false, reason: "popup_blocked" }),
      "Your browser blocked the preview tab. Allow pop-ups for PermitPilot and try again.",
    );
  });

  it("returns the refresh message when the stored copy is unavailable", () => {
    assert.equal(
      pepcoDocumentViewErrorMessage({ ok: false, reason: "copy_unavailable" }),
      "The stored document copy is no longer available. Refresh project details to save it again.",
    );
  });
});
