import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UTILITY_PM_CONTACT_SECTION_ID,
  UTILITY_PM_EMAIL_INPUT_SELECTOR,
  deriveUtilityContactBlocker,
  shouldHighlightUtilityPmEmailField,
} from "./uciUtilityContact";

describe("uciUtilityContact Stage 9 UI helpers", () => {
  it("highlights utility PM email only when PM exists but email is missing", () => {
    assert.equal(shouldHighlightUtilityPmEmailField(null), false);
    assert.equal(shouldHighlightUtilityPmEmailField("missing_utility_pm"), false);
    assert.equal(shouldHighlightUtilityPmEmailField("missing_utility_contact_email"), true);
  });

  it("derives missing_utility_contact_email without changing gate semantics", () => {
    const blocker = deriveUtilityContactBlocker({
      name: "Alex Morgan",
      email: null,
    });
    assert.equal(blocker.reason, "missing_utility_contact_email");
    assert.equal(
      blocker.message,
      "Utility contact email required for outbound meter-set request",
    );
  });

  it("exports stable DOM anchors for scroll/focus behavior", () => {
    assert.equal(UTILITY_PM_CONTACT_SECTION_ID, "uci-utility-pm-contact-section");
    assert.match(UTILITY_PM_EMAIL_INPUT_SELECTOR, /utility-pm-email-input/);
  });
});
