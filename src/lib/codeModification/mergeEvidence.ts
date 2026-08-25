/**
 * Merge per-sheet Code Modification evidence into one finding per measure.
 * Preserves observations from every reviewed sheet instead of last-match overwrite.
 */

import type { EvidenceFinding, EvidenceSource, EvidenceStatus } from "./model";

export interface SheetEvidenceObservation {
  status: EvidenceStatus;
  source?: EvidenceSource | null;
  note?: string | null;
}

export interface MergeableEvidenceFinding extends EvidenceFinding {
  observations?: SheetEvidenceObservation[];
}

const STATUS_RANK: Record<EvidenceStatus, number> = {
  conflicting: 5,
  requires_professional_dob_review: 4,
  verified: 3,
  partially_supported: 2,
  not_found: 1,
};

function measureKey(finding: Pick<EvidenceFinding, "measureId" | "measure" | "id">): string {
  return (finding.measureId || finding.measure || finding.id).toLowerCase();
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sourceIdentity(source: EvidenceSource | null | undefined): string | null {
  if (!source) return null;
  if (source.sheetId) return `sheet:${source.sheetId}`;
  if (source.documentId) {
    const page =
      typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)
        ? `:${source.pageNumber}`
        : "";
    return `doc:${source.documentId}${page}`;
  }
  const label = normalizeText(source.sheetLabel || source.fileName);
  if (!label) return null;
  const page =
    typeof source.pageNumber === "number" && Number.isFinite(source.pageNumber)
      ? `:${source.pageNumber}`
      : "";
  return `label:${label}${page}`;
}

function observationText(observation: SheetEvidenceObservation): string {
  return [observation.source?.excerpt, observation.note].filter(Boolean).join(" ").trim();
}

function formatSourceCitation(source: EvidenceSource | null | undefined): string | null {
  if (!source) return null;
  const label = source.sheetLabel || source.fileName;
  if (label && typeof source.pageNumber === "number") {
    return `${label} p.${source.pageNumber}`;
  }
  return label || source.documentId || source.sheetId || null;
}

export function isAddendumEvidenceSource(source: EvidenceSource | null | undefined): boolean {
  const label = normalizeText(source?.fileName || source?.sheetLabel);
  return /(?:^|[^a-z0-9])(addendum|revision|supplement|amendment)(?:[^a-z0-9]|$)/.test(label);
}

function formatAllObservationNotes(observations: SheetEvidenceObservation[]): string | null {
  const parts: string[] = [];
  for (const observation of observations) {
    const citation = formatSourceCitation(observation.source);
    const text = observationText(observation);
    if (citation && text) {
      parts.push(`${citation}: ${text}`);
    } else if (citation) {
      parts.push(citation);
    } else if (text) {
      parts.push(text);
    }
  }
  return parts.length ? parts.join(" ") : null;
}

export function excerptsContradict(left: string, right: string): boolean {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b || a === b) return false;

  const negative =
    /\b(not included|not shown|not provided|not indicated|absent|no standpipe|without standpipe|does not include|does not show)\b/;
  const positive =
    /\b(included|shown|provided|indicated|present|with standpipe|includes standpipe|includes a standpipe)\b/;

  return (
    (negative.test(a) && positive.test(b)) ||
    (positive.test(a) && negative.test(b)) ||
    (/\bnot included\b/.test(a) && /\bincluded\b/.test(b)) ||
    (/\bincluded\b/.test(a) && /\bnot included\b/.test(b))
  );
}

function observationsContradict(observations: SheetEvidenceObservation[]): boolean {
  const substantive = observations.filter((observation) => {
    if (observation.status === "conflicting") return true;
    if (observation.status === "verified" || observation.status === "partially_supported") {
      return Boolean(observationText(observation));
    }
    if (observation.status === "not_found" && observation.note) return true;
    return false;
  });

  for (let i = 0; i < substantive.length; i += 1) {
    for (let j = i + 1; j < substantive.length; j += 1) {
      const left = observationText(substantive[i]!);
      const right = observationText(substantive[j]!);
      if (excerptsContradict(left, right)) return true;

      const leftSource = sourceIdentity(substantive[i]?.source);
      const rightSource = sourceIdentity(substantive[j]?.source);
      if (!leftSource || !rightSource || leftSource === rightSource) continue;

      const leftNegative =
        substantive[i]?.status === "not_found" ||
        /\b(not included|not shown|not provided|absent)\b/i.test(left);
      const rightPositive =
        substantive[j]?.status === "verified" || /\b(included|shown|provided|present)\b/i.test(right);
      const rightNegative =
        substantive[j]?.status === "not_found" ||
        /\b(not included|not shown|not provided|absent)\b/i.test(right);
      const leftPositive =
        substantive[i]?.status === "verified" || /\b(included|shown|provided|present)\b/i.test(left);

      if ((leftNegative && rightPositive) || (rightNegative && leftPositive)) {
        return true;
      }
    }
  }

  return false;
}

function combineObservationNotes(
  observations: SheetEvidenceObservation[],
  primarySourceId: string | null,
): string | null {
  const parts: string[] = [];
  for (const observation of observations) {
    const citation = formatSourceCitation(observation.source);
    const text = observationText(observation);
    if (!citation && !text) continue;
    if (primarySourceId && sourceIdentity(observation.source) === primarySourceId && text) {
      continue;
    }
    if (citation && text) {
      parts.push(`${citation}: ${text}`);
    } else if (citation) {
      parts.push(citation);
    } else if (text) {
      parts.push(text);
    }
  }
  return parts.length ? parts.join(" ") : null;
}

function observationFromFinding(finding: EvidenceFinding): SheetEvidenceObservation {
  return {
    status: finding.status,
    source: finding.source ?? null,
    note: finding.note ?? null,
  };
}

function isPlaceholderNotFoundObservation(observation: SheetEvidenceObservation): boolean {
  return (
    observation.status === "not_found" &&
    !observation.source &&
    observation.note === "No drawing evidence was reviewed for this measure."
  );
}

function effectiveObservations(observations: SheetEvidenceObservation[]): SheetEvidenceObservation[] {
  const withoutPlaceholders = observations.filter(
    (observation) => !isPlaceholderNotFoundObservation(observation),
  );
  return withoutPlaceholders.length > 0 ? withoutPlaceholders : observations;
}

function pickPrimaryObservation(
  observations: SheetEvidenceObservation[],
  preferAddendum = true,
): SheetEvidenceObservation {
  const ranked = observations
    .slice()
    .sort(
      (left, right) => (STATUS_RANK[right.status] ?? 0) - (STATUS_RANK[left.status] ?? 0),
    );

  if (preferAddendum) {
    const addendum = ranked.find(
      (observation) =>
        (observation.status === "verified" || observation.status === "partially_supported") &&
        isAddendumEvidenceSource(observation.source),
    );
    if (addendum) return addendum;
  }

  return ranked[0] ?? observations[0]!;
}

export function synthesizeMeasureEvidence(
  finding: MergeableEvidenceFinding,
  options?: { preferAddendumPrecedence?: boolean },
): EvidenceFinding {
  const observations = effectiveObservations(
    finding.observations && finding.observations.length > 0
      ? finding.observations
      : [observationFromFinding(finding)],
  );

  const preferAddendum = options?.preferAddendumPrecedence !== false;
  const explicitConflict = observations.some((observation) => observation.status === "conflicting");
  const supported = observations.filter(
    (observation) =>
      observation.status === "verified" || observation.status === "partially_supported",
  );
  const uniqueSupportedSources = new Set(
    supported.map((observation) => sourceIdentity(observation.source)).filter(Boolean),
  );

  const shouldConflict =
    explicitConflict ||
    (uniqueSupportedSources.size >= 2 && observationsContradict(observations)) ||
    (observations.some((observation) => observation.status === "not_found") &&
      supported.length > 0 &&
      observationsContradict(observations));

  if (shouldConflict) {
    const primary = pickPrimaryObservation(
      observations.filter(
        (observation) =>
          observation.status === "conflicting" ||
          observation.status === "verified" ||
          observation.status === "partially_supported" ||
          observation.status === "not_found",
      ),
      false,
    );
    const combinedNote =
      formatAllObservationNotes(observations) ||
      finding.note ||
      "Conflicting evidence across submitted drawing sheets.";
    return {
      id: finding.id,
      measureId: finding.measureId ?? null,
      measure: finding.measure,
      status: "conflicting",
      source: primary.source ?? null,
      note: combinedNote,
    };
  }

  if (supported.length >= 2 && uniqueSupportedSources.size >= 2) {
    const primary = pickPrimaryObservation(supported, preferAddendum);
    const allNotes = formatAllObservationNotes(observations);
    return {
      id: finding.id,
      measureId: finding.measureId ?? null,
      measure: finding.measure,
      status: primary.status,
      source: primary.source ?? null,
      note: allNotes || primary.note || finding.note || null,
    };
  }

  const primary = pickPrimaryObservation(observations, preferAddendum);
  return {
    id: finding.id,
    measureId: finding.measureId ?? null,
    measure: finding.measure,
    status: primary.status,
    source: primary.source ?? null,
    note: primary.note ?? finding.note ?? null,
  };
}

export function mergeMeasureEvidence(
  existing: MergeableEvidenceFinding[],
  incoming: EvidenceFinding[],
): MergeableEvidenceFinding[] {
  const byMeasure = new Map<string, MergeableEvidenceFinding>();

  for (const finding of existing) {
    const key = measureKey(finding);
    byMeasure.set(key, {
      ...finding,
      observations:
        finding.observations && finding.observations.length > 0
          ? finding.observations.slice()
          : [observationFromFinding(finding)],
    });
  }

  for (const finding of incoming) {
    const key = measureKey(finding);
    const prev = byMeasure.get(key);
    const nextObservation = observationFromFinding(finding);

    if (!prev) {
      byMeasure.set(key, {
        ...finding,
        observations: [nextObservation],
      });
      continue;
    }

    const observations = [...(prev.observations ?? [observationFromFinding(prev)]), nextObservation];
    byMeasure.set(key, {
      ...prev,
      observations,
    });
  }

  return Array.from(byMeasure.values()).map((finding) => synthesizeMeasureEvidence(finding));
}

export function mergeFindingsFromSheets(
  existing: EvidenceFinding[],
  incoming: EvidenceFinding[],
): EvidenceFinding[] {
  return mergeMeasureEvidence(existing, incoming);
}
