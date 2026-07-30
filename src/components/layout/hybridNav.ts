import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  FileQuestion,
  FileSignature,
  FileText,
  Flag,
  Gauge,
  Globe,
  HelpCircle,
  Layers,
  ListChecks,
  ListTodo,
  Map,
  MessageSquare,
  Palette,
  PlayCircle,
  RadioTower,
  Rocket,
  Scale,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Table2,
  Users,
  WalletCards,
} from "lucide-react";

export type HybridNavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description?: string;
  requiresAuth?: boolean;
  /** Labeled roadmap / preview item — not a live production feature */
  comingSoon?: boolean;
  /** Admin-gated preview placeholder */
  adminPreview?: boolean;
};

export type HybridNavGroup = {
  label: string;
  items: HybridNavItem[];
  /** Only render when user is signed in */
  requiresAuth?: boolean;
  /** Only render for admins */
  requiresAdmin?: boolean;
  defaultOpen?: boolean;
};

/**
 * Hybrid IA: Lovable group labels + PermitPilot production hrefs.
 * Placeholders only for §3.5 visible / admin_preview items.
 */
export const hybridNavGroups: HybridNavGroup[] = [
  {
    label: "Command",
    defaultOpen: true,
    items: [
      { title: "Dashboard", href: "/dashboard", icon: Gauge, requiresAuth: true },
      { title: "Projects", href: "/projects", icon: Briefcase, requiresAuth: true },
      {
        title: "Permit Queue",
        href: "/permit-queue",
        icon: ListTodo,
        description: "Coming soon — aggregate filings & scrape jobs",
        requiresAuth: true,
        comingSoon: true,
      },
      {
        title: "Demo",
        href: "/demo/mcdonalds",
        icon: Sparkles,
        description: "McDonald's executive demo",
        requiresAuth: true,
      },
      {
        title: "Demos",
        href: "/demos",
        icon: PlayCircle,
        description: "Interactive product demos",
      },
    ],
  },
  {
    label: "Onboarding",
    requiresAuth: true,
    defaultOpen: true,
    items: [
      {
        title: "Client Authorization (LOA)",
        href: "/onboarding/authorization",
        icon: FileSignature,
        description: "Letter of Authorization",
        requiresAuth: true,
      },
    ],
  },
  {
    label: "Delivery",
    requiresAuth: true,
    defaultOpen: true,
    items: [
      {
        title: "Permit Filing",
        href: "/permit-wizard-filing",
        icon: Rocket,
        description: "Multi-municipality filing pipeline",
        requiresAuth: true,
      },
      {
        title: "Response Matrix",
        href: "/response-matrix",
        icon: MessageSquare,
        description: "Manage comment responses",
        requiresAuth: true,
      },
      {
        title: "Portal Harvest",
        href: "/portal-data",
        icon: Globe,
        description: "Gather & view portal data",
        requiresAuth: true,
      },
    ],
  },
  {
    label: "Intelligence",
    defaultOpen: true,
    items: [
      {
        title: "Code Analyzer",
        href: "/code-compliance",
        icon: ShieldCheck,
        description: "Check code compliance",
        requiresAuth: true,
      },
      {
        title: "Utility Coordination",
        href: "/uci",
        icon: RadioTower,
        description: "Utility provider lifecycle",
        requiresAuth: true,
      },
      {
        title: "Permit Intelligence",
        href: "/permit-intelligence",
        icon: Search,
        description: "Search permit data",
      },
      {
        title: "Jurisdiction Map",
        href: "/jurisdictions/map",
        icon: Map,
        description: "Interactive coverage map",
      },
      {
        title: "Provider Compare",
        href: "/jurisdictions/compare",
        icon: Scale,
        description: "Side-by-side comparison",
      },
      {
        title: "Code Library",
        href: "/code-reference",
        icon: BookOpen,
        description: "Reference materials",
      },
    ],
  },
  {
    label: "Resources",
    defaultOpen: false,
    items: [
      {
        title: "Checklists",
        href: "/checklist-history",
        icon: FileText,
        description: "Saved checklists",
        requiresAuth: true,
      },
      {
        title: "Analytics & Reporting",
        href: "/analytics",
        icon: BarChart3,
        description: "Reports & metrics",
      },
      {
        title: "ROI Calculator",
        href: "/roi-calculator",
        icon: Calculator,
        description: "Calculate savings",
      },
      {
        title: "Tool Consolidation",
        href: "/consolidation-calculator",
        icon: Layers,
        description: "Compare tool costs",
      },
      {
        title: "Pricing",
        href: "/pricing",
        icon: WalletCards,
      },
    ],
  },
  {
    label: "Admin",
    requiresAdmin: true,
    defaultOpen: false,
    items: [
      { title: "Overview", href: "/admin", icon: Shield, description: "Admin home" },
      {
        title: "Jurisdictions",
        href: "/admin/jurisdictions",
        icon: Building2,
        description: "Manage jurisdictions",
      },
      {
        title: "Feature Flags",
        href: "/admin/feature-flags",
        icon: Flag,
        description: "Toggle features",
      },
      {
        title: "Shadow Mode",
        href: "/admin/shadow-mode",
        icon: Shield,
        description: "AI pipeline metrics",
      },
      {
        title: "Architecture Replication",
        href: "/admin/architecture-replication",
        icon: ListChecks,
        description: "Lovable → PermitPilot checklist",
      },
      {
        title: "Authorizations",
        href: "/admin/authorizations",
        icon: FileSignature,
        description: "Preview — LOA admin (not live)",
        comingSoon: true,
        adminPreview: true,
      },
      {
        title: "Members",
        href: "/admin/members",
        icon: Users,
        description: "Preview — workspace members (not live)",
        comingSoon: true,
        adminPreview: true,
      },
      {
        title: "Audit",
        href: "/admin/audit",
        icon: ScrollText,
        description: "Preview — access audit (not live)",
        comingSoon: true,
        adminPreview: true,
      },
    ],
  },
  {
    label: "Help & Support",
    defaultOpen: false,
    items: [
      {
        title: "Documentation",
        href: "/api-docs",
        icon: FileQuestion,
        description: "API docs & guides",
      },
      {
        title: "Glossary",
        href: "/reference/glossary",
        icon: BookMarked,
        description: "Coming soon — shared terminology",
        requiresAuth: true,
        comingSoon: true,
      },
      { title: "FAQ", href: "/faq", icon: HelpCircle, description: "Common questions" },
      {
        title: "Contact Support",
        href: "/contact",
        icon: MessageSquare,
        description: "Get help from our team",
      },
      {
        title: "Design preview",
        href: "/design-system-preview",
        icon: Palette,
        description: "Theme & component mock (internal)",
        requiresAuth: true,
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        requiresAuth: true,
      },
    ],
  },
];

/** Page titles for Lovable-style shell breadcrumbs (PP routes). */
export const pageTitles: Record<string, string> = {
  "/": "Home",
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/projects/new": "Projects · New",
  "/permit-queue": "Permit Queue",
  "/demo/mcdonalds": "Demo · McDonald's",
  "/demos": "Demos",
  "/onboarding/authorization": "Client Authorization (LOA)",
  "/delivery/authorization": "Client Authorization (LOA)",
  "/permit-wizard-filing": "Permit Filing",
  "/response-matrix": "Response Matrix",
  "/portal-data": "Portal Harvest",
  "/comment-review": "Comment Review",
  // Legacy path redirects to Response Matrix; title kept for shell flash only
  "/classified-comments": "Response Matrix",
  "/code-compliance": "Code Compliance Analyzer",
  "/uci": "Utility Coordination",
  "/permit-intelligence": "Permit Intelligence",
  "/jurisdictions/map": "Jurisdiction Map",
  "/jurisdictions/compare": "Provider Compare",
  "/code-reference": "Code Library",
  "/checklist-history": "Checklist History",
  "/analytics": "Analytics & Reporting",
  "/roi-calculator": "ROI Calculator",
  "/consolidation-calculator": "Tool Consolidation",
  "/pricing": "Pricing",
  "/admin": "Admin Console",
  "/admin/jurisdictions": "Admin · Jurisdictions",
  "/admin/feature-flags": "Admin · Feature Flags",
  "/admin/shadow-mode": "Admin · Shadow Mode",
  "/admin/architecture-replication": "Admin · Architecture Replication",
  "/admin/authorizations": "Admin · Authorizations",
  "/admin/members": "Admin · Members",
  "/admin/audit": "Admin · Audit",
  "/api-docs": "Documentation",
  "/reference/glossary": "Glossary",
  "/faq": "FAQ",
  "/contact": "Contact Support",
  "/design-system-preview": "Design Preview",
  "/settings": "Settings",
};

export function resolvePageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/jurisdictions/")) return "Jurisdiction";
  if (pathname.startsWith("/projects/")) return "Project";
  if (pathname.startsWith("/admin/")) return "Admin";
  if (pathname.startsWith("/uci")) return "Utility Coordination";
  return "PermitPilot";
}
