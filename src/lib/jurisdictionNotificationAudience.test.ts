import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChannelPreferences } from "./jurisdictionNotificationAudience";

describe("resolveChannelPreferences defaults", () => {
  it("defaults to both channels enabled when prefs missing", () => {
    const channels = resolveChannelPreferences(null);
    assert.equal(channels.receiveEmail, true);
    assert.equal(channels.receiveInApp, true);
  });
});
