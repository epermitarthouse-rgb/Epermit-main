import { DISCIPLINE_LABELS, type DocumentDiscipline } from "@/types/document";

const CLASSIFICATION_LABELS: Record<string, string> = {
  architectural: DISCIPLINE_LABELS.architectural,
  architecture: DISCIPLINE_LABELS.architectural,
  structural: DISCIPLINE_LABELS.structural,
  mechanical: DISCIPLINE_LABELS.mechanical,
  hvac: DISCIPLINE_LABELS.mechanical,
  electrical: DISCIPLINE_LABELS.electrical,
  plumbing: DISCIPLINE_LABELS.plumbing,
  fire: DISCIPLINE_LABELS.fire,
  fire_protection: DISCIPLINE_LABELS.fire,
  "fire protection": DISCIPLINE_LABELS.fire,
  demolition: DISCIPLINE_LABELS.demolition,
  demo: DISCIPLINE_LABELS.demolition,
  general: DISCIPLINE_LABELS.general,
  zoning: DISCIPLINE_LABELS.zoning,
  green: DISCIPLINE_LABELS.green,
  civil: DISCIPLINE_LABELS.civil,
  stormwater: DISCIPLINE_LABELS.stormwater,
  utilities: DISCIPLINE_LABELS.utilities,
};

export interface V2NavigatorSheet {
  id: string;
  fileName?: string | null;
  imageDocumentId?: string | null;
  sourceDocumentId?: string | null;
  discipline?: string | null;
}

export interface V2NavigatorGroup {
  id: string;
  fileName: string;
  classificationDisciplines?: readonly string[] | null;
}

export interface V2DisciplineChoice {
  key: string;
  label: string;
  count: number;
}

function classificationKey(value: string): string {
  return value.toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
}

function storedLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value in DISCIPLINE_LABELS) return DISCIPLINE_LABELS[value as DocumentDiscipline];
  return CLASSIFICATION_LABELS[classificationKey(value)] || null;
}

function classificationLabels(values: readonly string[] | null | undefined): string[] {
  const labels = new Set<string>();
  for (const value of values || []) {
    const label = CLASSIFICATION_LABELS[classificationKey(value)];
    if (label) labels.add(label);
  }
  return [...labels];
}

/** Presentation label from V2 sheet metadata and classification evidence. */
export function resolveV2DisciplineLabel(input: {
  storedDiscipline?: string | null;
  classificationDisciplines?: readonly string[] | null;
}): string {
  const stored = storedLabel(input.storedDiscipline);
  if (stored && stored !== DISCIPLINE_LABELS.general) return stored;
  const evidence = classificationLabels(input.classificationDisciplines)
    .filter((label) => label !== DISCIPLINE_LABELS.general);
  if (evidence.length === 1) return evidence[0];
  if (
    evidence.length === 2
    && evidence.includes(DISCIPLINE_LABELS.demolition)
    && evidence.includes(DISCIPLINE_LABELS.architectural)
  ) {
    return DISCIPLINE_LABELS.demolition;
  }
  return stored || "Unclassified";
}

function sheetForGroup(group: V2NavigatorGroup, sheets: readonly V2NavigatorSheet[]) {
  return sheets.find((sheet) =>
    sheet.id === group.id
    || sheet.imageDocumentId === group.id
    || sheet.sourceDocumentId === group.id
    || (sheet.fileName != null && sheet.fileName === group.fileName),
  ) || null;
}

export function buildV2DisciplineNavigator(input: {
  groups: readonly V2NavigatorGroup[];
  sheets: readonly V2NavigatorSheet[];
  selectedKey: string;
}) {
  const annotated = input.groups.map((group) => {
    const sheet = sheetForGroup(group, input.sheets);
    const label = resolveV2DisciplineLabel({
      storedDiscipline: sheet?.discipline,
      classificationDisciplines: group.classificationDisciplines,
    });
    return { id: group.id, label, key: label };
  });
  const counts = new Map<string, number>();
  for (const row of annotated) counts.set(row.label, (counts.get(row.label) || 0) + 1);
  const choices: V2DisciplineChoice[] = [
    { key: "all", label: "All disciplines", count: annotated.length },
    ...[...counts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ key: label, label, count })),
  ];
  const selectedKey = input.selectedKey !== "all" && choices.some((choice) => choice.key === input.selectedKey)
    ? input.selectedKey
    : "all";
  const visibleIds = annotated
    .filter((row) => selectedKey === "all" || row.key === selectedKey)
    .map((row) => row.id);
  return { choices, selectedKey, visibleIds };
}
