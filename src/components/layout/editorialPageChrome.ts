import { cn } from "@/lib/utils";

/** Cream editorial card — forms, settings, tool inputs */
export const EDITORIAL_FORM_CARD =
  "rounded-2xl border border-border bg-card text-card-foreground shadow-sm dark:border-border dark:bg-card dark:text-card-foreground";

/** Intelligence surface — cream card in light mode, obsidian gradient in dark mode */
export const DATA_INTELLIGENCE_PANEL =
  "rounded-2xl border border-border/50 bg-card text-foreground shadow-sm dark:border-border/40 dark:bg-gradient-to-br dark:from-obsidian-raised/95 dark:via-obsidian dark:to-obsidian-sunken dark:shadow-lg dark:shadow-black/15";

export function editorialFormCard(extra?: string) {
  return cn(EDITORIAL_FORM_CARD, extra);
}
