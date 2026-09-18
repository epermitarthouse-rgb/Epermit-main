import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

type SubNavItem = {
  label: string;
  href: string;
};

const PLATFORM_CONTROL_ITEMS: SubNavItem[] = [
  { label: "Jurisdictions", href: "/admin/platform/jurisdictions" },
  { label: "Notifications", href: "/admin/platform/notifications" },
  { label: "Campaigns", href: "/admin/platform/campaigns" },
  { label: "Feature Flags", href: "/admin/feature-flags" },
];

function isPlatformControlRoute(pathname: string) {
  return pathname.startsWith("/admin/platform") || pathname === "/admin/feature-flags";
}

function SubNavBar({ items, title }: { items: SubNavItem[]; title: string }) {
  const { pathname } = useLocation();

  return (
    <nav
      className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-4"
      aria-label={`${title} navigation`}
    >
      <span className="mr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </span>
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSubNav() {
  const { pathname } = useLocation();

  if (isPlatformControlRoute(pathname)) {
    return <SubNavBar title="Platform Control" items={PLATFORM_CONTROL_ITEMS} />;
  }

  return null;
}
