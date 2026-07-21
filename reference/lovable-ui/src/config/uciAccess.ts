import type { AppRole } from "@/hooks/useUserRole";

/**
 * Role-based access matrix for UCI (Utility Coordination Intelligence) surfaces.
 *
 * - `view`  → roles that can see the page in nav and open it
 * - `manage` → roles that can perform write actions inside the page
 *
 * Update this file to change UCI access. Nav filtering and route guards both
 * read from here so there is one source of truth.
 */
export type UciAccessRule = {
  path: string;
  label: string;
  view: AppRole[];
  manage: AppRole[];
};

export const uciAccess: UciAccessRule[] = [
  { path: "/uci",                        label: "UCI Dashboard",       view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  { path: "/uci/submissions",            label: "Submissions",         view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  { path: "/uci/communications",         label: "Utility Inbox",       view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  { path: "/uci/class-of-service",       label: "Class of Service",    view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  { path: "/uci/energization",           label: "Energization",        view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  { path: "/uci/ciac",                   label: "CIAC & Refunds",      view: ["admin", "staff", "client"], manage: ["admin"] },
  { path: "/uci/miss-utility",           label: "Miss Utility 811",    view: ["admin", "staff"],           manage: ["admin", "staff"] },
  { path: "/uci/application-builder",    label: "UCI Builder",         view: ["admin", "staff"],           manage: ["admin", "staff"] },
  { path: "/uci/knowledge-graph",        label: "Knowledge Graph",     view: ["admin", "staff"],           manage: ["admin"] },
];

const byPath = new Map(uciAccess.map((r) => [r.path, r] as const));

export const getUciRule = (path: string): UciAccessRule | undefined => byPath.get(path);

export const isUciPath = (path: string): boolean => path === "/uci" || path.startsWith("/uci/");

export const canViewUciPath = (path: string, roles: AppRole[]): boolean => {
  const rule = byPath.get(path);
  if (!rule) return true; // unknown UCI subpath — do not block
  return roles.some((r) => rule.view.includes(r));
};

export const canManageUciPath = (path: string, roles: AppRole[]): boolean => {
  const rule = byPath.get(path);
  if (!rule) return false;
  return roles.some((r) => rule.manage.includes(r));
};