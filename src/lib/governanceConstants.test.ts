import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_KEYS,
  FEATURE_KEY_LABELS,
  featureKeyLabel,
  ACCESS_LEVEL_LABELS,
  CREDENTIAL_GRANT_LABELS,
  resolveActiveUserDefaultFeatureAccess,
} from "./governanceConstants.ts";

describe("governanceConstants", () => {
  it("FEATURE_KEYS includes expected governance features", () => {
    assert.ok(FEATURE_KEYS.includes("scraper.run"));
    assert.ok(FEATURE_KEYS.includes("credentials.self"));
    assert.ok(FEATURE_KEYS.includes("uci.workspace"));
    assert.equal(FEATURE_KEYS.length, 10);
  });

  it("FEATURE_KEY_LABELS covers every feature key", () => {
    for (const key of FEATURE_KEYS) {
      assert.ok(FEATURE_KEY_LABELS[key], `missing label for ${key}`);
    }
  });

  it("featureKeyLabel falls back to raw key for unknown values", () => {
    assert.equal(featureKeyLabel("scraper.run"), FEATURE_KEY_LABELS["scraper.run"]);
    assert.equal(featureKeyLabel("custom.feature"), "custom.feature");
  });

  it("active user defaults grant write on all standard product features", () => {
    for (const key of FEATURE_KEYS) {
      assert.equal(resolveActiveUserDefaultFeatureAccess(key), "write", key);
    }
  });

  it("access and credential level labels are defined", () => {
    assert.equal(ACCESS_LEVEL_LABELS.none, "None");
    assert.equal(ACCESS_LEVEL_LABELS.write, "Write");
    assert.equal(CREDENTIAL_GRANT_LABELS.manage, "Manage");
  });
});
