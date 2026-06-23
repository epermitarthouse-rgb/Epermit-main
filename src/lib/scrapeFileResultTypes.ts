export type ScrapeFileResultStatus =
  | "discovered"
  | "downloading"
  | "uploaded"
  | "retrying"
  | "failed"
  | "skipped";

export interface ScrapeFileResult {
  id: string;
  project_id: string;
  scrape_job_id: string;
  jurisdiction: string;
  portal_file_id: string;
  file_version: string;
  file_name: string;
  folder_name: string | null;
  parent_folder: string | null;
  status: ScrapeFileResultStatus;
  storage_path: string | null;
  public_url: string | null;
  source_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  progress_current: number | null;
  progress_total: number | null;
  failure_code: string | null;
  failure_message: string | null;
  updated_at: string;
  created_at: string;
}

export function scrapeFileStableKey(
  portalFileId: string,
  fileVersion?: string | null,
): string {
  return `${portalFileId}::${String(fileVersion ?? "").trim()}`;
}
