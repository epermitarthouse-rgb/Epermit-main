export interface JurisdictionCsvRow {
  state: string;
  place_name: string;
  fips_place: string;
  total_units: number;
  sf_1unit_units: number;
  duplex_units: number;
  mf_3plus_units: number;
  lineNumber: number;
}

export interface JurisdictionCsvParseResult {
  rows: JurisdictionCsvRow[];
  errors: string[];
}

const REQUIRED_COLUMNS = ['state', 'place_name'] as const;

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse one CSV line respecting double-quoted fields (RFC 4180 subset). */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value.replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseJurisdictionCsv(text: string): JurisdictionCsvParseResult {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { rows: [], errors: ['CSV file is empty or has no data rows'] };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    return { rows: [], errors: [`Missing required columns: ${missingColumns.join(', ')}`] };
  }

  const columnIndex = (name: string) => headers.indexOf(name);
  const stateIdx = columnIndex('state');
  const nameIdx = columnIndex('place_name');
  const fipsIdx = columnIndex('fips_place');
  const totalIdx = columnIndex('total_units');
  const sfIdx = columnIndex('sf_1unit_units');
  const duplexIdx = columnIndex('duplex_units');
  const mfIdx = columnIndex('mf_3plus_units');

  const rows: JurisdictionCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const values = parseCsvLine(lines[i]);
    const state = values[stateIdx]?.trim().toUpperCase() ?? '';
    const placeName = values[nameIdx]?.trim() ?? '';

    if (!state || !placeName) {
      errors.push(`Row ${lineNumber}: missing state or place_name`);
      continue;
    }

    if (state.length !== 2) {
      errors.push(`Row ${lineNumber}: state must be a 2-letter code (${state})`);
      continue;
    }

    rows.push({
      state,
      place_name: placeName,
      fips_place: fipsIdx >= 0 ? values[fipsIdx]?.trim() ?? '' : '',
      total_units: totalIdx >= 0 ? parseInteger(values[totalIdx]) : 0,
      sf_1unit_units: sfIdx >= 0 ? parseInteger(values[sfIdx]) : 0,
      duplex_units: duplexIdx >= 0 ? parseInteger(values[duplexIdx]) : 0,
      mf_3plus_units: mfIdx >= 0 ? parseInteger(values[mfIdx]) : 0,
      lineNumber,
    });
  }

  return { rows, errors };
}

export function jurisdictionCsvRowKey(row: Pick<JurisdictionCsvRow, 'place_name' | 'state'>): string {
  return `${row.place_name.toLowerCase()}|${row.state.toLowerCase()}`;
}

export function isValidJurisdictionSubscriptionId(value: string): boolean {
  return UUID_LIKE.test(value);
}

export type CsvImportMode = 'skip_existing' | 'upsert_volume';

export interface CsvImportRpcRow {
  state: string;
  place_name: string;
  fips_place?: string | null;
  total_units: number;
  sf_1unit_units: number;
  duplex_units: number;
  mf_3plus_units: number;
}

export function csvRowsToRpcPayload(rows: JurisdictionCsvRow[]): CsvImportRpcRow[] {
  return rows.map((row) => ({
    state: row.state,
    place_name: row.place_name,
    fips_place: row.fips_place || null,
    total_units: row.total_units,
    sf_1unit_units: row.sf_1unit_units,
    duplex_units: row.duplex_units,
    mf_3plus_units: row.mf_3plus_units,
  }));
}
