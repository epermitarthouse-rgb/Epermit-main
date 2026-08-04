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
  /** Short copy for Partial / Mock banners */
  note?: string;
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

export const UCI_NAV_SECTIONS: UciNavSection[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Gauge,
    support: "active",
    section: "overview",
    target: { kind: "hub", anchor: "uci-hub" },
    note: "UCI hub — KPIs, stage rail, records, attention queue",
  },
  {
    id: "submissions",
    label: "Submissions",
    icon: Radio,
    support: "partial",
    section: "submissions",
    target: { kind: "drawer-tab", tab: "application-prep" },
    note: "Per-record submission & tracking in Application prep. Cross-project submissions hub is not connected yet.",
  },
  {
    id: "communications",
    label: "Communications / Inbox",
    icon: Inbox,
    support: "partial",
    section: "communications",
    target: { kind: "drawer-tab", tab: "communications" },
    note: "Per-record portal communications. Cross-project inbox is not connected yet.",
  },
  {
    id: "class-of-service",
    label: "Class of Service",
    icon: FileCheck2,
    support: "partial",
    section: "class-of-service",
    target: { kind: "drawer-tab", tab: "cos" },
    note: "Per-record COS analysis. Predictive portfolio COS table is not connected yet.",
  },
  {
    id: "ciac",
    label: "CIAC & Refunds",
    icon: DollarSign,
    support: "partial",
    section: "ciac",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "CIAC can be recorded as cost rows. Dedicated refund-window tracker is not connected yet.",
  },
  {
    id: "energization",
    label: "Energization",
    icon: Zap,
    support: "partial",
    section: "energization",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "Energization dates + meter-set/closeout. Multi-party choreography timeline is not connected yet.",
  },
  {
    id: "load-profile",
    label: "Load Profile",
    icon: FileSearch,
    support: "active",
    section: "load-profile",
    target: { kind: "drawer-tab", tab: "load-profile" },
  },
  {
    id: "provider-map",
    label: "Provider Map",
    icon: Map,
    support: "active",
    section: "provider-map",
    target: { kind: "external", href: "/jurisdictions/map" },
    note: "Opens the real Jurisdiction Map (not a mock provider map).",
  },
  {
    id: "application-builder",
    label: "Application Builder",
    icon: Cable,
    support: "partial",
    section: "application-builder",
    target: { kind: "external", href: "/uci/application-builder" },
    note: "Lovable-style UCI Builder with live package/load APIs. Owner/billing & Agent QA remain Coming Soon. Drawer Application prep is unchanged.",
  },
  {
    id: "meter-set",
    label: "Meter Set",
    icon: PlugZap,
    support: "partial",
    section: "meter-set",
    target: { kind: "drawer-tab", tab: "costs" },
    note: "Meter-set & closeout checklist generation. Richer scheduling UI is not connected yet.",
  },
  {
    id: "miss-utility",
    label: "Miss Utility",
    icon: Ticket,
    support: "mock",
    section: "miss-utility",
    target: { kind: "coming-soon" },
    note: "No PermitPilot backend for 811 / Miss Utility tickets yet.",
  },
  {
    id: "knowledge-graph",
    label: "Knowledge Graph",
    icon: Network,
    support: "mock",
    section: "knowledge-graph",
    target: { kind: "coming-soon" },
    note: "No PermitPilot graph/nodes backend yet.",
  },
  {
    id: "conflict-hunter",
    label: "Conflict Hunter",
    icon: AlertTriangle,
    support: "mock",
    section: "conflict-hunter",
    target: { kind: "coming-soon" },
    note: "No conflict-detection service yet.",
  },
  {
    id: "easement",
    label: "Easement / Right of Way",
    icon: GitCompare,
    support: "mock",
    section: "easement",
    target: { kind: "coming-soon" },
    note: "No easement / ROW domain yet.",
  },
  {
    id: "portfolio",
    label: "Portfolio / Quarter View",
    icon: ClipboardList,
    support: "mock",
    section: "portfolio",
    target: { kind: "coming-soon" },
    note: "Hub KPIs are live project rollups; firm-wide quarterly Mission Control is not connected yet.",
  },
];

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

export const UCI_HUB_WRENCH_ICON = Wrench;
