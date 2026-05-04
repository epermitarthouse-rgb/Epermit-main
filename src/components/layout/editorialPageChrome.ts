import { cn } from "@/lib/utils";

/** Cream editorial card — forms, settings, tool inputs */
export const EDITORIAL_FORM_CARD =
  "rounded-2xl border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light";

/** Dark navy intelligence surface — ROI summary, dense analytics charts */
export const DATA_INTELLIGENCE_PANEL =
  "rounded-2xl border border-[hsl(var(--border-obsidian-strong)/0.42)] bg-gradient-to-br from-obsidian-raised/95 via-obsidian to-obsidian-sunken text-ink-primary-dark shadow-lg shadow-black/15 dark:border-[hsl(var(--border-obsidian-strong)/0.42)] dark:from-obsidian-raised/95 dark:via-obsidian dark:to-obsidian-sunken dark:text-ink-primary-dark";

export function editorialFormCard(extra?: string) {
  return cn(EDITORIAL_FORM_CARD, extra);
}
