import { useTheme } from "@/hooks/useTheme";

export interface ThemeColors {
  bg: string;
  bgSecondary: string;
  panel: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  gold: string;
  goldLight: string;
  goldDim: string;
  teal: string;
  tealDim: string;
  red: string;
  steel: string;
  fog: string;
  white: string;
  offwhite: string;
  inputBg: string;
  cardHover: string;
  tablHeaderBg: string;
  tableAltRow: string;
}

const DARK: ThemeColors = {
  bg: "#050E1F",
  bgSecondary: "#091428",
  panel: "#0D1E38",
  border: "#1A3055",
  text: "#F0F6FF",
  textSecondary: "#B8D4F0",
  textMuted: "#6B9AC4",
  gold: "#FF6B2B",
  goldLight: "#FF8C55",
  goldDim: "#C44D14",
  teal: "#38BDF8",
  tealDim: "#0A5A8C",
  red: "#FF4040",
  steel: "#1D4A7A",
  fog: "#6B9AC4",
  white: "#F0F6FF",
  offwhite: "#B8D4F0",
  inputBg: "#050E1F",
  cardHover: "#FF6B2B08",
  tablHeaderBg: "#091428",
  tableAltRow: "#091428",
};

const LIGHT: ThemeColors = {
  bg: "#FAFBFD",
  bgSecondary: "#F2F4F8",
  panel: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F172A",
  textSecondary: "#334155",
  textMuted: "#64748B",
  gold: "#FF6B2B",
  goldLight: "#FF8C55",
  goldDim: "#C44D14",
  teal: "#0EA5E9",
  tealDim: "#0284C7",
  red: "#EF4444",
  steel: "#CBD5E1",
  fog: "#64748B",
  white: "#0F172A",
  offwhite: "#334155",
  inputBg: "#FFFFFF",
  cardHover: "#FFF7ED",
  tablHeaderBg: "#F8FAFC",
  tableAltRow: "#F8FAFC",
};

export function useThemeColors(): ThemeColors {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "dark" ? DARK : LIGHT;
}

export { DARK as DARK_COLORS, LIGHT as LIGHT_COLORS };
