import React from "react";

import { cn } from "@/lib/utils";

type SectionProps = {
  variant: "cream" | "obsidian";
  children: React.ReactNode;
  className?: string;
};

export const Section = ({ variant, children, className = "" }: SectionProps) => {
  const styles =
    variant === "cream" ? "bg-cream text-ink-primary-light" : "bg-obsidian text-ink-primary-dark";

  return <section className={cn(styles, "px-6 md:px-8", className)}>{children}</section>;
};
