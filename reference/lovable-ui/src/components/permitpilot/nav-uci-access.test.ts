import { describe, it, expect } from "vitest";
import { navGroups } from "./data";
import type { AppRole } from "@/hooks/useUserRole";
import { canViewUciPath, isUciPath } from "@/config/uciAccess";

/**
 * Mirrors the filter in PermitPilotShell.tsx: a UCI nav item is only rendered
 * when the current user has a role permitted to view it. Non-UCI items always
 * render for signed-in users.
 */
const visibleNavPaths = (roles: AppRole[]): string[] =>
  navGroups.flatMap((g) =>
    g.items
      .filter((item) => !isUciPath(item.path) || canViewUciPath(item.path, roles))
      .map((item) => item.path),
  );

const uciNavPaths = navGroups
  .flatMap((g) => g.items.map((i) => i.path))
  .filter(isUciPath);

const EXPECTED_UCI_VISIBILITY: Record<AppRole, string[]> = {
  admin: [
    "/uci",
    "/uci/submissions",
    "/uci/communications",
    "/uci/class-of-service",
    "/uci/ciac",
    "/uci/energization",
    "/uci/miss-utility",
    "/uci/knowledge-graph",
    "/uci/application-builder",
  ],
  staff: [
    "/uci",
    "/uci/submissions",
    "/uci/communications",
    "/uci/class-of-service",
    "/uci/ciac",
    "/uci/energization",
    "/uci/miss-utility",
    "/uci/knowledge-graph",
    "/uci/application-builder",
  ],
  client: [
    "/uci",
    "/uci/submissions",
    "/uci/communications",
    "/uci/class-of-service",
    "/uci/ciac",
    "/uci/energization",
  ],
};

describe("UCI nav visibility per role", () => {
  it("nav contains every UCI route from the access config", () => {
    // Sanity: every UCI path shown in nav is expected in at least one role.
    for (const p of uciNavPaths) {
      const shownForSomeone = (Object.values(EXPECTED_UCI_VISIBILITY) as string[][]).some((paths) =>
        paths.includes(p),
      );
      expect(shownForSomeone, `nav path ${p} is not visible to any role`).toBe(true);
    }
  });

  it.each(Object.entries(EXPECTED_UCI_VISIBILITY))(
    "role %s sees exactly the expected UCI nav items",
    (role, expected) => {
      const visibleUci = visibleNavPaths([role as AppRole]).filter(isUciPath);
      expect(new Set(visibleUci)).toEqual(new Set(expected));

      // And every hidden UCI item is indeed forbidden by the access matrix.
      const hidden = uciNavPaths.filter((p) => !expected.includes(p));
      for (const p of hidden) {
        expect(canViewUciPath(p, [role as AppRole])).toBe(false);
      }
    },
  );

  it("signed-out users (no roles) see no UCI nav items", () => {
    const visibleUci = visibleNavPaths([]).filter(isUciPath);
    expect(visibleUci).toEqual([]);
  });

  it("non-UCI nav items are never filtered by role", () => {
    const nonUci = navGroups.flatMap((g) => g.items).filter((i) => !isUciPath(i.path));
    for (const role of ["admin", "staff", "client"] as AppRole[]) {
      const visible = visibleNavPaths([role]);
      for (const item of nonUci) {
        expect(visible, `role ${role} should see ${item.path}`).toContain(item.path);
      }
    }
  });
});