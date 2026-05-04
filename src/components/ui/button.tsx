import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium font-tight ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/35",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background text-foreground hover:bg-muted hover:border-primary/40 dark:border-border dark:bg-card/40 dark:hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        soft: "bg-primary/10 text-primary hover:bg-primary/20 backdrop-blur-sm",
        hero: "bg-primary text-primary-foreground shadow-lg shadow-primary/40 hover:bg-primary-glow hover:shadow-glow hover:shadow-primary/40 uppercase tracking-wider text-xs px-6",
        "hero-outline":
          "border-2 border-primary bg-transparent text-primary hover:bg-primary/10 uppercase tracking-wider text-xs px-6 dark:border-white/90 dark:text-white dark:hover:bg-white/10",
        navy: "bg-navy text-navy-foreground shadow-md hover:bg-navy/90 dark:shadow-black/30",
        "navy-outline":
          "border-2 border-navy bg-transparent text-navy hover:bg-navy/10 dark:border-border dark:text-foreground dark:hover:bg-muted",
        /** Commun-ET editorial (Prompt 5) — additive only */
        gold:
          "bg-gold text-cream hover:bg-gold-deep shadow-cream focus-visible:ring-gold/40 focus-visible:ring-offset-0 dark:text-cream",
        outlineGold:
          "border border-gold bg-transparent text-gold shadow-none hover:bg-gold hover:text-cream focus-visible:ring-gold/40 focus-visible:ring-offset-0",
        ghostLight:
          "bg-transparent text-ink-secondary-light shadow-none hover:bg-cream-raised hover:text-ink-primary-light focus-visible:ring-gold/40 focus-visible:ring-offset-0 dark:hover:bg-obsidian-raised dark:hover:text-ink-primary-dark",
        ghostDark:
          "bg-transparent text-ink-secondary-dark shadow-none hover:bg-obsidian-raised hover:text-ink-primary-dark focus-visible:ring-teal/40 focus-visible:ring-offset-0",
        tealData:
          "border border-teal/30 bg-teal/10 text-teal shadow-none hover:bg-teal/15 focus-visible:ring-teal/40 focus-visible:ring-offset-0",
        dangerSoft:
          "border border-red-300/40 bg-red-500/10 text-red-600 shadow-none hover:bg-red-500/15 focus-visible:ring-red-500/30 focus-visible:ring-offset-0 dark:text-red-400",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-12 rounded-xl px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
