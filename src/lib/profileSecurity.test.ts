import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDeactivatedProfile,
  shouldForcePasswordChange,
} from "./profileSecurity.ts";

describe("profileSecurity", () => {
  it("forces password change only when flag is set and user is active", () => {
    assert.equal(
      shouldForcePasswordChange({
        mustChangePassword: true,
        accessStatus: "active",
        loading: false,
      }),
      true,
    );
    assert.equal(
      shouldForcePasswordChange({
        mustChangePassword: true,
        accessStatus: "deactivated",
        loading: false,
      }),
      false,
    );
    assert.equal(
      shouldForcePasswordChange({
        mustChangePassword: false,
        accessStatus: "active",
        loading: false,
      }),
      false,
    );
  });

  it("detects deactivated profiles", () => {
    assert.equal(
      isDeactivatedProfile({ accessStatus: "deactivated", loading: false }),
      true,
    );
    assert.equal(
      isDeactivatedProfile({ accessStatus: "active", loading: false }),
      false,
    );
  });
});
