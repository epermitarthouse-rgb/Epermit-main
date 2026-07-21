import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorialPageHeaderProps = {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  iconClassName?: string;
  actions?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
};

/**
 * Lovable-aligned page header (PageHeader chrome).
 * Keeps the EditorialPageHeader API so existing pages keep working.
 */
export function EditorialPageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClassName = "text-primary",
  actions,
  align = "left",
  className,
}: EditorialPageHeaderProps) {
  const isCenter = align === "center";
  return (
    <header
      className={cn(
        "border-b border-border/70 bg-background/80 px-4 py-5 backdrop-blur-sm md:px-6 lg:px-8",
        className,
      )}
    >
      <div className={cn("mx-auto w-full max-w-7xl", isCenter && "text-center")}>
        {Icon ? (
          <div className={cn("mb-3", isCenter ? "flex justify-center" : "flex")}>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Icon className={cn("h-5 w-5", iconClassName)} aria-hidden />
            </div>
          </div>
        ) : null}
        <p className={cn("pilot-kicker mb-1.5", isCenter && "mx-auto w-max max-w-full")}>{eyebrow}</p>
        <div
          className={cn(
            isCenter ? "mx-auto max-w-3xl" : "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between",
          )}
        >
          <div className={cn("min-w-0", isCenter && "text-center")}>
            <h1 className="font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">{title}</h1>
            {description ? (
              <div className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{description}</div>
            ) : null}
          </div>
          {actions && !isCenter ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1 lg:pt-0">{actions}</div>
          ) : null}
        </div>
        {actions && isCenter ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
