"use strict";

/**
 * Replica pool: each Railway process must heartbeat, lease and shut down under its own id.
 * RAILWAY_REPLICA_ID distinguishes replicas that would otherwise share a hostname.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { workerIdentity } = require("../permit-sync/worker-entry");

test("local workers stay hostname:pid when Railway sets no replica id", () => {
  assert.equal(workerIdentity({}, { hostname: "dev-host", pid: 42 }), "dev-host:42");
  assert.equal(workerIdentity({ RAILWAY_REPLICA_ID: "  " }, { hostname: "dev-host", pid: 42 }), "dev-host:42");
  assert.equal(workerIdentity({}, { hostname: "", pid: 7 }), "local:7");
});

test("Railway replicas with the same hostname get distinct worker ids", () => {
  const a = workerIdentity({ RAILWAY_REPLICA_ID: "replica-a" }, { hostname: "shared-host", pid: 10 });
  const b = workerIdentity({ RAILWAY_REPLICA_ID: "replica-b" }, { hostname: "shared-host", pid: 10 });
  assert.equal(a, "railway:replica-a:10");
  assert.equal(b, "railway:replica-b:10");
  assert.notEqual(a, b);
  assert.notEqual(a, "shared-host:10");
});

test("worker ids stay a single token within the heartbeat column limit", () => {
  const messy = workerIdentity(
    { RAILWAY_REPLICA_ID: "rep lica\nid/with spaces" },
    { hostname: "host name", pid: 9 },
  );
  assert.equal(messy.includes(" "), false);
  assert.equal(messy.includes("\n"), false);
  assert.equal(messy, "railway:replicaidwithspaces:9");
  const longId = workerIdentity({ RAILWAY_REPLICA_ID: "r".repeat(500) }, { hostname: "h", pid: 3 });
  assert.ok(longId.length <= 200);
  assert.ok(longId.startsWith("railway:"));
  assert.ok(longId.endsWith(":3"));
});
