import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md px-3 py-2 text-base font-sans",
          "border border-cream-sunken bg-cream-raised text-ink-primary-light",
          "placeholder:text-ink-tertiary-light",
          "ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-gold/40",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "dark:border-obsidian-raised dark:bg-obsidian-sunken dark:text-ink-primary-dark dark:placeholder:text-ink-tertiary-dark dark:ring-offset-background",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
