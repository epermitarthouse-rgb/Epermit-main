import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AdminPageShellProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
  /** Optional actions (e.g. buttons) to show in the header */
  actions?: ReactNode;
  /** When true, omit title/description/actions row (full editorial layout in children). */
  contentOnly?: boolean;
  /** Max width of inner container (Tailwind class fragment). */
  maxWidthClass?: string;
  /** Optional outer wrapper classes (e.g. editorial full-page background). */
  wrapperClassName?: string;
  /** Cream editorial chrome for in-app admin (vs gray legacy shell). */
  variant?: "default" | "editorial";
  /** Lovable-style eyebrow above the title */
  eyebrow?: string;
}

export function AdminPageShell({
  title,
  description,
  breadcrumbs,
  children,
  actions,
  contentOnly,
  maxWidthClass = "max-w-6xl",
  wrapperClassName,
  variant = "default",
  eyebrow = "Admin Control Center",
}: AdminPageShellProps) {
  const editorial = variant === "editorial";
  return (
    <div className={cn("space-y-6", wrapperClassName)}>
      <div className={cn(`w-full ${maxWidthClass} mx-auto`)}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground"
            aria-label="Breadcrumb"
          >
            <Link to="/admin" className="transition-colors hover:text-foreground">
              Admin
            </Link>
            {breadcrumbs.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                {item.href ? (
                  <Link
                    to={item.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        {!contentOnly && (
          <header className="mb-6 flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="pilot-kicker text-primary">{eyebrow}</div>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                {title}
              </h1>
              {description && (
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
            )}
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
