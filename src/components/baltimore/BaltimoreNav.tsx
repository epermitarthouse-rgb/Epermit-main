import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

interface BaltimoreNavProps {
  activeModule: "home" | "permits" | "contractors";
  permitsSubActive?: "search" | null;
  /** When false (e.g. embedded in /portal-data), hide "Search Applications" so user stays on selected record. */
  showSearchApplicationsLink?: boolean;
}

export function BaltimoreNav({
  activeModule,
  permitsSubActive = null,
  showSearchApplicationsLink = true,
}: BaltimoreNavProps) {
  const isPermits = activeModule === "permits";

  return (
    <div className="flex flex-col gap-2 text-ink-secondary-light">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/baltimore">Baltimore</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {isPermits ? (
              <BreadcrumbPage>Permits and Inspections</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link to="/baltimore/permits">Permits and Inspections</Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <nav className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-cream-sunken bg-cream-raised/90 px-2 py-2.5 text-sm rounded-t-xl shadow-inner">
        <Link
          to="/baltimore"
          className={cn(
            "font-medium transition-colors hover:text-gold-deep",
            activeModule === "home" ? "text-gold-deep" : "text-ink-secondary-light",
          )}
        >
          Home
        </Link>
        <Link
          to="/baltimore/permits"
          className={cn(
            "font-medium transition-colors hover:text-gold-deep",
            activeModule === "permits" ? "text-gold-deep" : "text-ink-secondary-light",
          )}
        >
          Permits and Inspections
        </Link>
        {isPermits && showSearchApplicationsLink && (
          <>
            <span className="text-ink-tertiary-light">·</span>
            <Link
              to="/baltimore/records"
              className={cn(
                "font-medium transition-colors hover:text-gold-deep",
                permitsSubActive === "search" ? "text-gold-deep" : "text-ink-secondary-light",
              )}
            >
              Search Applications
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
