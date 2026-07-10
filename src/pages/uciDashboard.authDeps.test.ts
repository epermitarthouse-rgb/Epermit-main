import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(__dirname, "UciDashboard.tsx"), "utf8");

function extractBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return source.slice(start, end);
}

describe("UciDashboard auth dependency regression", () => {
  it("does not depend on the full session object for provider loading", () => {
    const block = extractBlock(dashboardSource, "const loadProviders = useCallback", "const refreshCoordination");
    assert.doesNotMatch(block, /\[authLoading, user, session\]/);
    assert.doesNotMatch(block, /\[authLoading, user\?\.id, session\]/);
    assert.doesNotMatch(block, /!session/);
    assert.match(block, /user\?\.id/);
  });

  it("does not depend on session for coordination loading effects", () => {
    const block = extractBlock(
      dashboardSource,
      "const refreshCoordination = useCallback",
      "Project/tenant safety",
    );
    assert.doesNotMatch(block, /\[authLoading, user, session/);
    assert.doesNotMatch(block, /session\?\.access_token/);
    assert.match(block, /user\?\.id/);
    assert.match(block, /projectId/);
  });

  it("still gates initial UCI loading on auth readiness and authenticated user", () => {
    const providersBlock = extractBlock(dashboardSource, "const loadProviders = useCallback", "const refreshCoordination");
    assert.match(providersBlock, /authLoading/);
    assert.match(providersBlock, /!user\?\.id/);

    const coordinationBlock = extractBlock(
      dashboardSource,
      "const refreshCoordination = useCallback",
      "Project/tenant safety",
    );
    assert.match(coordinationBlock, /authLoading/);
    assert.match(coordinationBlock, /!user\?\.id/);
    assert.match(coordinationBlock, /!projectId/);
  });
});
