export const DISPLAY_DISCIPLINES = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Fire Protection",
  "Demolition",
  "Energy",
  "Equipment",
  "General",
] as const;

export type DisplayDiscipline = (typeof DISPLAY_DISCIPLINES)[number];

export const PENDING_DISCIPLINE = "Pending classification";

const SYNONYMS: Record<string, DisplayDiscipline> = {
  architectural: "Architectural",
  architecture: "Architectural",
  arch: "Architectural",
  structural: "Structural",
  structure: "Structural",
  struct: "Structural",
  mechanical: "Mechanical",
  mech: "Mechanical",
  hvac: "Mechanical",
  electrical: "Electrical",
  electric: "Electrical",
  elec: "Electrical",
  plumbing: "Plumbing",
  plumb: "Plumbing",
  "fire protection": "Fire Protection",
  fire: "Fire Protection",
  "fire life safety": "Fire Protection",
  "life safety": "Fire Protection",
  fp: "Fire Protection",
  demolition: "Demolition",
  demo: "Demolition",
  raze: "Demolition",
  energy: "Energy",
  "energy code": "Energy",
  equipment: "Equipment",
  equip: "Equipment",
  general: "General",
};

const PREFIX_DISCIPLINE: Array<[string, DisplayDiscipline]> = [
  ["FP", "Fire Protection"],
  ["FA", "Fire Protection"],
  ["FS", "Fire Protection"],
  ["EL", "Electrical"],
  ["ME", "Mechanical"],
  ["MP", "Mechanical"],
  ["PL", "Plumbing"],
  ["ST", "Structural"],
  ["SE", "Structural"],
  ["SS", "Structural"],
  ["DM", "Demolition"],
  ["EN", "Energy"],
  ["EQ", "Equipment"],
  ["AD", "Architectural"],
  ["ID", "Architectural"],
  ["F", "Fire Protection"],
  ["E", "Electrical"],
  ["M", "Mechanical"],
  ["P", "Plumbing"],
  ["S", "Structural"],
  ["D", "Demolition"],
  ["A", "Architectural"],
  ["G", "General"],
];

export interface DisciplineDisplay {
  display: string;
  raw: string | null;
  conflict: boolean;
}

export interface DisciplineSheetInput {
  discipline?: string | null;
  detected_sheet_number?: string | null;
  detected_sheet_title?: string | null;
  original_file_name?: string | null;
}

function clean(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function synonymKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function singleModelDiscipline(raw: string): DisplayDiscipline | null {
  const key = synonymKey(raw);
  return SYNONYMS[key] || null;
}

function prefixDiscipline(value: string | null | undefined): DisplayDiscipline | null {
  const stem = clean(value).replace(/\.[^.]+$/, "").toUpperCase();
  const match = stem.match(/^([A-Z]{1,3})(?=[-.]?\d)/);
  if (!match) return null;
  const prefix = match[1];
  return PREFIX_DISCIPLINE.find(([candidate]) => candidate === prefix)?.[1] || null;
}

function demolitionKeyword(value: string | null | undefined): boolean {
  return /\b(demolition|raze|razing)\b/i.test(clean(value));
}

function sheetEvidence(input: DisciplineSheetInput): DisplayDiscipline | null {
  const fromNumber = prefixDiscipline(input.detected_sheet_number);
  const fromFile = prefixDiscipline(input.original_file_name);
  const prefix = fromNumber || fromFile;
  const demolition = demolitionKeyword(input.detected_sheet_title)
    || demolitionKeyword(input.original_file_name)
    || prefix === "Demolition";
  if (demolition && (prefix === "Demolition" || prefix === "Architectural" || prefix == null)) {
    return "Demolition";
  }
  return prefix;
}

export function displayDisciplineForSheet(input: DisciplineSheetInput): DisciplineDisplay {
  const rawText = clean(input.discipline);
  const raw = rawText || null;
  const model = raw ? singleModelDiscipline(raw) : null;
  const evidence = sheetEvidence(input);
  if (evidence && model && evidence !== model) {
    return { display: evidence, raw, conflict: true };
  }
  if (evidence) return { display: evidence, raw, conflict: false };
  if (model) return { display: model, raw, conflict: false };
  if (raw) return { display: raw, raw, conflict: false };
  return { display: PENDING_DISCIPLINE, raw: null, conflict: false };
}

export function disciplineSortIndex(label: string): number {
  const known = DISPLAY_DISCIPLINES.indexOf(label as DisplayDiscipline);
  if (known >= 0) return known;
  if (label === PENDING_DISCIPLINE) return DISPLAY_DISCIPLINES.length + 1;
  return DISPLAY_DISCIPLINES.length;
}
