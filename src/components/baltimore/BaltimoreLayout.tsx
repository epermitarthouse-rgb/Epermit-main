import { ReactNode } from "react";
import { BaltimoreNav } from "./BaltimoreNav";

interface BaltimoreLayoutProps {
  children: ReactNode;
  /** Which section is active for nav highlighting */
  activeModule?: "home" | "permits" | "contractors";
  /** When on permits, highlight Search Applications */
  permitsSubActive?: "search" | null;
  /** When false, hide "Search Applications" link (e.g. embedded in /portal-data viewing selected record). */
  showSearchApplicationsLink?: boolean;
}

export function BaltimoreLayout({
  children,
  activeModule = "home",
  permitsSubActive = null,
  showSearchApplicationsLink = true,
}: BaltimoreLayoutProps) {
  return (
    <div className="min-h-full space-y-6">
      <BaltimoreNav
        activeModule={activeModule}
        permitsSubActive={permitsSubActive}
        showSearchApplicationsLink={showSearchApplicationsLink}
      />
      <main className="space-y-6">{children}</main>
    </div>
  );
}
