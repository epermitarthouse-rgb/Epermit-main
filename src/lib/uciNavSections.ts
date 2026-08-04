import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Cable,
  ClipboardList,
  DollarSign,
  FileCheck2,
  FileSearch,
  Gauge,
  GitCompare,
  Inbox,
  Map,
  Network,
  PlugZap,
  Radio,
  Ticket,
  Wrench,
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
export type UciNavSupport = "active" | "partial" | "mock";

/** Drawer tabs after coordination detail is open */
export type UciDrawerTab =
  | "overview"
  | "portal-sync"
  | "applications"
  | "communications"
  | "documents"
  | "load-profile"
  | "application-prep"
  | "lifecycle"
  | "cos"
  | "costs";

export type UciNavSectionId =
  | "overview"
  | "submissions"
  | "communications"
  | "class-of-service"
  | "ciac"
  | "energization"
  | "load-profile"
  | "provider-map"
  | "application-builder"
  | "meter-set"
  | "miss-utility"
  | "knowledge-graph"
  | "conflict-hunter"
  | "easement"
  | "portfolio";

export type UciNavSection = {
  id: UciNavSectionId;
  label: string;
  icon: LucideIcon;
  support: UciNavSupport;
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
  /** Lovable-shaped Utility Coordination expand children */
  primaryNav?: boolean;
  /** Demoted from sidebar — keep reachable from UCI hub tiles */
  hubTile?: boolean;
  /** Optional hub tile subtitle */
  hubDescription?: string;
};

export const UCI_DRAWER_TABS: { id: UciDrawerTab; label: string; pepcoOnly?: boolean }[] = [
  { id: "overview", label: "Overview" },
  { id: "portal-sync", label: "Portal sync", pepcoOnly: true },
  { id: "applications", label: "Applications" },
  { id: "communications", label: "Communications" },
  { id: "documents", label: "Documents" },
  { id: "load-profile", label: "Load profile" },
  { id: "application-prep", label: "Application prep" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "cos", label: "Class of Service" },
  { id: "costs", label: "Costs & equipment" },
];

/**
 * Full UCI section catalog (deep-links + hub). Sidebar uses
 * {@link UCI_PRIMARY_NAV_SECTIONS} only — no Partial badges in the shell
 * (whole UCI is WIP → Coming Soon / Soon).
 */
export const UCI_NAV_SECTIONS: UciNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Gauge,
    support: "active",
    section: "overview",
    target: { kind: "hub", anchor: "uci-hub" },
    note: "UCI hub — KPIs, stage rail, records, attention queue",
    primaryNav: false,
    hubTile: false,
  },
  {
    id: "submissions",
    label: "UCI · Submissions",
    icon: Radio,
    support: "mock",
    section: "submissions",
    target: { kind: "drawer-tab", tab: "application-prep" },
    note: "Coming soon — cross-project submissions hub. Per-record Application prep remains in the coordination drawer.",
    primaryNav: true,
  },
  {
    id: "communications",
    label: "UCI · Inbox",
    icon: Inbox,
    support: "mock",
    section: "communications",
    target: { kind: "drawer-tab", tab: "communications" },
    note: "Coming soon — cross-project inbox. Per-record portal communications remain in the coordination drawer.",
    primaryNav: true,
  },
  {
    id: "class-of-service",
    label: "UCI · Class of Service",
    icon: FileCheck2,
    support: "mock",
    section: "class-of-service",
    target: { kind: "drawer-tab", tab: "cos" },
    note: "Coming soon — portfolio COS table. Per-record COS analysis remains in the coordination drawer.",
    primaryNav: true,
  },
  {
    id: "ciac",
    label: "UCI · CIAC & Refunds",
    icon: DollarSign,
    support: "mock",
    section: "ciac",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "Coming soon — dedicated CIAC / refund-window tracker. Cost rows remain in the coordination drawer.",
    primaryNav: true,
  },
  {
    id: "energization",
    label: "UCI · Energization",
    icon: Zap,
    support: "mock",
    section: "energization",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "Coming soon — multi-party energization choreography. Meter-set / closeout remain in the coordination drawer.",
    primaryNav: true,
  },
  {
    id: "load-profile",
    label: "Load Profile",
    icon: FileSearch,
    support: "active",
    section: "load-profile",
    target: { kind: "drawer-tab", tab: "load-profile" },
    note: "Open a coordination record, then use the Load profile drawer tab.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Drawer · load analysis",
  },
  {
    id: "miss-utility",
    label: "UCI · Miss Utility 811",
    icon: Ticket,
    support: "mock",
    section: "miss-utility",
    target: { kind: "coming-soon" },
    note: "No PermitPilot backend for 811 / Miss Utility tickets yet.",
    primaryNav: true,
  },
  {
    id: "knowledge-graph",
    label: "UCI · Knowledge Graph",
    icon: Network,
    support: "mock",
    section: "knowledge-graph",
    target: { kind: "coming-soon" },
    note: "No PermitPilot graph/nodes backend yet.",
    primaryNav: true,
  },
  {
    id: "application-builder",
    label: "UCI Builder",
    icon: Cable,
    support: "mock",
    section: "application-builder",
    target: { kind: "external", href: "/uci/application-builder" },
    note: "Coming soon — full Lovable builder surface. Live package/load APIs remain on /uci/application-builder; owner/billing & Agent QA are not connected.",
    primaryNav: true,
  },
  {
    id: "provider-map",
    label: "Provider Map",
    icon: Map,
    support: "active",
    section: "provider-map",
    target: { kind: "external", href: "/jurisdictions/map" },
    note: "Opens the real Jurisdiction Map (not a mock provider map).",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Jurisdiction Map",
  },
  {
    id: "meter-set",
    label: "Meter Set",
    icon: PlugZap,
    support: "mock",
    section: "meter-set",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "Coming soon — richer meter-set scheduling. Closeout checklist remains in the coordination drawer Costs tab.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Drawer · meter-set / closeout",
  },
  {
    id: "conflict-hunter",
    label: "Conflict Hunter",
    icon: AlertTriangle,
    support: "mock",
    section: "conflict-hunter",
    target: { kind: "coming-soon" },
    note: "No conflict-detection service yet.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Coming soon",
  },
  {
    id: "easement",
    label: "Easement / Right of Way",
    icon: GitCompare,
    support: "mock",
    section: "easement",
    target: { kind: "coming-soon" },
    note: "No easement / ROW domain yet.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Coming soon",
  },
  {
    id: "portfolio",
    label: "Portfolio / Quarter View",
    icon: ClipboardList,
    support: "mock",
    section: "portfolio",
    target: { kind: "coming-soon" },
    note: "Hub KPIs are live project rollups; firm-wide quarterly Mission Control is not connected yet.",
    primaryNav: false,
    hubTile: true,
    hubDescription: "Coming soon",
  },
];

/** Lovable UCI children under Utility Coordination (Soon badges only). */
export const UCI_PRIMARY_NAV_SECTIONS: UciNavSection[] = UCI_NAV_SECTIONS.filter((s) => s.primaryNav);

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

/** Sidebar status chip — whole UCI WIP; never show Partial. */
export function uciSidebarBadgeLabel(_support?: UciNavSupport): "Soon" {
  return "Soon";
}

export const UCI_HUB_WRENCH_ICON = Wrench;
