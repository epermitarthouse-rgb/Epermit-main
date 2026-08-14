import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UCI Action Tracker route wiring", () => {
  it("mounts under AdminLayout at /admin/uci-action-tracker", () => {
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).toContain('path="uci-action-tracker"');
    expect(app).toContain("UciActionTracker");
    expect(app).toContain("<Route path=\"/admin\" element={<AdminLayout />}>");
  });

  it("is listed in admin-only hybrid nav (requiresAdmin group)", () => {
    const nav = readFileSync(resolve(__dirname, "../components/layout/hybridNav.ts"), "utf8");
    expect(nav).toContain('href: "/admin/uci-action-tracker"');
    expect(nav).toContain("UCI Action Tracker");
    expect(nav).toContain("requiresAdmin: true");
    // Must not appear in client UCI nav
    const uciNav = readFileSync(resolve(__dirname, "../lib/uciNavSections.ts"), "utf8");
    expect(uciNav).not.toContain("uci-action-tracker");
  });

  it("page documents AdminLayout / useRequireAdmin gate", () => {
    const page = readFileSync(resolve(__dirname, "./UciActionTracker.tsx"), "utf8");
    expect(page).toContain("AdminLayout");
    expect(page).toContain("useRequireAdmin");
  });
});
