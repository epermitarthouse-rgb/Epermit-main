import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");
const navSource = readFileSync(
  join(__dirname, "../lib/uciNavSections.ts"),
  "utf8",
);

function extractBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

describe("UciDashboard coordination drawer open/close behavior", () => {
  it("closes by clearing detail selection and coordination/tab query params", () => {
    const block = extractBlock(
      dashboardSource,
      "const handleDetailOpenChange = useCallback",
      "const updateDrawerTab = useCallback",
    );
    assert.match(block, /setDetailId\(null\)/);
    assert.match(block, /setDetail\(null\)/);
    assert.match(block, /next\.delete\("coordination"\)/);
    assert.match(block, /next\.delete\("tab"\)/);
    assert.match(block, /suppressCoordinationHydrationRef\.current = true/);
    assert.doesNotMatch(
      block,
      /setProjectId|selectProject|setSelectedProject/,
      "closing the drawer must not clear the globally selected project",
    );
  });

  it("does not auto-open the drawer from drawer-tab section navigation", () => {
    const block = extractBlock(
      dashboardSource,
      'if (section.target.kind === "drawer-tab")',
      "return (",
    );
    assert.doesNotMatch(block, /openDetail\(/);
    assert.doesNotMatch(block, /setDetailOpen\(true\)/);
    assert.doesNotMatch(block, /records\[0\]/);
    assert.doesNotMatch(block, /uciAttentionRecords\[0\]/);
    assert.match(block, /uci-records-table/);
  });

  it("does not re-force preferred drawer tab when searchParams identity changes", () => {
    // Regression: Submissions (?section=submissions → application-prep) left the
    // section effect depending on setSearchParams. RR recreates that callback on
    // every query change, so clicking Overview/Portal sync/etc. immediately
    // snapped the drawer back to Application prep.
    const block = extractBlock(
      dashboardSource,
      'if (section.target.kind === "drawer-tab")',
      "return (",
    );
    assert.match(
      block,
      /\}, \[sectionParam, navigate\]\);/,
      "section effect deps must be [sectionParam, navigate] only",
    );
    assert.doesNotMatch(
      block,
      /setSearchParams\s*,/,
      "section effect must not depend on setSearchParams (unstable across tab clicks)",
    );
    assert.doesNotMatch(
      block,
      /detailOpen\s*,/,
      "section effect must not depend on detailOpen (prefer openDetail tab mirror)",
    );
  });

  it("hydrates the drawer only from an explicit ?coordination= param", () => {
    const block = extractBlock(
      dashboardSource,
      "useEffect(() => {\n    if (!coordinationParam)",
      "useEffect(() => {\n    if (isUciDrawerTab(tabParam))",
    );
    assert.match(block, /suppressCoordinationHydrationRef/);
    assert.match(block, /openDetail\(coordinationParam\)/);
  });

  it("maps Submissions to application-prep without implying auto-open", () => {
    assert.match(
      navSource,
      /id:\s*"submissions"[\s\S]*?target:\s*\{\s*kind:\s*"drawer-tab",\s*tab:\s*"application-prep"\s*\}/,
    );
    assert.match(
      navSource,
      /section navigation alone must not open the drawer/,
    );
  });
});
