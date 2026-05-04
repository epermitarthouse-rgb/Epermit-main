import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold font-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        success: "border-transparent bg-success text-success-foreground hover:bg-success/85",
        warning: "border-transparent bg-warning text-warning-foreground hover:bg-warning/90",
        outline: "border-border/80 text-foreground dark:border-border dark:bg-transparent",
        /** Commun-ET editorial (Prompt 5) — additive only */
        brand: "border border-gold/30 bg-gold/10 text-gold hover:bg-gold/15",
        ai: "border border-teal/30 bg-teal/10 text-teal hover:bg-teal/15",
        mutedLight:
          "border border-cream-sunken bg-cream-raised text-ink-tertiary-light",
        mutedDark:
          "border border-obsidian-raised bg-obsidian-sunken text-ink-tertiary-dark",
        outlineWarning:
          "border border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-500",
        outlineDanger:
          "border border-red-500/30 bg-red-500/10 text-red-500 dark:text-red-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
