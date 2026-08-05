import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const useProjectsSource = readFileSync(
  join(__dirname, "../../hooks/useProjects.ts"),
  "utf8",
);
const controlSource = readFileSync(
  join(__dirname, "ActiveProjectControl.tsx"),
  "utf8",
);
const sidebarSource = readFileSync(join(__dirname, "AppSidebar.tsx"), "utf8");

describe("Active project create/select selection stickiness", () => {
  it("shares the projects list via React Query (not per-mount useState)", () => {
    assert.match(useProjectsSource, /export const PROJECTS_QUERY_KEY/);
    assert.match(useProjectsSource, /projectsQueryKey/);
    assert.match(useProjectsSource, /useQuery\(/);
    assert.match(useProjectsSource, /setQueryData/);
    assert.doesNotMatch(
      useProjectsSource,
      /const \[projects, setProjects\] = useState/,
    );
  });

  it("createProject patches the shared cache before returning the new row", () => {
    const createStart = useProjectsSource.indexOf("const createProject = async");
    assert.ok(createStart >= 0, "missing createProject");
    const createBlock = useProjectsSource.slice(
      createStart,
      useProjectsSource.indexOf("const updateProject = async"),
    );
    const patchIdx = createBlock.indexOf("patchProjectsCache");
    const returnIdx = createBlock.indexOf("return normalized");
    assert.ok(patchIdx >= 0, "createProject must patch shared cache");
    assert.ok(
      patchIdx < returnIdx,
      "cache patch must run before createProject returns",
    );
  });

  it("ActiveProjectControl auto-selects the created project id", () => {
    assert.match(
      controlSource,
      /selectedProject\.setSelectedProjectId\(newProject\.id\)/,
    );
  });

  it("AppSidebar refetches once before clearing a missing selected project id", () => {
    assert.match(sidebarSource, /missingSelectionRefetchRef/);
    assert.match(sidebarSource, /void fetchProjects\(\)/);
    const clearIdx = sidebarSource.indexOf("setSelectedProjectId(null)");
    const refetchGuardIdx = sidebarSource.indexOf(
      "missingSelectionRefetchRef.current !== selectedId",
    );
    assert.ok(clearIdx >= 0 && refetchGuardIdx >= 0);
    assert.ok(
      refetchGuardIdx < clearIdx,
      "refetch-before-clear guard must precede clearing selection",
    );
  });
});
