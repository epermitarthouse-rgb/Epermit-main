import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminCreateUserSchema } from "./adminCreateUserValidation.ts";

describe("adminCreateUserValidation", () => {
  it("requires core fields and minimum password length", () => {
    const invalid = adminCreateUserSchema.safeParse({
      fullName: "A",
      email: "bad",
      temporaryPassword: "short",
    });
    assert.equal(invalid.success, false);

    const valid = adminCreateUserSchema.safeParse({
      fullName: "Jane Doe",
      email: "jane@example.com",
      temporaryPassword: "TempPass123",
    });
    assert.equal(valid.success, true);
  });

  it("requires project and role together", () => {
    const missingRole = adminCreateUserSchema.safeParse({
      fullName: "Jane Doe",
      email: "jane@example.com",
      temporaryPassword: "TempPass123",
      projectId: "project-1",
    });
    assert.equal(missingRole.success, false);

    const complete = adminCreateUserSchema.safeParse({
      fullName: "Jane Doe",
      email: "jane@example.com",
      temporaryPassword: "TempPass123",
      projectId: "project-1",
      projectRole: "viewer",
    });
    assert.equal(complete.success, true);
  });
});
