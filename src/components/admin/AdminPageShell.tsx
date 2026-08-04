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
}

export function AdminPageShell({
  title,
  description,
  breadcrumbs,
  children,
  actions,
  contentOnly,
  maxWidthClass = "max-w-5xl",
  wrapperClassName,
  variant = "default",
}: AdminPageShellProps) {
  const editorial = variant === "editorial";
  return (
    <div
      className={cn(
        editorial ? "min-h-screen bg-cream py-6 text-ink-primary-light sm:py-8" : "min-h-screen bg-muted/30 py-6 sm:py-8",
        wrapperClassName,
      )}
    >
      <div className={cn(`w-full ${maxWidthClass} mx-auto px-4 sm:px-6`)}>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            className={cn(
              "flex items-center gap-1.5 text-sm mb-4",
              editorial ? "text-ink-secondary-light" : "text-muted-foreground",
            )}
            aria-label="Breadcrumb"
          >
            <Link
              to="/admin"
              className={cn(
                editorial ? "hover:text-ink-primary-light transition-colors" : "hover:text-foreground transition-colors",
              )}
            >
              Admin
            </Link>
            {breadcrumbs.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                {item.href ? (
                  <Link
                    to={item.href}
                    className={cn(
                      editorial ? "hover:text-ink-primary-light transition-colors" : "hover:text-foreground transition-colors",
                    )}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "font-medium",
                      editorial ? "text-ink-primary-light" : "text-foreground",
                    )}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        {!contentOnly && (
          <div
            className={cn(
              "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6",
              editorial && "border-b border-cream-sunken/70 pb-6",
            )}
          >
            <div>
              <h1
                className={cn(
                  editorial
                    ? "font-display text-2xl font-normal tracking-tight text-ink-primary-light sm:text-3xl"
                    : "text-2xl sm:text-3xl font-bold tracking-tight",
                )}
              >
                {title}
              </h1>
              {description && (
                <p className={cn("mt-1", editorial ? "text-ink-secondary-light" : "text-muted-foreground")}>
                  {description}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
