/** Shared compact toolbar button styles for Comment Review. */
export const commentReviewToolbarBtn = {
  primary:
    "h-8 rounded-lg px-3 text-xs font-medium shadow-none [&_svg]:size-3.5",
  secondary:
    "h-8 rounded-lg px-3 text-xs font-medium [&_svg]:size-3.5",
  ghost:
    "h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground [&_svg]:size-3.5",
  dangerOutline:
    "h-8 rounded-lg px-3 text-xs font-medium border-destructive/25 text-destructive/90 hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5",
  dangerGhost:
    "h-8 rounded-lg px-2.5 text-xs font-medium text-destructive/80 hover:bg-destructive/10 hover:text-destructive [&_svg]:size-3.5",
} as const;
