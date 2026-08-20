"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isDailyEquipmentWindow,
  runLifecycleSchedulerCycle,
} = require("../app/services/uci/uci-lifecycle-scheduler.service.js");
const { templateContent, EMAIL_TEMPLATES } = require("../app/services/uci/uci-outbound-email.service.js");
const { createTrackBMockSupabase, stage6CompletedRecord } = require("./helpers/uci-track-b-mock.js");

describe("Track B scheduler + templates", () => {
  it("daily window is 06:00 UTC once per day", () => {
    const now = new Date("2026-08-20T06:10:00.000Z");
    assert.equal(isDailyEquipmentWindow(now, null), true);
    assert.equal(isDailyEquipmentWindow(now, new Date("2026-08-20T06:00:00.000Z")), false);
    assert.equal(isDailyEquipmentWindow(new Date("2026-08-20T07:00:00.000Z"), null), false);
  });

  it("runs catch-up with a fake clock and mocked sendMail for three templates", async () => {
    const now = new Date("2026-08-20T06:15:00.000Z");
    const tables = {
      coordination_equipment: [
        {
          id: "eq-1",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          status: "on_order",
          next_check_in_at: "2026-08-19T00:00:00.000Z",
          equipment_type: "transformer",
        },
      ],
      coordination_records: [
        stage6CompletedRecord({
          current_stage: 9,
          current_stage_state: "IN_PROGRESS",
          inspection_release_received_at: "2026-08-18T00:00:00.000Z",
          meter_set_scheduled_at: "2026-08-21T12:00:00.000Z",
          utility_contact_email: "pm@utility.test",
          site_contact_email: "site@job.test",
          site_contact_name: "Alex Site",
        }),
      ],
      coordination_costs: [
        {
          id: "cost-1",
          project_id: "proj-1",
          coordination_record_id: "coord-1",
          paid_at: "2026-08-10T00:00:00.000Z",
          actual_amount: 100,
          qb_sync_status: "retry",
        },
      ],
      projects: [{ id: "proj-1", name: "Site A" }],
      coordination_communications: [],
    };
    const supabase = createTrackBMockSupabase(tables);
    /** @type {string[]} */
    const subjects = [];
    const result = await runLifecycleSchedulerCycle(supabase, {
      now,
      forceDaily: true,
      deps: {
        sendMailFn: async (_token, message) => {
          subjects.push(message.subject);
          return { ok: true, message_id: "m1" };
        },
        createInvoiceFn: async () => ({ id: "QB-1" }),
        queryFn: async () => ({}),
      },
    });
    assert.ok(result.catchup);
    assert.ok(result.meter_48h);
    assert.ok(result.qb);
    assert.ok(subjects.length >= 1);
  });

  it("builds the three outbound templates", () => {
    const a = templateContent(EMAIL_TEMPLATES.EQUIPMENT_ETA_CHECKIN, { equipment_type: "transformer" });
    const b = templateContent(EMAIL_TEMPLATES.METER_SET_REQUEST, { project_name: "Site A" });
    const c = templateContent(EMAIL_TEMPLATES.METER_SET_48H_CHECKLIST, { scheduled_date: "2026-09-01" });
    assert.match(a.subject, /Equipment ETA/);
    assert.match(b.subject, /Meter set request/);
    assert.match(c.body, /Gates are open/);
  });
});
