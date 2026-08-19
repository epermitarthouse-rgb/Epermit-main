import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardList,
  CloudDownload,
  DollarSign,
  FileCheck2,
  Gauge,
  Inbox,
  Map,
  Network,
  PlugZap,
  Radio,
  Ticket,
  Zap,
} from "lucide-react";

/**
 * Expandable UCI sidebar + deep-link (`/uci?section=`) vocabulary.
 * Lovable labels; PermitPilot destinations only (no fake routes).
 *
 * Primary Intelligence silhouette (expand under Utility Coordination):
 * Submissions · Inbox · Class of Service · CIAC · Energization ·
 * Miss Utility 811 · Knowledge Graph · UCI Builder
 *
 * Demoted items stay reachable via hub tiles / drawer / existing routes.
 */
export type UciNavSupport = "active" | "foundation" | "manual" | "contextual";
export type UciNavGroup = "operations" | "foundations" | "contextual";

/** Drawer tabs after coordination detail is open */
export type UciDrawerTab =
  | "overview"
  | "portal-sync"
  | "applications"
  | "communications"
  | "documents"
  | "load-profile"
  | "application-prep"
  | "energization-closeout"
  | "lifecycle"
  | "cos"
  | "costs";

export type UciNavSectionId =
  | "overview"
  | "submissions"
  | "communications"
  | "needs-attention"
  | "provider-directory"
  | "class-of-service"
  | "ciac"
  | "energization"
  | "load-profile"
  | "provider-map"
  | "application-builder"
  | "meter-set"
  | "miss-utility"
  | "knowledge-graph"
  | "conflicts"
  | "portfolio"
  | "portal-harvest";

export type UciNavSection = {
  id: UciNavSectionId;
  label: string;
  icon: LucideIcon;
  support: UciNavSupport;
  navGroup: UciNavGroup;
  /** Deep link query value */
  section: UciNavSectionId;
  /**
   * Where the click lands:
   * - hub: stay on hub (scroll/highlight)
   * - drawer-tab: prefer this drawer tab after an explicit record selection
   *   (or ?coordination= deep link); section navigation alone must not open the drawer
   * - external: navigate away from /uci
   * - coming-soon: show non-functional preview on hub
   */
  target:
    | { kind: "hub"; anchor?: string }
    | { kind: "drawer-tab"; tab: UciDrawerTab }
    | { kind: "external"; href: string }
    | { kind: "coming-soon" };
  /** Short copy for Coming Soon / WIP banners */
  note?: string;
  /** Permanent Utility Coordination navigation */
  primaryNav?: boolean;
  /** Demoted from sidebar — keep reachable from UCI hub tiles */
  hubTile?: boolean;
  /** Optional hub tile subtitle */
  hubDescription?: string;
};

export const UCI_DRAWER_TABS: {
  id: UciDrawerTab;
  label: string;
  workspace: string;
  pepcoOnly?: boolean;
}[] = [
  { id: "overview", label: "Overview", workspace: "Record" },
  { id: "portal-sync", label: "Portal sync", workspace: "Intake", pepcoOnly: true },
  { id: "documents", label: "Documents", workspace: "Stages 2–4" },
  { id: "load-profile", label: "Load profile", workspace: "Stages 2–4" },
  { id: "application-prep", label: "Application package", workspace: "Stages 2–4" },
  { id: "applications", label: "Utility applications", workspace: "Coordination" },
  { id: "communications", label: "Communications", workspace: "Stage 5 · Utility acknowledgment" },
  { id: "cos", label: "Class of Service", workspace: "Decision & costs" },
  { id: "costs", label: "Costs & equipment", workspace: "Costs" },
  { id: "energization-closeout", label: "Energization & closeout", workspace: "Stages 8–10" },
  { id: "lifecycle", label: "Lifecycle history", workspace: "Record" },
];

export const UCI_RECORD_WORKSPACE_GROUPS: Array<{
  /** Primary milestone label in the workflow navigator */
  label: string;
  /** Compact label for dense / mobile stepper chips */
  shortLabel: string;
  tabs: UciDrawerTab[];
  /**
   * Lifecycle stages this group covers for progress styling.
   * `null` = supporting/activity group (never marked completed by stage alone).
   */
  stageRange: [number, number] | null;
}> = [
  { label: "Setup", shortLabel: "Setup", tabs: ["overview"], stageRange: [0, 1] },
  {
    label: "Load, application & submission",
    shortLabel: "Prepare & submit",
    tabs: ["documents", "load-profile", "application-prep"],
    stageRange: [2, 4],
  },
  {
    label: "Utility response",
    shortLabel: "Utility response",
    tabs: ["applications", "communications", "cos"],
    stageRange: [5, 6],
  },
  { label: "Costs", shortLabel: "Costs", tabs: ["costs"], stageRange: [7, 7] },
  {
    label: "Energization & closeout",
    shortLabel: "Energize",
    tabs: ["energization-closeout"],
    stageRange: [8, 10],
  },
  {
    label: "Activity & automation",
    shortLabel: "Activity",
    tabs: ["portal-sync", "lifecycle"],
    stageRange: null,
  },
];

/**
 * Full UCI section catalog (deep-links + hub). Sidebar uses
 * {@link UCI_PRIMARY_NAV_SECTIONS} only — Active/Foundation/Manual badges;
 * unfinished foundations stay labeled separately from UAT-verified operations queues.
 */
export const UCI_NAV_SECTIONS: UciNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Gauge,
    support: "active",
    navGroup: "contextual",
    section: "overview",
    target: { kind: "hub", anchor: "uci-hub" },
    note: "UCI hub — KPIs, stage rail, records, attention queue",
    primaryNav: false,
    hubTile: false,
  },
  {
    id: "submissions",
    label: "Submission Tracker",
    icon: Radio,
    support: "active",
    navGroup: "operations",
    section: "submissions",
    target: { kind: "external", href: "/uci/submissions" },
    note: "Submission and Confirmation Tracker — prepare, preview, and send.",
    primaryNav: true,
  },
  {
    id: "communications",
    label: "Inbox",
    icon: Inbox,
    support: "active",
    navGroup: "operations",
    section: "communications",
    target: { kind: "external", href: "/uci/inbox" },
    note: "Stage 5 utility acknowledgment inbox — cross-project view with Confirm/Flag; full review in record workspace.",
    primaryNav: true,
  },
  {
    id: "needs-attention",
    label: "Needs Attention",
    icon: AlertTriangle,
    support: "active",
    navGroup: "operations",
    section: "needs-attention",
    target: { kind: "external", href: "/uci/needs-attention" },
    note: "Stage 5 communications and application readiness queues with deep links to the record workspace.",
    primaryNav: true,
  },
  {
    id: "portfolio",
    label: "Portfolio",
    icon: ClipboardList,
    support: "active",
    navGroup: "operations",
    section: "portfolio",
    target: { kind: "external", href: "/uci/portfolio" },
    note: "Cross-project portfolio foundation; no invented tenant KPIs.",
    primaryNav: true,
  },
  {
    id: "portal-harvest",
    label: "Portal Harvest",
    icon: CloudDownload,
    support: "active",
    navGroup: "operations",
    section: "portal-harvest",
    target: { kind: "external", href: "/uci/portal-harvest" },
    note: "Provider-account inventory with explicit project and coordination links.",
    primaryNav: true,
  },
  {
    id: "provider-directory",
    label: "Provider Directory",
    icon: PlugZap,
    support: "active",
    navGroup: "operations",
    section: "provider-directory",
    target: { kind: "external", href: "/uci/provider-directory" },
    note: "Utility provider reference and setup entry point.",
    primaryNav: true,
  },
  {
    id: "class-of-service",
    label: "Class of Service",
    icon: FileCheck2,
    support: "foundation",
    navGroup: "foundations",
    section: "class-of-service",
    target: { kind: "external", href: "/uci/class-of-service" },
    note: "Advisory and utility-issued COS are kept distinct.",
    primaryNav: true,
  },
  {
    id: "ciac",
    label: "CIAC & Refunds",
    icon: DollarSign,
    support: "manual",
    navGroup: "foundations",
    section: "ciac",
    target: { kind: "external", href: "/uci/ciac-refunds" },
    note: "Manual foundation; refund assessment defaults to NOT_ASSESSED.",
    primaryNav: true,
  },
  {
    id: "energization",
    label: "Energization",
    icon: Zap,
    support: "manual",
    navGroup: "foundations",
    section: "energization",
    target: { kind: "external", href: "/uci/energization" },
    note: "Human-gated planning foundation; meter set and closeout remain record work.",
    primaryNav: true,
  },
  {
    id: "load-profile",
    label: "Load Profile",
    icon: Gauge,
    support: "active",
    navGroup: "contextual",
    section: "load-profile",
    target: { kind: "drawer-tab", tab: "load-profile" },
    note: "Open a coordination record, then use the Load profile drawer tab.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Drawer · load analysis",
  },
  {
    id: "miss-utility",
    label: "Miss Utility 811",
    icon: Ticket,
    support: "manual",
    navGroup: "foundations",
    section: "miss-utility",
    target: { kind: "external", href: "/uci/miss-utility" },
    note: "Manual ticket foundation; no automatic 811 filing.",
    primaryNav: true,
  },
  {
    id: "knowledge-graph",
    label: "Knowledge",
    icon: Network,
    support: "foundation",
    navGroup: "foundations",
    section: "knowledge-graph",
    target: { kind: "external", href: "/uci/knowledge" },
    note: "History-search foundation; no claim of a live knowledge graph.",
    primaryNav: true,
  },
  {
    id: "application-builder",
    label: "UCI Builder",
    icon: FileCheck2,
    support: "contextual",
    navGroup: "contextual",
    section: "application-builder",
    target: { kind: "drawer-tab", tab: "application-prep" },
    note: "Secondary alias into the Stages 2–4 application package workflow.",
    primaryNav: false,
  },
  {
    id: "provider-map",
    label: "Utility Territory Map",
    icon: Map,
    support: "foundation",
    navGroup: "foundations",
    section: "provider-map",
    target: { kind: "external", href: "/uci/utility-territory-map" },
    note: "Utility territory foundation. It is not the municipal Jurisdiction Map.",
    primaryNav: true,
  },
  {
    id: "meter-set",
    label: "Meter Set",
    icon: PlugZap,
    support: "contextual",
    navGroup: "contextual",
    section: "meter-set",
    target: { kind: "drawer-tab", tab: "energization-closeout" },
    note: "Coming soon — richer meter-set scheduling. The real meter-set and closeout workflow is in Energization & closeout.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Drawer · meter-set / closeout",
  },
  {
    id: "conflicts",
    label: "Conflicts",
    icon: AlertTriangle,
    support: "manual",
    navGroup: "foundations",
    section: "conflicts",
    target: { kind: "external", href: "/uci/conflicts" },
    note: "Manual conflict register foundation; no unsupported detection claims.",
    primaryNav: true,
  },
];

/** Approved operational and foundation destinations under Utility Coordination. */
export const UCI_PRIMARY_NAV_SECTIONS: UciNavSection[] = UCI_NAV_SECTIONS.filter((s) => s.primaryNav);
export const UCI_OPERATION_NAV_SECTIONS = UCI_PRIMARY_NAV_SECTIONS.filter((s) => s.navGroup === "operations");
export const UCI_FOUNDATION_NAV_SECTIONS = UCI_PRIMARY_NAV_SECTIONS.filter((s) => s.navGroup === "foundations");

/** Demoted capabilities — hub tiles so features are not orphaned. */
export const UCI_HUB_TILE_SECTIONS: UciNavSection[] = UCI_NAV_SECTIONS.filter((s) => s.hubTile);

export function getUciNavSection(id: string | null | undefined): UciNavSection | undefined {
  if (!id) return undefined;
  return UCI_NAV_SECTIONS.find((s) => s.id === id || s.section === id);
}

export function isUciDrawerTab(value: string | null | undefined): value is UciDrawerTab {
  return UCI_DRAWER_TABS.some((t) => t.id === value);
}

/** Build /uci deep link */
export function uciSectionHref(section: UciNavSectionId, extras?: { tab?: UciDrawerTab; coordination?: string }) {
  const params = new URLSearchParams();
  params.set("section", section);
  if (extras?.tab) params.set("tab", extras.tab);
  if (extras?.coordination) params.set("coordination", extras.coordination);
  return `/uci?${params.toString()}`;
}

/** Sidebar status chip for implemented UCI destinations. */
export function uciSidebarBadgeLabel(support?: UciNavSupport): "Active" | "Foundation" | "Manual" | null {
  if (support === "active") return "Active";
  if (support === "foundation") return "Foundation";
  if (support === "manual") return "Manual";
  return null;
}
