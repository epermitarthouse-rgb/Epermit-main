import type { LucideIcon } from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Eyebrow } from "@/components/ui/Typography";
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

export function EditorialPageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  iconClassName = "text-gold-deep",
  actions,
  align = "left",
  className,
}: EditorialPageHeaderProps) {
  const isCenter = align === "center";
  return (
    <Section
      variant="cream"
      className={cn(
        "border-b border-cream-sunken px-5 pt-10 pb-8 sm:px-6 sm:pt-11 sm:pb-10 md:px-8",
        className,
      )}
    >
      <div className={cn("mx-auto w-full max-w-7xl", isCenter && "text-center")}>
        {Icon ? (
          <div className={cn("mb-4", isCenter ? "flex justify-center" : "flex")}>
            <Icon className={cn("h-9 w-9 sm:h-10 sm:w-10", iconClassName)} aria-hidden />
          </div>
        ) : null}
        <Eyebrow className={cn("mb-2", isCenter && "mx-auto w-max max-w-full")}>{eyebrow}</Eyebrow>
        <div
          className={cn(
            isCenter ? "mx-auto max-w-3xl" : "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between",
          )}
        >
          <div className={cn("min-w-0", isCenter && "text-center")}>
            <h1 className="font-display text-3xl font-normal leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base lg:mx-0">
                {description}
              </div>
            ) : null}
          </div>
          {actions && !isCenter ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 lg:pt-0">{actions}</div>
          ) : null}
        </div>
        {actions && isCenter ? (
          <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
        ) : null}
      </div>
    </Section>
  );
}
