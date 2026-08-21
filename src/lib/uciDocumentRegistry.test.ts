import { describe, expect, it } from "vitest";
import {
  classificationReviewTone,
  confidenceTone,
  formatDocumentRoleLabel,
} from "@/lib/uciDocumentRegistry";

describe("uciDocumentRegistry helpers", () => {
  it("formats role labels for display", () => {
    expect(formatDocumentRoleLabel("single_line_diagram")).toBe("Single Line Diagram");
    expect(formatDocumentRoleLabel(null)).toBe("Unclassified");
  });

  it("maps confidence and review tiers to badge variants", () => {
    expect(confidenceTone("high")).toBe("default");
    expect(confidenceTone("low")).toBe("outline");
    expect(classificationReviewTone("needs_classification")).toBe("destructive");
    expect(classificationReviewTone("auto_accepted")).toBe("default");
  });
});
