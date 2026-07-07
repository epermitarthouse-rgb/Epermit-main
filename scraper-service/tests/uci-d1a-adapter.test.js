"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveUtilityAdapter } = require("../app/services/uci/adapters/utility-adapter-registry.js");
const {
  pepcoAdapter,
  needsHumanAttentionFromText,
} = require("../app/services/uci/adapters/pepco.adapter.js");
const { sha256Fingerprint } = require("../app/services/uci/uci-sync-utils.js");
const { extractPortalApplicationsFromMetadata } = require("../app/services/uci/uci-portal-sync.service.js");

const SAMPLE_APP = {
  applicationUuid: "11111111-2222-3333-4444-555555555555",
  overview: {
    projectName: "Wonder - Tenant Fit Out",
    jobId: "PEPCO-NB-0064620",
    statusName: "Contract Sent",
    actionRequired: true,
  },
  currentStatus: "Contract Sent",
  currentMilestone: "Engineering and Design",
  statusLastUpdatedAt: "2026-06-17T14:27:40.7344615+00:00",
  statusChanges: [
    {
      milestoneName: "Engineering and Design",
      statusName: "Contract Sent",
      statusChangeDateTime: "2026-06-17T14:27:40.7344615+00:00",
    },
    {
      milestoneName: "Initiation",
      statusName: "Submitted",
      statusChangeDateTime: "2026-03-03T14:53:38.6592192+00:00",
    },
  ],
  messages: [
    {
      statusChangeDisplayName: "Contract Sent",
      senderMessage: "Action required: please review contract",
      isSPOC: true,
      isInternalUser: false,
      receiverName: "Project Team",
      receiverMessage: null,
      messageDateTime: "2026-06-17T14:28:00.000+00:00",
    },
  ],
  downloadedFiles: [
    {
      documentName: "plan.pdf",
      localPath: "/tmp/debug/pepco-docs/plan.pdf",
    },
  ],
};

const CONTEXT = {
  coordinationRecordId: "coord-1",
  projectId: "proj-1",
  tenantId: null,
  providerSlug: "pepco",
  syncedAt: "2026-07-08T00:00:00.000Z",
};

describe("UCI D1A adapter registry", () => {
  it("resolves PEPCO adapter", () => {
    const { adapter, warnings } = resolveUtilityAdapter("pepco");
    assert.equal(adapter.providerSlug, "pepco");
    assert.equal(warnings.length, 0);
  });

  it("returns generic adapter with warning for unsupported utilities", () => {
    const { adapter, warnings } = resolveUtilityAdapter("dominion");
    assert.equal(adapter.providerSlug, "generic");
    assert.ok(warnings.length > 0);
    assert.equal(adapter.normalizeApplication({}, CONTEXT), null);
  });
});

describe("UCI D1A PEPCO adapter normalization", () => {
  it("maps application fields", () => {
    const app = pepcoAdapter.normalizeApplication(SAMPLE_APP, CONTEXT);
    assert.ok(app);
    assert.equal(app.external_application_id, SAMPLE_APP.applicationUuid);
    assert.equal(app.external_job_id, "PEPCO-NB-0064620");
    assert.equal(app.portal_status, "Contract Sent");
    assert.equal(app.portal_milestone, "Engineering and Design");
    assert.equal(app.record_source, "portal_sync");
    assert.equal(app.action_required, true);
    assert.equal(app.portal_submitted_at, "2026-03-03T14:53:38.6592192+00:00");
    assert.equal(
      /** @type {{ portal_snapshot?: { applicationUuid?: string } }} */ (app.metadata)
        .portal_snapshot?.applicationUuid,
      SAMPLE_APP.applicationUuid,
    );
  });

  it("normalizes communications with null classification and attention flag", () => {
    const comms = pepcoAdapter.normalizeMessages(SAMPLE_APP, CONTEXT);
    assert.equal(comms.length, 1);
    assert.equal(comms[0].channel, "portal_message");
    assert.equal(comms[0].classification, null);
    assert.equal(comms[0].needs_human_attention, true);
    assert.equal(comms[0].direction, "inbound");
    assert.ok(comms[0].idempotency_key);
  });

  it("uses stable communication fingerprint", () => {
    const first = pepcoAdapter.normalizeMessages(SAMPLE_APP, CONTEXT)[0];
    const second = pepcoAdapter.normalizeMessages(SAMPLE_APP, CONTEXT)[0];
    assert.equal(first.idempotency_key, second.idempotency_key);
  });

  it("normalizes portal status events", () => {
    const events = pepcoAdapter.normalizeStatusEvents(SAMPLE_APP, CONTEXT);
    assert.equal(events.length, 2);
    assert.equal(events[0].milestone_type, "portal_status_event");
    assert.equal(events[0].status, "completed");
    assert.equal(events[0].source, "portal_sync");
    assert.equal(events[0].portal_status, "Contract Sent");
    assert.ok(events[0].idempotency_key);
  });

  it("detects attention keywords deterministically", () => {
    assert.equal(needsHumanAttentionFromText("Contract Sent", "payment due soon"), true);
    assert.equal(needsHumanAttentionFromText("Update", "routine notice"), false);
  });
});

describe("UCI D1A metadata extraction", () => {
  it("extracts PEPCO applications from coordination metadata", () => {
    const metadata = {
      pepco_application_detail_discovery: {
        applications: [SAMPLE_APP],
      },
    };
    const apps = extractPortalApplicationsFromMetadata(metadata, "pepco");
    assert.equal(apps.length, 1);
    assert.equal(apps[0].applicationUuid, SAMPLE_APP.applicationUuid);
  });
});

describe("UCI D1A fingerprint normalization", () => {
  it("normalizes whitespace and case before hashing", () => {
    const a = sha256Fingerprint(["PEPCO", "id-1", "2026-01-01", "Sender", "Hello   world"]);
    const b = sha256Fingerprint(["pepco", "id-1", "2026-01-01", "sender", "hello world"]);
    assert.equal(a, b);
  });
});
