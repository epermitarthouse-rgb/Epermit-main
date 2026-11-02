/**
 * Client preference: show Demo navigation / “Dashboard · Demo” chrome.
 * Persisted in localStorage; not a server feature flag.
 */
export const DEMO_MODE_STORAGE_KEY = "permitpilot.demo-mode";
export const DEMO_MODE_CHANGE_EVENT = "permitpilot:demo-mode-change";

export function readDemoModePreference(defaultValue = true): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(DEMO_MODE_STORAGE_KEY);
    if (raw === null) return defaultValue;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeDemoModePreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(
    new CustomEvent(DEMO_MODE_CHANGE_EVENT, { detail: { enabled } }),
  );
}

/** True when the href is the McDonald's executive Demo landing (or alias). */
export function isDemoNavHref(href: string): boolean {
  const path = String(href || "").split("?")[0].replace(/\/+$/, "") || "/";
  return path === "/demo" || path === "/demo/mcdonalds";
}
