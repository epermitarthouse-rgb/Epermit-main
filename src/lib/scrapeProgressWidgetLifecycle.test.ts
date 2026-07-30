import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCELA_BROWSER_SESSION_KEY,
  LEGACY_SCRAPE_ACTIVE_SESSION_KEY,
  clearAccelaBrowserSessionStorage,
  clearAllPersistedScrapeSessions,
  clearPersistedScrapeSession,
  getPersistedScrapeSession,
  migrateOrClearLegacyScrapeSession,
  persistScrapeSession,
  scrapeActiveSessionStorageKey,
  type PersistedScrapeSession,
} from "./scrapeActiveSessionStorage.ts";
import { canRestorePersistedScrapeJob, isOwnedScrapeJob } from "./scrapeJobOwnership.ts";
import {
  TERMINAL_AUTO_CLOSE_FAILURE_MS,
  TERMINAL_AUTO_CLOSE_SUCCESS_MS,
  resolvePanelDisplayStatus,
  terminalAutoCloseDelayMs,
  terminalFlashKindFromStatus,
} from "./scrapeTerminalLifecycle.ts";
import {
  beginPollRequest,
  bumpPollGeneration,
  canApplyPollResult,
  createPollGenerationGate,
  finishPollRequest,
} from "./scrapePollRaceGuard.ts";
import {
  classifyScrapeToastMessage,
  shouldShowScrapeToast,
} from "./scrapeToastPolicy.ts";
import { scrapeOutcomeFromJobStatus } from "./scrapeJobTypes.ts";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

function sampleSession(
  overrides: Partial<PersistedScrapeSession> = {},
): PersistedScrapeSession {
  return {
    userId: "user-a",
    tenantId: "tenant-1",
    sessionId: "sess-1",
    jobId: "job-1",
    projectId: "proj-1",
    projectNum: "P-1",
    startedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("scrapeActiveSessionStorage", () => {
  it("persists under user-scoped key and clears legacy key", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY, JSON.stringify({ stale: true }));
    persistScrapeSession(sampleSession(), storage);
    assert.equal(storage.getItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY), null);
    assert.ok(storage.getItem(scrapeActiveSessionStorageKey("user-a")));
    const read = getPersistedScrapeSession("user-a", storage);
    assert.equal(read?.jobId, "job-1");
    assert.equal(read?.userId, "user-a");
  });

  it("migrates legacy unscoped key into user-scoped key", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_SCRAPE_ACTIVE_SESSION_KEY,
      JSON.stringify({
        sessionId: "sess-legacy",
        jobId: "job-legacy",
        projectId: "proj-1",
        projectNum: "P-1",
        startedAt: 123,
      }),
    );
    const migrated = migrateOrClearLegacyScrapeSession("user-b", storage);
    assert.equal(storage.getItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY), null);
    assert.equal(migrated?.userId, "user-b");
    assert.equal(migrated?.jobId, "job-legacy");
    assert.equal(
      getPersistedScrapeSession("user-b", storage)?.sessionId,
      "sess-legacy",
    );
  });

  it("sign-out clear removes scrape + accela keys (T1)", () => {
    const storage = new MemoryStorage();
    persistScrapeSession(sampleSession(), storage);
    persistScrapeSession(sampleSession({ userId: "user-b", jobId: "job-b" }), storage);
    storage.setItem(
      ACCELA_BROWSER_SESSION_KEY,
      JSON.stringify({
        sessionId: "accela",
        projectId: "proj-1",
        portalType: "accela",
        permitNumber: "P-1",
        savedAt: 1,
      }),
    );
    clearAllPersistedScrapeSessions(storage);
    clearAccelaBrowserSessionStorage(storage);
    assert.equal(storage.getItem(scrapeActiveSessionStorageKey("user-a")), null);
    assert.equal(storage.getItem(scrapeActiveSessionStorageKey("user-b")), null);
    assert.equal(storage.getItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY), null);
    assert.equal(storage.getItem(ACCELA_BROWSER_SESSION_KEY), null);
  });

  it("User A session is not readable as User B (T6)", () => {
    const storage = new MemoryStorage();
    persistScrapeSession(sampleSession({ userId: "user-a" }), storage);
    assert.equal(getPersistedScrapeSession("user-b", storage), null);
    assert.equal(getPersistedScrapeSession("user-a", storage)?.jobId, "job-1");
  });

  it("clearPersistedScrapeSession removes completed pointer (T3/T7)", () => {
    const storage = new MemoryStorage();
    persistScrapeSession(sampleSession(), storage);
    clearPersistedScrapeSession("user-a", storage);
    assert.equal(getPersistedScrapeSession("user-a", storage), null);
  });

  it("signed-out getPersistedScrapeSession returns null and clears legacy (T2)", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_SCRAPE_ACTIVE_SESSION_KEY,
      JSON.stringify({
        sessionId: "s",
        jobId: "j",
        projectId: "p",
        projectNum: "",
        startedAt: 1,
      }),
    );
    assert.equal(getPersistedScrapeSession(null, storage), null);
    assert.equal(storage.getItem(LEGACY_SCRAPE_ACTIVE_SESSION_KEY), null);
  });
});

describe("scrapeJobOwnership / restore (T4/T5)", () => {
  it("allows restore only for owned non-terminal jobs", () => {
    const ownedRunning = {
      user_id: "user-a",
      tenant_id: "tenant-1",
      project_id: "proj-1",
      status: "running",
    };
    assert.equal(
      canRestorePersistedScrapeJob(ownedRunning, {
        userId: "user-a",
        tenantId: "tenant-1",
        projectId: "proj-1",
      }),
      true,
    );
  });

  it("rejects other user even when project matches (T5)", () => {
    assert.equal(
      isOwnedScrapeJob(
        {
          user_id: "user-a",
          tenant_id: "tenant-1",
          project_id: "proj-1",
          status: "running",
        },
        { userId: "user-b", tenantId: "tenant-1", projectId: "proj-1" },
      ),
      false,
    );
    assert.equal(
      canRestorePersistedScrapeJob(
        {
          user_id: "user-a",
          project_id: "proj-1",
          status: "running",
        },
        { userId: "user-b", projectId: "proj-1" },
      ),
      false,
    );
  });

  it("rejects completed jobs on restore (T3)", () => {
    assert.equal(
      canRestorePersistedScrapeJob(
        {
          user_id: "user-a",
          project_id: "proj-1",
          status: "completed",
        },
        { userId: "user-a", projectId: "proj-1" },
      ),
      false,
    );
  });
});

describe("terminal lifecycle (T7/T8/T14)", () => {
  it("success auto-close is brief; failed/cancelled longer", () => {
    assert.equal(terminalFlashKindFromStatus("completed"), "success");
    assert.equal(
      terminalAutoCloseDelayMs("completed"),
      TERMINAL_AUTO_CLOSE_SUCCESS_MS,
    );
    assert.equal(terminalFlashKindFromStatus("failed"), "failed");
    assert.equal(terminalFlashKindFromStatus("cancelled"), "cancelled");
    assert.equal(
      terminalFlashKindFromStatus("partial_external_blocker"),
      "blocker",
    );
    assert.equal(
      terminalAutoCloseDelayMs("failed"),
      TERMINAL_AUTO_CLOSE_FAILURE_MS,
    );
    assert.equal(
      terminalAutoCloseDelayMs("cancelled"),
      TERMINAL_AUTO_CLOSE_FAILURE_MS,
    );
  });

  it("failed_unrecoverable terminates as error (T14)", () => {
    assert.equal(scrapeOutcomeFromJobStatus("failed_unrecoverable"), "error");
    assert.equal(terminalFlashKindFromStatus("failed_unrecoverable"), "failed");
  });

  it("panel shows loading/unavailable instead of default running (polling accuracy)", () => {
    assert.equal(
      resolvePanelDisplayStatus(undefined, { loading: true }),
      "loading",
    );
    assert.equal(
      resolvePanelDisplayStatus(null, { loading: false, error: "fail" }),
      "unavailable",
    );
    assert.equal(
      resolvePanelDisplayStatus("running", { loading: false }),
      "running",
    );
  });
});

describe("poll race guard (T12)", () => {
  it("stale poll generation cannot apply after jobId change", () => {
    const gate = createPollGenerationGate();
    const gen1 = bumpPollGeneration(gate);
    const controller = beginPollRequest(gate, gen1);
    assert.ok(controller);

    // Newer job takes over
    const gen2 = bumpPollGeneration(gate);
    assert.notEqual(gen1, gen2);
    assert.equal(
      canApplyPollResult(gate, gen1, "job-old", "job-new"),
      false,
    );
    assert.equal(
      canApplyPollResult(gate, gen2, "job-new", "job-new"),
      true,
    );

    finishPollRequest(gate, controller!);
  });

  it("one generation tracks one in-flight request (T9 poller hygiene)", () => {
    const gate = createPollGenerationGate();
    const gen = bumpPollGeneration(gate);
    const first = beginPollRequest(gate, gen);
    const second = beginPollRequest(gate, gen);
    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
    assert.equal(gate.controller, second);
  });
});

describe("scrape toast policy (T9/T10)", () => {
  it("suppresses progress/success/restore/completion when widget active", () => {
    const suppressed = [
      "Chain Step 1/5: Portal Scraping...",
      "Logging into portal...",
      "Reconnecting to portal...",
      "Reconnecting to Arlington Accela...",
      "Using active portal session...",
      "Scraping started — you can continue using the app.",
      "Your scrape is queued — it will run next.",
      "Scrape already running — attached to existing job.",
      "Restoring scrape progress…",
      "Scraping complete. Data saved to your project.",
      "Retry started for 3 failed item(s).",
      "Scrape cancelled",
    ];
    for (const msg of suppressed) {
      assert.equal(
        shouldShowScrapeToast(msg, { widgetActive: true }),
        false,
        msg,
      );
    }
  });

  it("keeps start-request errors (T10)", () => {
    const kept = [
      "Local Scraper is not running. Run 'node server.js' in the scraper-service folder, then retry.",
      "You must be logged in to run this check.",
      "Scrape request already in progress.",
      "Scrape already running for this project.",
      "No project found. Select a project in the header Active Project control or create one first.",
      "Failed to cancel scrape",
    ];
    for (const msg of kept) {
      assert.equal(
        shouldShowScrapeToast(msg, { widgetActive: true }),
        true,
        msg,
      );
      assert.ok(
        ["start_error", "action_error"].includes(classifyScrapeToastMessage(msg)) ||
          classifyScrapeToastMessage(msg) === "other" ||
          classifyScrapeToastMessage(msg) === "start_error",
        `${msg} → ${classifyScrapeToastMessage(msg)}`,
      );
    }
  });
});

describe("header indicator visibility rules (T15)", () => {
  it("isScraping requires non-terminal owned job semantics", () => {
    // Mirror ScrapeContext formula in pure form for regression.
    function computeIsScraping(opts: {
      userId: string | null;
      activeJobId: string | null;
      terminalOverride: string | null;
      loading: boolean;
      jobStatus: string | null;
      ownershipRejected: boolean;
    }) {
      const terminal = [
        "completed",
        "completed_with_warnings",
        "partial_external_blocker",
        "failed",
        "failed_unrecoverable",
        "cancelled",
      ].includes(opts.jobStatus || "");
      return (
        Boolean(opts.userId) &&
        Boolean(opts.activeJobId) &&
        !opts.terminalOverride &&
        (opts.loading || Boolean(opts.jobStatus)) &&
        !terminal &&
        !opts.ownershipRejected
      );
    }

    assert.equal(
      computeIsScraping({
        userId: null,
        activeJobId: "job",
        terminalOverride: null,
        loading: false,
        jobStatus: "running",
        ownershipRejected: false,
      }),
      false,
    );
    assert.equal(
      computeIsScraping({
        userId: "u",
        activeJobId: "job",
        terminalOverride: null,
        loading: false,
        jobStatus: "completed",
        ownershipRejected: false,
      }),
      false,
    );
    assert.equal(
      computeIsScraping({
        userId: "u",
        activeJobId: "job",
        terminalOverride: "cancelled",
        loading: false,
        jobStatus: "running",
        ownershipRejected: false,
      }),
      false,
    );
    assert.equal(
      computeIsScraping({
        userId: "u",
        activeJobId: "job",
        terminalOverride: null,
        loading: false,
        jobStatus: "running",
        ownershipRejected: false,
      }),
      true,
    );
  });
});
