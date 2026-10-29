/**
 * Reads every row of a PostgREST query in pages.
 * The server may cap rows per response below the requested page size, so paging
 * advances by rows actually received and stops only on an empty page or the reported count.
 */
export const ANALYZER_PAGE_SIZE = 500;
const MAX_PAGES = 200;

export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
  count?: number | null;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = ANALYZER_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  let finished = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = rows.length;
    const { data, error, count } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (typeof count === "number") expected = count;
    const batch = data || [];
    if (batch.length === 0 || (expected !== null && rows.length + batch.length >= expected)) {
      rows.push(...batch);
      finished = true;
      break;
    }
    rows.push(...batch);
  }
  if (!finished) {
    throw new Error(`Stopped after ${MAX_PAGES} pages. The analysis was not loaded completely.`);
  }
  if (expected !== null && rows.length !== expected) {
    throw new Error(`Expected ${expected} rows but received ${rows.length}. The analysis was not loaded completely.`);
  }
  return rows;
}
