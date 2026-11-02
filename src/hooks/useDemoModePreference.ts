import { useCallback, useEffect, useState } from "react";
import {
  DEMO_MODE_CHANGE_EVENT,
  readDemoModePreference,
  writeDemoModePreference,
} from "@/lib/demoModePreference";

/** Reactive Demo mode preference (localStorage). Default on so existing Demo nav stays visible until turned off. */
export function useDemoModePreference() {
  const [enabled, setEnabledState] = useState(() => readDemoModePreference(true));

  useEffect(() => {
    const sync = () => setEnabledState(readDemoModePreference(true));
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === "permitpilot.demo-mode") sync();
    };
    window.addEventListener(DEMO_MODE_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEMO_MODE_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    writeDemoModePreference(next);
    setEnabledState(next);
  }, []);

  return { enabled, setEnabled } as const;
}
