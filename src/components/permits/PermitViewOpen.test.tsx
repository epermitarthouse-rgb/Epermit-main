import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React, { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { FileViewAction, FilesSectionView, ReportRowActions, ReportsSectionView, type ReportsActions } from "./PermitSectionViews";
import {
  NO_STORED_FILE_MESSAGE,
  OPEN_BLOCKED_MESSAGE,
  OPEN_FAILED_MESSAGE,
  openStoredObject,
  reportExportTarget,
  type OpenedTab,
} from "@/lib/permitObjectOpen";

(globalThis as { React?: typeof React }).React = React;

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));

type Row = Record<string, unknown>;
const ok = (section: string): Row => ({ section, status: "ok", source_kind: "json", item_count: 1, last_ok_at: "2026-11-11T03:40:00Z" });

/** Finds elements in an element tree (function components that use no hooks are expanded in place). */
function findAll(node: ReactNode, pred: (props: Record<string, unknown>) => boolean, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, pred, out));
  } else if (node && typeof node === "object" && "props" in node) {
    const el = node as ReactElement<Record<string, unknown>>;
    if (pred(el.props)) out.push(el);
    findAll(el.props.children as ReactNode, pred, out);
  }
  return out;
}

const SENTINEL = "STRUCTURED-ROWS-PANEL";

function actions(over: Partial<ReportsActions> = {}): ReportsActions & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    exports: {},
    onOpenFile: (path) => { opened.push(path); },
    renderDetails: (r) => createElement("div", { "data-panel": true }, `${SENTINEL} ${String(r.report_key)}`),
    ...over,
  };
}

const report = (n: number, over: Row = {}): Row => ({
  id: `r${n}`, report_key: String(n), name: `Report ${n}`, category: "ProjectFlow", content_status: "captured", latest_content_id: `c${n}`, ...over,
});

const clickView = (r: Row, a: ReportsActions) => {
  const tree = ReportRowActions({ report: r, actions: a, expanded: false, onToggleDetails: () => undefined });
  const [btn] = findAll(tree, (p) => "data-report-view" in p);
  assert.ok(btn, "View button is offered");
  (btn.props.onClick as () => void)();
};

describe("reports: View opens the stored export", () => {
  it("prefers the PDF, falls back to Excel, and offers nothing when nothing is stored", () => {
    assert.deepEqual(reportExportTarget({ pdf: "p/a.pdf", excel: "p/a.xlsx" }), { kind: "pdf", path: "p/a.pdf" });
    assert.deepEqual(reportExportTarget({ pdf: "", excel: "p/a.xlsx" }), { kind: "excel", path: "p/a.xlsx" });
    assert.equal(reportExportTarget({ pdf: "", excel: "" }), null);
    assert.equal(reportExportTarget(undefined), null);
  });

  it("View on a report with a PDF calls the open helper with the PDF path and renders no panel", () => {
    const a = actions({ exports: { c1: { pdf: "p/reports/1/a.pdf", excel: "p/reports/1/a.xlsx" } } });
    clickView(report(1), a);
    assert.deepEqual(a.opened, ["p/reports/1/a.pdf"]);
    const html = render(createElement(ReportsSectionView, { reports: [report(1)], state: ok("reports"), actions: a }));
    assert.match(html, /data-report-view/);
    assert.doesNotMatch(html, new RegExp(SENTINEL));
    assert.doesNotMatch(html, /data-report-content|data-report-details-row/);
  });

  it("a report with only an Excel export opens the Excel", () => {
    const a = actions({ exports: { c2: { pdf: "", excel: "p/reports/2/a.xlsx" } } });
    clickView(report(2), a);
    assert.deepEqual(a.opened, ["p/reports/2/a.xlsx"]);
    const html = render(createElement(ReportsSectionView, { reports: [report(2)], state: ok("reports"), actions: a }));
    assert.match(html, /data-report-export="excel"/);
  });

  it("a report with nothing stored shows no View, and says so", () => {
    const a = actions({ exports: { c3: { pdf: "", excel: "" } } });
    const rows = [report(3), report(4, { latest_content_id: null, content_status: "not_captured" }), report(5, { content_status: "failed" })];
    const html = render(createElement(ReportsSectionView, { reports: rows, state: ok("reports"), actions: a }));
    assert.doesNotMatch(html, /data-report-view/);
    assert.equal((html.match(/data-report-no-file/g) ?? []).length, 3);
    assert.match(html, /No file stored/);
  });

  it("View is offered for a stored export whatever the content status, and while exports load there is no View", () => {
    const a = actions({ exports: { c6: { pdf: "p/6.pdf", excel: "" } } });
    const html = render(createElement(ReportsSectionView, { reports: [report(6, { content_status: "failed" })], state: ok("reports"), actions: a }));
    assert.match(html, /data-report-view/);
    const loading = render(createElement(ReportsSectionView, { reports: [report(6)], state: ok("reports"), actions: actions({ exports: null }) }));
    assert.doesNotMatch(loading, /data-report-view/);
    assert.match(loading, /Checking/);
    const failed = render(createElement(ReportsSectionView, { reports: [report(6)], state: ok("reports"), actions: actions({ exports: null, exportsError: "boom" }) }));
    assert.match(failed, /Could not check which report files are stored/);
    assert.doesNotMatch(failed, /data-report-view/);
  });

  it("Details expands the structured rows directly under the row, inside the table", () => {
    const rows = [report(1), report(2), report(3)];
    const a = actions({ exports: { c1: { pdf: "a", excel: "" }, c2: { pdf: "b", excel: "" }, c3: { pdf: "c", excel: "" } } });
    const closed = render(createElement(ReportsSectionView, { reports: rows, state: ok("reports"), actions: a }));
    assert.match(closed, /data-report-details-toggle/);
    assert.match(closed, /aria-expanded="false"/);
    assert.doesNotMatch(closed, new RegExp(SENTINEL));
    const open = render(createElement(ReportsSectionView, { reports: rows, state: ok("reports"), actions: a, defaultExpandedKey: "2" }));
    const at = (needle: string) => open.indexOf(needle);
    assert.ok(at('data-report-row="2"') < at(`${SENTINEL} 2`));
    assert.ok(at(`${SENTINEL} 2`) < at('data-report-row="3"'));
    assert.ok(at(`${SENTINEL} 2`) < at("</table>"));
    assert.equal((open.match(new RegExp(SENTINEL, "g")) ?? []).length, 1);
    assert.match(open, /Hide details/);
  });

  it("Details toggles the expanded row", () => {
    const a = actions({ exports: { c1: { pdf: "a", excel: "" } } });
    const calls: string[] = [];
    const tree = ReportRowActions({ report: report(1), actions: a, expanded: false, onToggleDetails: () => calls.push("toggle") });
    const [btn] = findAll(tree, (p) => "data-report-details-toggle" in p);
    (btn.props.onClick as () => void)();
    assert.deepEqual(calls, ["toggle"]);
    const noContent = ReportRowActions({ report: report(9, { latest_content_id: null }), actions: a, expanded: false, onToggleDetails: () => undefined });
    assert.equal(findAll(noContent, (p) => "data-report-details-toggle" in p).length, 0);
  });

  it("works for the 30th of many rows", () => {
    const rows = Array.from({ length: 40 }, (_, i) => report(i + 1));
    const exports = Object.fromEntries(rows.map((r) => [String(r.latest_content_id), { pdf: `p/reports/${String(r.report_key)}.pdf`, excel: "" }]));
    const a = actions({ exports });
    const html = render(createElement(ReportsSectionView, { reports: rows, state: ok("reports"), actions: a }));
    assert.equal((html.match(/data-report-view/g) ?? []).length, 40);
    clickView(rows[29], a);
    assert.deepEqual(a.opened, ["p/reports/30.pdf"]);
    const open = render(createElement(ReportsSectionView, { reports: rows, state: ok("reports"), actions: a, defaultExpandedKey: "30" }));
    assert.ok(open.indexOf('data-report-row="30"') < open.indexOf(`${SENTINEL} 30`));
    assert.ok(open.indexOf(`${SENTINEL} 30`) < open.indexOf('data-report-row="31"'));
  });

  it("behaves the same for any jurisdiction's rows (no DC- or Montgomery-only path)", () => {
    for (const adapter of ["dc-projectdox", "montgomery-county"]) {
      const row = report(1, { adapter_key: adapter });
      const a = actions({ exports: { c1: { pdf: `${adapter}/r.pdf`, excel: "" } } });
      clickView(row, a);
      assert.deepEqual(a.opened, [`${adapter}/r.pdf`]);
    }
  });
});

describe("files: View opens a stored file", () => {
  it("View on a stored file calls the open handler with that file; an unstored file has no View", () => {
    const stored = { id: "d1", file_name: "A.pdf", download_status: "stored", storage_path: "p/files/1_A.pdf" };
    const seen: Row[] = [];
    const tree = FileViewAction({ doc: stored, onView: (d) => { seen.push(d); } });
    const [btn] = findAll(tree, (p) => "data-file-view" in p);
    (btn.props.onClick as () => void)();
    assert.deepEqual(seen, [stored]);

    const html = render(createElement(FilesSectionView, {
      folders: [],
      documents: [
        stored,
        { id: "d2", file_name: "B.pdf", download_status: "not_permitted", download_permitted: false },
        { id: "d3", file_name: "C.pdf", download_status: "failed", download_permitted: true },
      ],
      state: ok("files"),
      onViewDocument: () => undefined,
    }));
    assert.equal((html.match(/data-file-view/g) ?? []).length, 1);
    assert.match(html, /Not downloadable on portal/);
  });

  it("works for the 30th of many files", () => {
    const docs = Array.from({ length: 40 }, (_, i) => ({ id: `d${i + 1}`, file_name: `F${String(i + 1).padStart(2, "0")}.pdf`, download_status: "stored", storage_path: `p/files/${i + 1}.pdf` }));
    const seen: string[] = [];
    const html = render(createElement(FilesSectionView, { folders: [], documents: docs, state: ok("files"), onViewDocument: (d) => { seen.push(String(d.storage_path)); } }));
    assert.equal((html.match(/data-file-view/g) ?? []).length, 40);
    const [btn] = findAll(FileViewAction({ doc: docs[29], onView: (d) => { seen.push(String(d.storage_path)); } }), (p) => "data-file-view" in p);
    (btn.props.onClick as () => void)();
    assert.deepEqual(seen, ["p/files/30.pdf"]);
  });
});

describe("opening a stored object", () => {
  const fakeTab = () => {
    const tab = { location: { href: "about:blank" }, opener: "x" as unknown, closed: false, close() { this.closed = true; } };
    return tab as typeof tab & OpenedTab;
  };

  it("opens the tab first (synchronously), then points it at the signed URL", async () => {
    const tab = fakeTab();
    const order: string[] = [];
    const done = openStoredObject("p/a.pdf", {
      openTab: () => { order.push("open"); return tab; },
      signUrl: async (p) => { order.push("sign"); return `https://signed/${p}`; },
      notify: () => order.push("notify"),
    });
    assert.deepEqual(order, ["open", "sign"], "tab opened before the async work");
    assert.equal(await done, true);
    assert.equal(tab.location.href, "https://signed/p/a.pdf");
    assert.equal(tab.opener, null);
    assert.equal(tab.closed, false);
  });

  it("a signed-URL failure closes the tab and shows the plain-language message", async () => {
    const tab = fakeTab();
    const messages: Array<[string, string]> = [];
    const ok = await openStoredObject("p/missing.pdf", {
      openTab: () => tab,
      signUrl: async () => { throw new Error("Object not found"); },
      notify: (m, k) => messages.push([m, k]),
    });
    assert.equal(ok, false);
    assert.equal(tab.closed, true);
    assert.equal(tab.location.href, "about:blank");
    assert.deepEqual(messages, [[OPEN_FAILED_MESSAGE, "failed"]]);
    assert.equal(OPEN_FAILED_MESSAGE, "Could not open this file; try again.");
  });

  it("a pop-up block reports it and never signs a URL", async () => {
    let signed = false;
    const messages: string[] = [];
    const ok = await openStoredObject("p/a.pdf", { openTab: () => null, signUrl: async () => { signed = true; return "x"; }, notify: (m) => messages.push(m) });
    assert.equal(ok, false);
    assert.equal(signed, false);
    assert.deepEqual(messages, [OPEN_BLOCKED_MESSAGE]);
  });

  it("an empty path opens no tab and says there is no stored copy", async () => {
    let opened = false;
    const messages: string[] = [];
    const ok = await openStoredObject("", { openTab: () => { opened = true; return fakeTab(); }, signUrl: async () => "x", notify: (m) => messages.push(m) });
    assert.equal(ok, false);
    assert.equal(opened, false);
    assert.deepEqual(messages, [NO_STORED_FILE_MESSAGE]);
  });
});
