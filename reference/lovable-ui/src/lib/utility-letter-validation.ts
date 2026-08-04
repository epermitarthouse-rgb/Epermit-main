// Pure validation helper for the utility-letter pre-flight check used by
// LoadProfileAnalyzer. Extracted so it can be unit-tested without rendering
// the full page.

export type LetterPeak = { label: string; value: string };
export type LetterBreakdownItem = { name: string; kw: number; note?: string };
export type LetterPreset = {
  id?: string;
  label: string;
  kicker: string;
  peaks: LetterPeak[];
  breakdown: LetterBreakdownItem[];
  declaredTotalKw?: number;
};

export type LetterValidationInput = {
  preset: LetterPreset;
  jurisdiction: string;
  utility: string;
};

export type LetterValidationResult = {
  missingFields: {
    label: boolean;
    kicker: boolean;
    jurisdiction: boolean;
    utility: boolean;
    peakDemand: boolean;
    serviceEntrance: boolean;
    breakdownEmpty: boolean;
    breakdownInvalid: boolean;
    totalKw: boolean;
    totalMismatch: boolean;
  };
  missingList: string[];
  hasMissing: boolean;
  breakdownSumKw: number;
  totalKw: number;
  totalDelta: number;
  invalidBreakdownNames: string[];
};

export function validateLetterInputs(
  { preset, jurisdiction, utility }: LetterValidationInput,
): LetterValidationResult {
  const breakdownSumKw = preset.breakdown.reduce(
    (s, b) => s + (Number.isFinite(b.kw) ? b.kw : 0),
    0,
  );
  const declaredTotalKw = preset.declaredTotalKw;
  const totalKw = declaredTotalKw ?? breakdownSumKw;
  const totalDelta = declaredTotalKw !== undefined
    ? Math.round((breakdownSumKw - declaredTotalKw) * 10) / 10
    : 0;
  const totalMismatch =
    declaredTotalKw !== undefined && Math.abs(totalDelta) > 0.5;

  const peakEntry = preset.peaks.find((p) => p.label === "Peak demand");
  const serviceEntry = preset.peaks.find((p) => p.label === "Service entrance");
  const invalidBreakdownNames = preset.breakdown
    .filter((b) => !b.name?.trim() || !Number.isFinite(b.kw) || b.kw <= 0)
    .map((b) => b.name || "(unnamed)");

  const missingFields = {
    label: !preset.label?.trim(),
    kicker: !preset.kicker?.trim(),
    jurisdiction: !jurisdiction?.trim(),
    utility: !utility?.trim(),
    peakDemand: !peakEntry?.value?.trim(),
    serviceEntrance: !serviceEntry?.value?.trim(),
    breakdownEmpty: preset.breakdown.length === 0,
    breakdownInvalid: invalidBreakdownNames.length > 0,
    totalKw: totalKw <= 0,
    totalMismatch,
  };

  const missingList: string[] = [];
  if (missingFields.label) missingList.push("prototype label");
  if (missingFields.kicker) missingList.push("prototype description");
  if (missingFields.jurisdiction) missingList.push("jurisdiction");
  if (missingFields.utility) missingList.push("utility");
  if (missingFields.peakDemand) missingList.push("peak demand");
  if (missingFields.serviceEntrance) missingList.push("service entrance");
  if (missingFields.breakdownEmpty) missingList.push("load breakdown");
  else if (missingFields.breakdownInvalid) {
    missingList.push(
      `valid breakdown line items (${invalidBreakdownNames.join(", ")})`,
    );
  }
  if (missingFields.totalKw) missingList.push("total connected load");
  if (missingFields.totalMismatch) {
    missingList.push(
      `breakdown sum (${breakdownSumKw} kW) does not match declared total (${declaredTotalKw} kW, Δ ${totalDelta > 0 ? "+" : ""}${totalDelta} kW)`,
    );
  }

  return {
    missingFields,
    missingList,
    hasMissing: missingList.length > 0,
    breakdownSumKw,
    totalKw,
    totalDelta,
    invalidBreakdownNames,
  };
}