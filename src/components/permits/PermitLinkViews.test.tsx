import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  LinkedProjectsList,
  NoPermitLinkNotice,
  PermitPickerResults,
  ProjectPermitBanner,
} from "./PermitLinkViews";
import type { PermitListRow, PermitProjectLink, ProjectPermitLink } from "@/lib/centralPermits";

// Shared design primitives rely on the app's automatic JSX runtime; tsx compiles tests with the classic one.
(globalThis as { React?: typeof React }).React = React;

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

const link: ProjectPermitLink = {
  permit_id: "22222222-2222-4222-8222-222222222222",
  permit_number: "D2500488",
  jurisdiction: "Washington DC",
  status_raw: "Resubmit",
  last_synced_at: null,
};

describe("ProjectPermitBanner", () => {
  it("shows the permit number, a record link and the status, and hides Unlink from non-admins", () => {
    const html = render(createElement(ProjectPermitBanner, { link, isAdmin: false, onUnlink: () => {} }));
    assert.match(html, /D2500488/);
    assert.match(html, /href="\/permit-queue\/22222222-2222-4222-8222-222222222222"/);
    assert.match(html, /Open in Permit Queue →/);
    assert.match(html, /Resubmit/);
    assert.doesNotMatch(html, /Unlink/);
  });

  it("shows Unlink for admins when a handler is supplied", () => {
    const html = render(createElement(ProjectPermitBanner, { link, isAdmin: true, onUnlink: () => {} }));
    assert.match(html, />Unlink</);
  });

  it("falls back to explicit labels when jurisdiction or status are unknown", () => {
    const html = render(createElement(ProjectPermitBanner, { link: { ...link, jurisdiction: null, status_raw: null }, isAdmin: false }));
    assert.match(html, /Jurisdiction unknown/);
    assert.match(html, /Status unknown/);
  });
});

describe("NoPermitLinkNotice", () => {
  it("only mentions searching for a permit to admins", () => {
    assert.match(render(createElement(NoPermitLinkNotice, { isAdmin: true })), /Search for the permit/);
    assert.doesNotMatch(render(createElement(NoPermitLinkNotice, { isAdmin: false })), /Search for the permit/);
  });
});

describe("LinkedProjectsList", () => {
  const links: PermitProjectLink[] = [
    { project_id: "p-1", created_at: null, project_name: "Hilltop Annex" },
    { project_id: "p-2", created_at: null, project_name: null },
  ];

  it("names visible projects and marks hidden ones without leaking a name", () => {
    const html = render(createElement(LinkedProjectsList, { links, isAdmin: false, onOpenProject: () => {} }));
    assert.match(html, /Hilltop Annex/);
    assert.match(html, /Project not visible to your account/);
    // Only the visible project gets an open action; hidden projects cannot be selected.
    assert.equal((html.match(/Open in Portal Harvest/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Unlink/);
  });

  it("shows unlink per project for admins", () => {
    const html = render(createElement(LinkedProjectsList, { links, isAdmin: true, onUnlink: () => {} }));
    assert.equal((html.match(/>Unlink</g) ?? []).length, 2);
  });

  it("explains when nothing is linked", () => {
    const html = render(createElement(LinkedProjectsList, { links: [], isAdmin: true, onUnlink: () => {} }));
    assert.match(html, /No projects are linked to this permit/);
    assert.doesNotMatch(html, /Unlink/);
  });
});

describe("PermitPickerResults", () => {
  const rows = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      permit_number: "D2500488",
      jurisdiction: "Washington DC",
      status_raw: "Resubmit",
      status: "resubmit",
    },
  ] as unknown as PermitListRow[];

  it("lists matches with a link action and reports an empty search", () => {
    const html = render(createElement(PermitPickerResults, { rows, onPick: () => {} }));
    assert.match(html, /D2500488/);
    assert.match(html, /Link to project/);
    assert.match(render(createElement(PermitPickerResults, { rows: [], onPick: () => {} })), /No matching permits/);
  });
});
