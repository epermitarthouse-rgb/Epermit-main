import { describe, expect, it } from "vitest";
import {
  platformRoleFromUser,
  platformRoleLabel,
  resolvePrimaryPlatformRole,
  visibleRoleActions,
} from "@/lib/adminRoleHelpers";

describe("adminRoleHelpers", () => {
  it("labels roles for directory display", () => {
    expect(platformRoleLabel("super_admin")).toBe("Super Admin");
    expect(platformRoleLabel("admin")).toBe("Platform Admin");
    expect(platformRoleLabel("user")).toBe("User");
  });

  it("resolves primary role from role arrays", () => {
    expect(resolvePrimaryPlatformRole(["admin", "super_admin"])).toBe("super_admin");
    expect(platformRoleFromUser({ platform_roles: ["admin"] })).toBe("admin");
    expect(
      platformRoleFromUser({
        platform_role: "admin",
        platform_roles: ["admin", "super_admin"],
      }),
    ).toBe("super_admin");
    expect(
      platformRoleFromUser({
        platform_role: "super_admin",
        super_admin: true,
        platform_roles: ["admin", "super_admin"],
      }),
    ).toBe("super_admin");
  });

  it("hides privileged controls from platform admin viewing admins", () => {
    expect(
      visibleRoleActions({
        viewerRole: "admin",
        targetRole: "super_admin",
        isSelf: false,
      }),
    ).toEqual([]);
  });

  it("shows super admin controls for normal users", () => {
    const actions = visibleRoleActions({
      viewerRole: "super_admin",
      targetRole: "user",
      isSelf: false,
    });
    expect(actions).toContain("grant-platform-admin");
    expect(actions).toContain("promote-to-super-admin");
  });

  it("blocks last super admin demotion controls in UI", () => {
    const actions = visibleRoleActions({
      viewerRole: "super_admin",
      targetRole: "super_admin",
      isSelf: false,
      isLastSuperAdmin: true,
    });
    expect(actions).not.toContain("demote-super-admin");
    expect(actions).not.toContain("deactivate");
  });
});
