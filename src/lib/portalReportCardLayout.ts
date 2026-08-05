/**
 * Pure layout helpers for expanded Portal Harvest report cards.
 * Keeps title / badges / actions / preview from overlapping or clipping.
 */

export type ReportCardLayoutClasses = {
  root: string;
  header: string;
  title: string;
  badgeRow: string;
  actionRow: string;
  previewWrap: string;
  previewImg: string;
};

/** Class names for a responsive expanded report card (Lovable visual language). */
export function getExpandedReportCardLayoutClasses(): ReportCardLayoutClasses {
  return {
    root: "w-full min-w-0 rounded-xl border border-primary/25 bg-card p-4 sm:p-5 shadow-none dark:bg-card/70",
    header: "flex w-full min-w-0 flex-col gap-3 p-0 pb-4",
    title:
      "min-w-0 max-w-full break-words font-serif text-xl sm:text-2xl leading-snug text-foreground",
    badgeRow: "flex w-full min-w-0 flex-wrap items-center gap-2",
    actionRow:
      "flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center",
    previewWrap:
      "w-full min-w-0 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-muted/30 cursor-pointer transition-all hover:ring-1 hover:ring-primary/40 dark:border-border dark:bg-muted",
    previewImg: "block h-auto w-full max-w-full object-contain pointer-events-none",
  };
}

/**
 * True when an expanded report card layout risks horizontal clipping.
 * Used by unit tests — mirrors the CSS contract (no fixed card width/height).
 */
export function reportCardLayoutAvoidsOverflow(classes: ReportCardLayoutClasses): boolean {
  const joined = Object.values(classes).join(" ");
  if (/\bw-\[\d/.test(joined) || /\bh-\[\d/.test(joined)) return false;
  if (/\bmin-w-\[\d{3,}/.test(joined)) return false;
  if (!/\bmin-w-0\b/.test(classes.root) || !/\bw-full\b/.test(classes.root)) return false;
  if (!/\bbreak-words\b/.test(classes.title)) return false;
  if (!/\bflex-col\b/.test(classes.actionRow)) return false;
  if (!/\bw-full\b/.test(classes.previewImg) || !/\bh-auto\b/.test(classes.previewImg)) {
    return false;
  }
  if (!/\boverflow-x-hidden\b/.test(classes.previewWrap)) return false;
  return true;
}
