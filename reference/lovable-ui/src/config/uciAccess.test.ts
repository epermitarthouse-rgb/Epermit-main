import { describe, it, expect } from "vitest";
import type { AppRole } from "@/hooks/useUserRole";
import {
  uciAccess,
  canViewUciPath,
  canManageUciPath,
  isUciPath,
  getUciRule,
} from "./uciAccess";

const ROLES: AppRole[] = ["admin", "staff", "client"];

// Expected access matrix — kept independent of the source config so a
// regression in uciAccess.ts fails these tests loudly rather than silently
// mirroring the change.
type Expected = { view: AppRole[]; manage: AppRole[] };
const EXPECTED: Record<string, Expected> = {
  "/uci":                     { view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  "/uci/submissions":         { view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  "/uci/communications":      { view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  "/uci/class-of-service":    { view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  "/uci/energization":        { view: ["admin", "staff", "client"], manage: ["admin", "staff"] },
  "/uci/ciac":                { view: ["admin", "staff", "client"], manage: ["admin"] },
  "/uci/miss-utility":        { view: ["admin", "staff"],           manage: ["admin", "staff"] },
  "/uci/application-builder": { view: ["admin", "staff"],           manage: ["admin", "staff"] },
  "/uci/knowledge-graph":     { view: ["admin", "staff"],           manage: ["admin"] },
};

describe("uciAccess matrix", () => {
  it("covers every configured route with an expected rule", () => {
    const configured = uciAccess.map((r) => r.path).sort();
    const expected = Object.keys(EXPECTED).sort();
    expect(configured).toEqual(expected);
  });

  it("isUciPath recognizes UCI routes and rejects others", () => {
    for (const p of Object.keys(EXPECTED)) expect(isUciPath(p)).toBe(true);
    for (const p of ["/dashboard", "/admin", "/uc", "/", "/utility-map"]) {
      expect(isUciPath(p)).toBe(false);
    }
  });

  describe.each(Object.entries(EXPECTED))("route %s", (path, exp) => {
    it.each(ROLES)("role %s view/manage matches expectation", (role) => {
      const allowedView = exp.view.includes(role);
      const allowedManage = exp.manage.includes(role);
      expect(canViewUciPath(path, [role])).toBe(allowedView);
      expect(canManageUciPath(path, [role])).toBe(allowedManage);
    });

    it("returns the rule via getUciRule", () => {
      expect(getUciRule(path)?.path).toBe(path);
    });
  });

  it("denies unauthenticated (no roles) view + manage on every UCI route", () => {
    for (const p of Object.keys(EXPECTED)) {
      expect(canViewUciPath(p, [])).toBe(false);
      expect(canManageUciPath(p, [])).toBe(false);
    }
  });

  it("multi-role users get the union of privileges", () => {
    // staff + client should behave like staff for miss-utility (staff-only view)
    expect(canViewUciPath("/uci/miss-utility", ["staff", "client"])).toBe(true);
    // client alone cannot
    expect(canViewUciPath("/uci/miss-utility", ["client"])).toBe(false);
    // client cannot manage CIAC but admin+client can
    expect(canManageUciPath("/uci/ciac", ["client"])).toBe(false);
    expect(canManageUciPath("/uci/ciac", ["admin", "client"])).toBe(true);
  });

  it("unknown UCI subpaths are not blocked by canViewUciPath", () => {
    // The guard treats unknown subpaths as allow-by-default (rule missing).
    expect(canViewUciPath("/uci/unknown-future", ["client"])).toBe(true);
    // But manage defaults to false without a rule.
    expect(canManageUciPath("/uci/unknown-future", ["admin"])).toBe(false);
  });
});