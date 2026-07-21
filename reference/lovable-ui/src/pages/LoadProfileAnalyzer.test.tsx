import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// Mock the validation helper so tests can drive every UI branch (banner,
// disabled button, inline highlights) from a single source of truth.
const validateMock = vi.fn();
vi.mock("@/lib/utility-letter-validation", () => ({
  validateLetterInputs: (...args: unknown[]) => validateMock(...args),
}));

// The page imports supabase at module scope but only calls it when demo mode
// is off. Stub it so nothing hits the network from jsdom.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

// Asset JSON imports don't matter for these assertions.
vi.mock("@/assets/commun-et-logo-full.jpg.asset.json", () => ({
  default: { src: "logo.jpg" },
}));
vi.mock("@/assets/mcdonalds-logo.png.asset.json", () => ({
  default: { src: "mcd.png" },
}));

import LoadProfileAnalyzer from "./LoadProfileAnalyzer";

type ValidationResult = ReturnType<
  typeof import("@/lib/utility-letter-validation").validateLetterInputs
>;

function makeValidation(overrides: Partial<ValidationResult> = {}): ValidationResult {
  const missingFields = {
    label: false,
    kicker: false,
    jurisdiction: false,
    utility: false,
    peakDemand: false,
    serviceEntrance: false,
    breakdownEmpty: false,
    breakdownInvalid: false,
    totalKw: false,
    totalMismatch: false,
    ...(overrides.missingFields ?? {}),
  };
  return {
    missingFields,
    missingList: overrides.missingList ?? [],
    hasMissing: overrides.hasMissing ?? false,
    breakdownSumKw: overrides.breakdownSumKw ?? 120,
    totalKw: overrides.totalKw ?? 120,
    totalDelta: overrides.totalDelta ?? 0,
    invalidBreakdownNames: overrides.invalidBreakdownNames ?? [],
  };
}

beforeEach(() => {
  // Demo mode skips the debounced supabase.functions.invoke call.
  window.localStorage.setItem("commun-et:demo-mode", "1");
  validateMock.mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("LoadProfileAnalyzer — pre-flight validation wiring", () => {
  it("hides the banner and enables Generate when validation is clean", () => {
    validateMock.mockReturnValue(makeValidation());
    render(<LoadProfileAnalyzer />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const generate = screen.getByRole("button", { name: /generate utility letter/i });
    expect(generate).toBeEnabled();
    expect(generate).not.toHaveAttribute("title");
  });

  it("renders the banner and disables Generate when validation reports missing fields", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: ["peak demand", "service entrance"],
        missingFields: { peakDemand: true, serviceEntrance: true } as ValidationResult["missingFields"],
      }),
    );
    render(<LoadProfileAnalyzer />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/letter cannot be generated yet/i);
    expect(alert).toHaveTextContent("peak demand, service entrance");

    const generate = screen.getByRole("button", { name: /generate utility letter/i });
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute(
      "title",
      "Missing: peak demand, service entrance",
    );
  });

  it("hides the letter preview section while validation is failing", () => {
    validateMock.mockReturnValue(
      makeValidation({ hasMissing: true, missingList: ["utility"] }),
    );
    render(<LoadProfileAnalyzer />);

    expect(screen.queryByText(/letter preview/i)).not.toBeInTheDocument();
  });

  it("shows the letter preview section once validation passes", () => {
    validateMock.mockReturnValue(makeValidation());
    render(<LoadProfileAnalyzer />);

    expect(screen.getAllByText(/letter preview/i).length).toBeGreaterThan(0);
  });

  it("highlights peak cards flagged by missingFields.peakDemand / serviceEntrance", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: ["peak demand", "service entrance"],
        missingFields: { peakDemand: true, serviceEntrance: true } as ValidationResult["missingFields"],
      }),
    );
    const { container } = render(<LoadProfileAnalyzer />);

    // Every peak card whose label is flagged should carry the destructive ring class
    // and the "Required for utility letter" copy.
    const requiredNotes = screen.getAllByText(/required for utility letter/i);
    expect(requiredNotes.length).toBeGreaterThanOrEqual(2);

    const flaggedCards = container.querySelectorAll(".ring-destructive\\/40");
    expect(flaggedCards.length).toBeGreaterThanOrEqual(2);
  });

  it("does not decorate peak cards when validation is clean", () => {
    validateMock.mockReturnValue(makeValidation());
    const { container } = render(<LoadProfileAnalyzer />);

    expect(container.querySelector(".ring-destructive\\/40")).toBeNull();
    expect(screen.queryByText(/required for utility letter/i)).not.toBeInTheDocument();
  });

  it("shows 'Missing label' on the selected preset tile when missingFields.label is true", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: ["prototype label"],
        missingFields: { label: true } as ValidationResult["missingFields"],
      }),
    );
    render(<LoadProfileAnalyzer />);

    expect(screen.getByText(/missing label/i)).toBeInTheDocument();
  });

  it("shows 'Missing description' on the selected preset tile when only kicker is missing", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: ["prototype description"],
        missingFields: { kicker: true } as ValidationResult["missingFields"],
      }),
    );
    render(<LoadProfileAnalyzer />);

    expect(screen.getByText(/missing description/i)).toBeInTheDocument();
  });

  it("renders the empty-breakdown red panel when missingFields.breakdownEmpty is true", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: ["load breakdown"],
        missingFields: { breakdownEmpty: true } as ValidationResult["missingFields"],
        breakdownSumKw: 0,
        totalKw: 0,
      }),
    );
    render(<LoadProfileAnalyzer />);

    expect(
      screen.getByText(/no breakdown line items on this prototype/i),
    ).toBeInTheDocument();
  });

  it("banner message reflects the full missingList in order", () => {
    validateMock.mockReturnValue(
      makeValidation({
        hasMissing: true,
        missingList: [
          "prototype label",
          "peak demand",
          "load breakdown",
          "total connected load",
        ],
        missingFields: {
          label: true,
          peakDemand: true,
          breakdownEmpty: true,
          totalKw: true,
        } as ValidationResult["missingFields"],
      }),
    );
    render(<LoadProfileAnalyzer />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/prototype label, peak demand, load breakdown, total connected load/i))
      .toBeInTheDocument();
  });
});