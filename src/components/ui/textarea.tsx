import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-cream-sunken bg-cream-raised px-3 py-2 text-sm text-ink-primary-light",
        "placeholder:text-ink-tertiary-light ring-offset-background",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-gold/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-obsidian-raised dark:bg-obsidian-sunken dark:text-ink-primary-dark dark:placeholder:text-ink-tertiary-dark",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
