import { useState, useEffect, useCallback } from "react";

const FEATURE_FLAGS_KEY = "permitpulse_feature_flags";

interface FeatureFlags {
  showDemoVideo: boolean;
}

const defaultFlags: FeatureFlags = {
  showDemoVideo: false, // Set to true when voice is fixed
};

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(() => {
    try {
      const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
      return stored ? { ...defaultFlags, ...JSON.parse(stored) } : defaultFlags;
    } catch {
      return defaultFlags;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
    } catch {
      // Ignore storage errors
    }
  }, [flags]);

  const setFlag = useCallback(<K extends keyof FeatureFlags>(
    key: K,
    value: FeatureFlags[K]
  ) => {
    setFlags((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleFlag = useCallback(<K extends keyof FeatureFlags>(key: K) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { flags, setFlag, toggleFlag };
}

// Utility to check flag without hook (for SSR or non-React contexts)
export function getFeatureFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  try {
    const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
    const flags = stored ? { ...defaultFlags, ...JSON.parse(stored) } : defaultFlags;
    return flags[key];
  } catch {
    return defaultFlags[key];
  }
}

// Enable demo video via console: enableDemoVideo()
if (typeof window !== "undefined") {
  (window as any).enableDemoVideo = () => {
    const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
    const flags = stored ? JSON.parse(stored) : {};
    flags.showDemoVideo = true;
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
    console.log("✅ Demo video enabled! Refresh the page to see it.");
    return "Demo video enabled. Refresh to apply.";
  };
  
  (window as any).disableDemoVideo = () => {
    const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
    const flags = stored ? JSON.parse(stored) : {};
    flags.showDemoVideo = false;
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
    console.log("❌ Demo video disabled! Refresh the page to hide it.");
    return "Demo video disabled. Refresh to apply.";
  };
}
