/**
 * Stored sheet text from the project's Drawing RAG chunks. Read-only.
 * The index prescreen uses it to find an "Index of Sheets" heading on a cover sheet.
 */
import { supabase } from "@/lib/supabase";

export interface DrawingChunkTextRow {
  sheet_id: string | null;
  chunk_text: string | null;
  metadata?: { chunkIndex?: number | null } | null;
}

/** Join chunk text per sheet in chunk order. Rows without a sheet id are skipped. */
export function pageTextBySheetFromChunks(rows: DrawingChunkTextRow[]): Record<string, string> {
  const bySheet = new Map<string, Array<{ index: number; text: string }>>();
  for (const row of rows) {
    if (!row.sheet_id || !row.chunk_text) continue;
    const list = bySheet.get(row.sheet_id) ?? [];
    list.push({ index: Number(row.metadata?.chunkIndex ?? 0), text: row.chunk_text });
    bySheet.set(row.sheet_id, list);
  }
  const out: Record<string, string> = {};
  for (const [sheetId, parts] of bySheet) {
    out[sheetId] = parts
      .sort((a, b) => a.index - b.index)
      .map((part) => part.text)
      .join(" ");
  }
  return out;
}

type UntypedQuery = {
  select: (columns: string) => UntypedQuery;
  eq: (column: string, value: unknown) => UntypedQuery;
  limit: (count: number) => Promise<{ data: unknown; error: unknown }>;
};

export async function fetchSheetPageText(projectId: string): Promise<Record<string, string>> {
  const client = supabase as unknown as { from: (table: string) => UntypedQuery };
  const { data, error } = await client
    .from("code_analyzer_drawing_chunks")
    .select("sheet_id, chunk_text, metadata")
    .eq("project_id", projectId)
    .eq("superseded", false)
    .limit(5000);
  if (error || !Array.isArray(data)) return {};
  return pageTextBySheetFromChunks(data as DrawingChunkTextRow[]);
}
