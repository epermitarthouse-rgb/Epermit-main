/**
 * Opens one stored permit object (a file copy or a report export) in a new tab, the same way for
 * every jurisdiction. The tab is opened synchronously, inside the click, so the browser treats it as
 * a user action; its location is set once the signed URL resolves. On any failure the tab is closed
 * (never left blank) and the caller is told in plain language.
 */

export const OPEN_FAILED_MESSAGE = "Could not open this file; try again.";
export const OPEN_BLOCKED_MESSAGE = "Your browser blocked the new tab. Allow pop-ups for this site, then try again.";
export const NO_STORED_FILE_MESSAGE = "No stored copy of this file is available.";

export interface OpenedTab {
  location: { href: string };
  opener?: unknown;
  close(): void;
}

export interface OpenObjectDeps {
  /** Opens the blank tab. Must be called synchronously from the click. Returns null when blocked. */
  openTab(): OpenedTab | null;
  signUrl(path: string): Promise<string>;
  /** Plain-language message for the user (toast or inline). */
  notify(message: string, kind: "blocked" | "failed" | "missing"): void;
}

/** Resolves true when the tab was pointed at the signed URL, false when nothing was opened. */
export async function openStoredObject(path: string, deps: OpenObjectDeps): Promise<boolean> {
  if (!path) {
    deps.notify(NO_STORED_FILE_MESSAGE, "missing");
    return false;
  }
  const tab = deps.openTab();
  if (!tab) {
    deps.notify(OPEN_BLOCKED_MESSAGE, "blocked");
    return false;
  }
  try {
    tab.opener = null;
  } catch {
    /* some browsers refuse to write opener; the tab is still ours to close */
  }
  try {
    tab.location.href = await deps.signUrl(path);
    return true;
  } catch {
    try {
      tab.close();
    } catch {
      /* already closed */
    }
    deps.notify(OPEN_FAILED_MESSAGE, "failed");
    return false;
  }
}

export type ReportExportKind = "pdf" | "excel";

export interface ReportExportTarget {
  kind: ReportExportKind;
  path: string;
}

/** The export View opens: the PDF when stored, otherwise the Excel export, otherwise nothing. */
export function reportExportTarget(exports: { pdf?: string | null; excel?: string | null } | null | undefined): ReportExportTarget | null {
  if (exports?.pdf) return { kind: "pdf", path: exports.pdf };
  if (exports?.excel) return { kind: "excel", path: exports.excel };
  return null;
}
