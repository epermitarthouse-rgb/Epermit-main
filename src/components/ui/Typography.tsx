import React from "react";

import { cn } from "@/lib/utils";

type ChildrenProps = {
  children: React.ReactNode;
  className?: string;
};

export const Eyebrow = ({ children, className = "" }: ChildrenProps) => (
  <span className={cn("block text-[11px] font-tight font-bold uppercase tracking-[0.18em] text-gold", className)}>
    {children}
  </span>
);

export const EyebrowDark = ({ children, className = "" }: ChildrenProps) => (
  <span className={cn("block text-[11px] font-tight font-bold uppercase tracking-[0.18em] text-teal", className)}>
    {children}
  </span>
);

export const PageTitle = ({ children, className = "" }: ChildrenProps) => (
  <h1 className={cn("font-display text-5xl md:text-6xl font-normal leading-[1.05] tracking-tight", className)}>{children}</h1>
);

export const SectionTitle = ({ children, className = "" }: ChildrenProps) => (
  <h2 className={cn("font-display text-3xl md:text-4xl font-normal leading-tight", className)}>{children}</h2>
);

export const HeroNumber = ({
  children,
  suffix,
  className = "",
}: ChildrenProps & { suffix?: string }) => (
  <div className={cn("font-display text-7xl md:text-8xl leading-none", className)}>
    {children}
    {suffix && <sup className="ml-1 text-3xl text-gold">{suffix}</sup>}
  </div>
);
