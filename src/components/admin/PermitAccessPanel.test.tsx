import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ACCESS_STATE, PermitAccessPanel, PermitAccessTable, SourceVisibilitySwitch } from "./PermitAccessPanel";
import type { PermitAccessUser } from "@/lib/centralPermits";

(globalThis as { React?: typeof React }).React = React;

const render = (el: ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

const user = (over: Partial<PermitAccessUser> = {}): PermitAccessUser => ({
  user_id: "11111111-aaaa-4000-8000-000000000001", full_name: "Ada Planner", company_name: "Plan Co", access_status: "active",
  hidden: false, hidden_at: null, can_read: true, state: "default", ...over,
});

describe("Permit Sync access list", () => {
  it("shows each user's state with Hide for readers and Unhide for hidden users", () => {
    const html = render(createElement(PermitAccessTable, {
      busy: false,
      onToggle: () => undefined,
      rows: [
        user(),
        user({ user_id: "2", full_name: "Bo Hidden", hidden: true, hidden_at: "2026-11-17T10:00:00Z", can_read: false, state: "hidden" }),
        user({ user_id: "3", full_name: "Cy Suspended", access_status: "deactivated", can_read: false, state: "inactive" }),
        user({ user_id: "4", full_name: "Di Admin", state: "admin" }),
      ],
    }));
    assert.match(html, /Ada Planner/);
    assert.match(html, /Visible \(default\)/);
    assert.match(html, /Hidden/);
    assert.match(html, /Inactive account/);
    assert.match(html, /Platform admin/);
    assert.equal((html.match(/>Hide</g) ?? []).length, 2, "default and inactive users can be hidden");
    assert.equal((html.match(/>Unhide</g) ?? []).length, 1);
    assert.match(html, /Always sees permits/, "platform admins cannot be hidden");
    assert.match(html, /Nov 17|2026/, "hidden date is shown");
  });

  it("falls back to a short id when a profile has no name, and shows an empty state", () => {
    const html = render(createElement(PermitAccessTable, { busy: false, onToggle: () => undefined, rows: [user({ full_name: null, company_name: null })] }));
    assert.match(html, /11111111…/);
    assert.match(render(createElement(PermitAccessTable, { busy: false, onToggle: () => undefined, rows: [] })), /No users/);
  });

  it("disables the buttons while an action is running", () => {
    const html = render(createElement(PermitAccessTable, { busy: true, onToggle: () => undefined, rows: [user()] }));
    assert.match(html, /<button[^>]*disabled[^>]*>Hide</);
  });

  it("labels every access state", () => {
    for (const s of ["admin", "default", "grant", "hidden", "inactive", "none"] as const) assert.ok(ACCESS_STATE[s].label);
  });

  it("the default switch reflects the source setting and is named for screen readers", () => {
    const on = render(createElement(SourceVisibilitySwitch, { credentialId: "c1", checked: true, onChange: () => undefined }));
    assert.match(on, /aria-checked="true"/);
    assert.match(on, /aria-label="Visible to all users by default"/);
    assert.match(render(createElement(SourceVisibilitySwitch, { credentialId: "c1", checked: false, onChange: () => undefined })), /aria-checked="false"/);
  });

  it("the panel renders the default switch state for the selected source, and an empty message without sources", () => {
    const sources = [{ credential_id: "c1aaaaaa-0000-4000-8000-000000000000", adapter_key: "dc-projectdox", visible_to_all: true }];
    const on = render(createElement(PermitAccessPanel, { sources }));
    assert.match(on, /Visible to all users by default/);
    assert.match(on, /aria-checked="true"/);
    assert.match(on, /Every active user, now and in the future/);
    const off = render(createElement(PermitAccessPanel, { sources: [{ ...sources[0], visible_to_all: false }] }));
    assert.match(off, /aria-checked="false"/);
    assert.match(off, /Only platform admins and users with a grant/);
    assert.match(render(createElement(PermitAccessPanel, { sources: [] })), /No sources configured/);
  });
});
