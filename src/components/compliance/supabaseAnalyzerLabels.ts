import type { SupabaseAnalyzerSheetJob } from "@/lib/supabaseAnalyzer/client";

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    upload_pending: "Awaiting upload",
    uploading: "Uploading drawings",
    queued: "Queued",
    processing: "Analyzing drawings",
    completed: "Analysis complete",
    completed_with_errors: "Analysis complete (with sheet errors)",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status] || status.replace(/_/g, " ");
}

export function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed" || status === "completed_with_errors") return "destructive";
  if (status === "processing" || status === "queued" || status === "uploading") return "secondary";
  return "outline";
}

export function bytesLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function sheetErrorMessage(errorCode: string | null) {
  if (errorCode === "drawing_download_failed") {
    return "The drawing file could not be opened. Retry this sheet or upload it again.";
  }
  if (errorCode === "budget_limit_reached") {
    return "This analysis reached its processing limit. Contact support before retrying.";
  }
  if (errorCode === "run_cancelled") {
    return "This sheet was not completed because the analysis was cancelled.";
  }
  if (errorCode?.startsWith("openai_")) {
    return "The analysis service was temporarily unavailable. Retry this sheet.";
  }
  return "This sheet could not be completed. Retry the sheet or contact support.";
}

export function disciplineName(discipline: string | null | undefined) {
  return discipline?.trim() || "Pending classification";
}

export function sheetIdentity(job: Pick<SupabaseAnalyzerSheetJob, "detected_sheet_number" | "detected_sheet_title" | "ordinal">) {
  const number = job.detected_sheet_number || `Sheet ${job.ordinal}`;
  return job.detected_sheet_title ? `${number} — ${job.detected_sheet_title}` : number;
}

export function conciseObservation(value: string, max = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
