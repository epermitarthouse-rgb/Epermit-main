"use strict";

/**
 * Worker process backstop (worker-entry.js installProcessGuard): an unhandled rejection or uncaught exception is
 * logged as one redacted JSON line with the claimed job id and the process stays alive; awaited errors are not
 * touched. The real-process cases run in a child process, because node:test fails a test that sees an
 * unhandledRejection in its own process.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const { installProcessGuard, describeFatal } = require("../permit-sync/worker-entry");

const ENTRY = path.resolve(__dirname, "..", "permit-sync", "worker-entry.js");
const SECRETS = ["https://montgomeryco-md-us.avolvecloud.com/Home/Index?sid=abc123", "SessionIDPortal=s3cr3tcookie", "someone@example.com", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"];

function leakFree(text) {
  for (const s of SECRETS) assert.equal(text.includes(s), false, `leaked ${s.slice(0, 20)}`);
  assert.equal(/avolvecloud|s3cr3t|someone@|eyJhbG/.test(text), false);
}

function noisyError() {
  const e = new Error(`page.waitForEvent: Target closed at ${SECRETS[0]} Cookie: ${SECRETS[1]} user ${SECRETS[2]} token ${SECRETS[3]}\nsecond line of page text`);
  e.name = "TimeoutError";
  return e;
}

test("guard: logs one redacted line per event with the claimed job id, and does not exit", () => {
  const proc = new EventEmitter();
  const lines = [];
  const exits = [];
  let job = null;
  const guard = installProcessGuard({ log: (level, event, fields) => lines.push(JSON.stringify({ level, event, ...fields })), getJobId: () => job, env: {}, proc, exit: (c) => exits.push(c) });

  proc.emit("unhandledRejection", noisyError());
  job = "job-123";
  proc.emit("uncaughtException", noisyError());

  assert.equal(lines.length, 2);
  const [a, b] = lines.map((l) => JSON.parse(l));
  assert.deepEqual([a.event, a.level, a.job, a.count], ["unhandled_rejection", "error", null, 1]);
  assert.deepEqual([b.event, b.job, b.count], ["uncaught_exception", "job-123", 2]);
  assert.equal(a.error_name, "TimeoutError");
  assert.ok(a.message.length <= 200 && !a.message.includes("\n"));
  leakFree(lines.join("\n"));
  assert.deepEqual(exits, [], "no exit by default");
  guard.uninstall();
  assert.equal(proc.listenerCount("unhandledRejection") + proc.listenerCount("uncaughtException"), 0);
});

test("guard: exit only when asked, or when a process keeps raising unhandled errors", () => {
  for (const [env, events, expectExit] of [
    [{ PERMIT_SYNC_EXIT_ON_UNHANDLED: "true" }, 1, true],
    [{ PERMIT_SYNC_MAX_UNHANDLED: "3" }, 2, false],
    [{ PERMIT_SYNC_MAX_UNHANDLED: "3" }, 3, true],
  ]) {
    const proc = new EventEmitter();
    const exits = [];
    installProcessGuard({ log: () => {}, env, proc, exit: (c) => exits.push(c) });
    for (let i = 0; i < events; i += 1) proc.emit("unhandledRejection", new Error("x"));
    assert.deepEqual(exits, expectExit ? [1] : [], JSON.stringify(env));
  }
});

test("guard: a throwing logger cannot throw out of the handler", () => {
  const proc = new EventEmitter();
  installProcessGuard({ log: () => { throw new Error("log failed"); }, proc, env: {}, exit: () => {} });
  assert.doesNotThrow(() => proc.emit("unhandledRejection", new Error("x")));
});

test("describeFatal: non-error values and missing fields", () => {
  assert.deepEqual(Object.keys(describeFatal(undefined)).sort(), ["at", "error_code", "error_name", "message"]);
  assert.equal(describeFatal("plain string").message, "plain string");
  assert.match(describeFatal(new Error("boom")).at, /^permit-sync-process-guard\.test\.js:\d+$/, "file:line only, no directories");
});

function runChild(body, env = {}) {
  const code = `
    const { installProcessGuard } = require(${JSON.stringify(ENTRY)});
    const lines = [];
    installProcessGuard({ log: (level, event, f) => process.stdout.write(JSON.stringify({ level, event, ...f }) + "\\n"), getJobId: () => "job-live", env: process.env });
    (async () => { ${body} })().then(() => setTimeout(() => { process.stdout.write("ALIVE\\n"); }, 100));
  `;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20000 });
  return { status: r.status, out: r.stdout.trim().split("\n").filter(Boolean), err: r.stderr };
}

test("real process: an unhandled rejection from a detached waitForEvent-style promise is logged and the process lives on", () => {
  const r = runChild(`
    const detached = new Promise((_, reject) => setTimeout(() => reject(new Error(${JSON.stringify(noisyError().message)})), 10));
    void detached; // nothing awaits it, like page.waitForEvent("download") after a page close
    await new Promise((res) => setTimeout(res, 60));
  `);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.at(-1), "ALIVE");
  const logged = r.out.filter((l) => l !== "ALIVE").map((l) => JSON.parse(l));
  assert.equal(logged.length, 1);
  assert.deepEqual([logged[0].event, logged[0].job], ["unhandled_rejection", "job-live"]);
  leakFree(r.out.join("\n"));
});

test("real process: an uncaught exception is logged and the process lives on", () => {
  const r = runChild(`setTimeout(() => { throw new Error(${JSON.stringify(noisyError().message)}); }, 10); await new Promise((res) => setTimeout(res, 60));`);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.at(-1), "ALIVE");
  assert.equal(JSON.parse(r.out[0]).event, "uncaught_exception");
  leakFree(r.out.join("\n"));
});

test("real process: an error the caller awaits is not swallowed and is not logged by the guard", () => {
  const r = runChild(`
    let caught = null;
    try { await Promise.reject(new Error("awaited failure")); } catch (e) { caught = e.message; }
    process.stdout.write("CAUGHT:" + caught + "\\n");
  `);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out, ["CAUGHT:awaited failure", "ALIVE"], "the job loop's own try/catch still gets it; the guard logs nothing");
});

test("real process: PERMIT_SYNC_EXIT_ON_UNHANDLED=true exits 1 after logging", () => {
  const r = runChild(`Promise.reject(new Error("x")); await new Promise((res) => setTimeout(res, 200));`, { PERMIT_SYNC_EXIT_ON_UNHANDLED: "true" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.out[0]).event, "unhandled_rejection");
  assert.equal(r.out.includes("ALIVE"), false);
});
