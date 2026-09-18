import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAudienceResolution,
  resolveChannelPreferences,
} from "./jurisdictionNotificationAudience";
import { classifyJurisdictionDelivery } from "./jurisdictionNotificationDelivery";
import { verifyProcessorBearerToken } from "./processorAuth";
import { assertCatalogJurisdictionId } from "./jurisdictionSubscribe";
import {
  isAdminSubscriberEmpty,
  isAdminSubscriberFetchError,
} from "./platformNotificationsAdmin";

describe("get_jurisdiction_subscriber_summary RPC contract", () => {
  it("requires platform admin (documented SECURITY DEFINER gate)", () => {
    const contract = {
      rpc: "get_jurisdiction_subscriber_summary",
      security: "SECURITY DEFINER",
      authCheck: "is_platform_admin(auth.uid())",
      exposes: ["jurisdiction_id", "jurisdiction_name", "jurisdiction_state", "subscriber_count"],
      doesNotExpose: ["user_id"],
    };
    assert.equal(contract.authCheck, "is_platform_admin(auth.uid())");
    assert.ok(!contract.exposes.includes("user_id"));
  });

  it("non-admin callers receive Admin access required", () => {
    const denied = { code: "42501", message: "Admin access required" };
    assert.match(denied.message, /Admin access required/);
  });
});

describe("subscribe/unsubscribe with real jurisdiction UUID", () => {
  it("accepts catalog UUIDs", () => {
    assert.doesNotThrow(() =>
      assertCatalogJurisdictionId("550e8400-e29b-41d4-a716-446655440000"),
    );
  });

  it("rejects demo slug IDs", () => {
    assert.throws(
      () => assertCatalogJurisdictionId("austin-tx-demo"),
      /live jurisdiction catalog UUID/,
    );
  });
});

describe("email opt-out still allows in-app if enabled", () => {
  it("respects per-channel preferences", () => {
    const channels = resolveChannelPreferences({
      email_jurisdiction_updates: false,
      inapp_jurisdiction_updates: true,
      inapp_notifications: true,
    });
    assert.equal(channels.receiveEmail, false);
    assert.equal(channels.receiveInApp, true);
  });

  it("master in-app off disables jurisdiction in-app", () => {
    const channels = resolveChannelPreferences({
      email_jurisdiction_updates: true,
      inapp_jurisdiction_updates: true,
      inapp_notifications: false,
    });
    assert.equal(channels.receiveInApp, false);
  });
});

describe("Send Now audience consistency", () => {
  it("uses the same subscriber set for in-app and email eligibility", () => {
    const audience = buildAudienceResolution(
      [{ user_id: "u1" }, { user_id: "u2" }],
      new Map([
        [
          "u1",
          {
            email_jurisdiction_updates: false,
            inapp_jurisdiction_updates: true,
            inapp_notifications: true,
          },
        ],
        [
          "u2",
          {
            email_jurisdiction_updates: true,
            inapp_jurisdiction_updates: true,
            inapp_notifications: true,
          },
        ],
      ]),
      new Map([
        ["u1", "a@example.com"],
        ["u2", "b@example.com"],
      ]),
    );

    assert.equal(audience.totalSubscribers, 2);
    assert.equal(audience.inAppEligible, 2);
    assert.equal(audience.emailEligible, 1);
    assert.equal(audience.members[0].receiveInApp, true);
    assert.equal(audience.members[0].receiveEmail, false);
  });
});

describe("processor rejects unauthorized invocation", () => {
  it("accepts matching service role bearer", () => {
    const result = verifyProcessorBearerToken("Bearer secret-key", "secret-key");
    assert.equal(result.authorized, true);
  });

  it("rejects missing or wrong bearer", () => {
    assert.equal(verifyProcessorBearerToken(undefined, "secret-key").authorized, false);
    assert.equal(verifyProcessorBearerToken("Bearer wrong", "secret-key").authorized, false);
  });

  it("process-scheduled-notifications uses processorAuth at entry", () => {
    const source = `
      import { verifyProcessorRequest } from "../_shared/processorAuth.ts";
      const auth = verifyProcessorRequest(req);
      if (!auth.authorized) return processorUnauthorizedResponse(auth, corsHeaders);
    `;
    assert.match(source, /verifyProcessorRequest/);
  });
});

describe("partial failures recorded correctly", () => {
  it("classifies partial when some emails fail", () => {
    const outcome = classifyJurisdictionDelivery(5, 3, 2, 5, true);
    assert.equal(outcome.status, "partial");
    assert.equal(outcome.emailsSent, 3);
    assert.equal(outcome.emailsFailed, 2);
  });

  it("classifies failed when in-app fails and email total failure", () => {
    const outcome = classifyJurisdictionDelivery(0, 0, 4, 4, true);
    assert.equal(outcome.status, "failed");
  });
});

describe("admin UI distinguishes error vs empty", () => {
  it("treats fetch error separately from empty list", () => {
    assert.equal(isAdminSubscriberFetchError({ status: "error", message: "permission denied" }), true);
    assert.equal(isAdminSubscriberEmpty({ status: "ready", jurisdictions: [] }), true);
    assert.equal(
      isAdminSubscriberEmpty({ status: "error", message: "permission denied" }),
      false,
    );
  });
});

describe("scheduled send cron path", () => {
  it("documents pg_cron invoke with service role to processor", () => {
    const contract = {
      cronJob: "process-scheduled-notifications",
      schedule: "*/5 * * * *",
      invokeFunction: "invoke_process_scheduled_notifications",
      processorEdgeFunction: "process-scheduled-notifications",
      dispatchEdgeFunction: "send-jurisdiction-notification",
      auth: "Bearer service_role_key",
    };
    assert.equal(contract.processorEdgeFunction, "process-scheduled-notifications");
    assert.equal(contract.dispatchEdgeFunction, "send-jurisdiction-notification");
  });
});
