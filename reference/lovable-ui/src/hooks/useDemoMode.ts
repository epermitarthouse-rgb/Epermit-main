import { useEffect, useState } from "react";

const DEMO_MODE_KEY = "commun-et:demo-mode";
const EVENT = "commun-et:demo-mode-change";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Presentation/Demo mode. When on, live AI-backed surfaces render the pre-approved
 * demo copy (McDonald's pitch) instead of calling live models — guarantees a
 * deterministic story during the pitch and avoids network dependency.
 */
export function useDemoMode(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(readInitial);

  useEffect(() => {
    const handler = () => setOn(readInitial());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const set = (v: boolean) => {
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, v ? "1" : "0");
    } catch { /* ignore */ }
    setOn(v);
    window.dispatchEvent(new Event(EVENT));
  };

  return [on, set];
}