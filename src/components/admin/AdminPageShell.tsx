import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ReactNode } from "react";

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
}

export function AdminPageShell({
  title,
  description,
  breadcrumbs,
  children,
  actions,
}: AdminPageShellProps) {
  return (
    <div className="min-h-screen bg-muted/30 py-6 sm:py-8">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4"
            aria-label="Breadcrumb"
          >
            <Link
              to="/admin"
              className="hover:text-foreground transition-colors"
            >
              Admin
            </Link>
            {breadcrumbs.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
                {item.href ? (
                  <Link
                    to={item.href}
                    className="hover:text-foreground transition-colors"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-foreground font-medium">
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
