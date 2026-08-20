import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(__dirname, "ProjectFormDialog.tsx"), "utf8");
const projectsHookSource = readFileSync(
  join(__dirname, "..", "..", "hooks", "useProjects.ts"),
  "utf8",
);

describe("ProjectFormDialog client fields for Stage 7 QuickBooks", () => {
  it("renders a dedicated Client details section on create and edit forms", () => {
    assert.match(formSource, /Client details/);
    assert.match(formSource, /id="client_name"/);
    assert.match(formSource, /id="client_email"/);
    assert.match(formSource, /type="email"/);
    assert.match(formSource, /data-testid="input-client-name"/);
    assert.match(formSource, /data-testid="input-client-email"/);
  });

  it("prefills edit values and persists client_name/client_email on save", () => {
    assert.match(formSource, /client_name: project\.client_name \?\? ''/);
    assert.match(formSource, /client_email: project\.client_email \?\? ''/);
    assert.match(formSource, /data\.client_name = clientName \|\| null/);
    assert.match(formSource, /data\.client_email = clientEmail \|\| null/);
    assert.match(formSource, /if \(clientName\) data\.client_name = clientName/);
    assert.match(formSource, /if \(clientEmail\) data\.client_email = clientEmail/);
  });

  it("validates client_email with basic email rules", () => {
    assert.match(formSource, /client_email: z/);
    assert.match(formSource, /z\.string\(\)\.email\(\)/);
    assert.match(formSource, /Must be a valid email/);
  });

  it("loads client fields through the shared projects hook/API", () => {
    assert.match(projectsHookSource, /'client_name'/);
    assert.match(projectsHookSource, /'client_email'/);
    assert.match(projectsHookSource, /client_name\?: string \| null/);
    assert.match(projectsHookSource, /client_email\?: string \| null/);
  });
});
