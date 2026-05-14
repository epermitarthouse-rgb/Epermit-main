import { cn } from "@/lib/utils";

/** Cream editorial card — forms, settings, tool inputs */
export const EDITORIAL_FORM_CARD =
  "rounded-2xl border border-border bg-card text-card-foreground shadow-sm dark:border-border dark:bg-card dark:text-card-foreground";

/** Dark navy intelligence surface — ROI summary, dense analytics charts */
export const DATA_INTELLIGENCE_PANEL =
  "rounded-2xl border border-border/50 bg-gradient-to-br from-obsidian-raised/95 via-obsidian to-obsidian-sunken text-foreground shadow-lg shadow-black/15 dark:border-border/40 dark:from-obsidian-raised/95 dark:via-obsidian dark:to-obsidian-sunken dark:text-foreground";

export function editorialFormCard(extra?: string) {
  return cn(EDITORIAL_FORM_CARD, extra);
}
