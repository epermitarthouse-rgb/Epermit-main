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
    <div className="flex flex-col gap-2">
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

      <nav className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b bg-muted/50 px-1 py-2 text-sm">
        <Link
          to="/baltimore"
          className={cn(
            "font-medium transition-colors hover:text-foreground",
            activeModule === "home" ? "text-foreground" : "text-muted-foreground"
          )}
        >
          Home
        </Link>
        <Link
          to="/baltimore/permits"
          className={cn(
            "font-medium transition-colors hover:text-foreground",
            activeModule === "permits" ? "text-foreground" : "text-muted-foreground"
          )}
        >
          Permits and Inspections
        </Link>
        {isPermits && showSearchApplicationsLink && (
          <>
            <span className="text-muted-foreground">·</span>
            <Link
              to="/baltimore/records"
              className={cn(
                "font-medium transition-colors hover:text-foreground",
                permitsSubActive === "search" ? "text-foreground" : "text-muted-foreground"
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
