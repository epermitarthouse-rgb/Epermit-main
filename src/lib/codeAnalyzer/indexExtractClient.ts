import { supabase } from "@/lib/supabase";
import { getScraperBaseUrl } from "@/lib/scraperBaseUrl";
import type { IndexSheetEntry } from "./indexCompleteness";

export async function requestDrawingIndexExtract(opts: {
  imageBase64: string;
  imageType: string;
  pageText?: string | null;
}): Promise<IndexSheetEntry[]> {
  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authSession?.access_token) {
    headers.Authorization = `Bearer ${authSession.access_token}`;
  }

  const response = await fetch(`${getScraperBaseUrl()}/api/extract-drawing-index`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      imageBase64: opts.imageBase64,
      imageType: opts.imageType,
      pageText: opts.pageText ?? null,
    }),
  });

  let data: { error?: string; entries?: Array<{ sheetNumber: string; title?: string | null }> };
  try {
    data = await response.json();
  } catch {
    throw new Error(`Index extraction returned an invalid response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(data?.error || `Index extraction failed (HTTP ${response.status})`);
  }

  return (data.entries ?? []).map((row) => ({
    sheetNumber: row.sheetNumber.replace(/[\s\-_.]/g, "").toUpperCase(),
    rawLabel: row.sheetNumber,
    title: row.title ?? null,
  }));
}
