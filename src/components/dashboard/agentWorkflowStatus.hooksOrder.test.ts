import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "AgentWorkflowStatus.tsx"), "utf8");

describe("AgentWorkflowStatus hooks order", () => {
  it("declares projectBySelectedId before dependency arrays that read it", () => {
    const decl = source.indexOf(
      "const { data: projectBySelectedId = null } = useQuery(",
    );
    assert.ok(decl >= 0, "missing projectBySelectedId useQuery");

    // First dependency-array evaluation that would TDZ-crash if above the decl.
    const firstDep = source.indexOf("[projectBySelectedId?.id, latestProjectId, queryClient]");
    assert.ok(firstDep >= 0, "missing realtime effect deps");
    assert.ok(
      decl < firstDep,
      "projectBySelectedId must be declared before hook deps that read it (TDZ white-screen)",
    );

    const runEnrichmentDeps = source.indexOf(
      "projectBySelectedId?.id,\n    latestProjectId,\n    session?.access_token",
    );
    assert.ok(runEnrichmentDeps >= 0, "missing runEnrichment deps");
    assert.ok(decl < runEnrichmentDeps);
  });
});
