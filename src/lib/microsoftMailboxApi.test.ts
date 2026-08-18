import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMicrosoftMailboxSyncStorageValue } from "./microsoftMailboxApi";

describe("parseMicrosoftMailboxSyncStorageValue", () => {
  it("returns null for empty or invalid payloads", () => {
    assert.equal(parseMicrosoftMailboxSyncStorageValue(null), null);
    assert.equal(parseMicrosoftMailboxSyncStorageValue(""), null);
    assert.equal(parseMicrosoftMailboxSyncStorageValue("{"), null);
    assert.equal(parseMicrosoftMailboxSyncStorageValue(JSON.stringify({ type: "other", at: 1 })), null);
  });

  it("parses connected sync payloads", () => {
    const parsed = parseMicrosoftMailboxSyncStorageValue(
      JSON.stringify({ type: "connected", at: 123, mailbox_email: "dzahid@commun-et.com" }),
    );
    assert.deepEqual(parsed, {
      type: "connected",
      at: 123,
      mailbox_email: "dzahid@commun-et.com",
    });
  });
});
