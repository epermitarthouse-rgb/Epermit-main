import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLoadProfileMetrics,
  canBuildApplicationPackage,
  computeBuilderCompletionPercent,
  evaluateUciBuilderSections,
  formatUtilityProviderLabel,
  resolveServiceFieldValues,
} from "./uciBuilderReadiness.ts";
import type { CoordinationApplication, CoordinationRecord } from "@/types/uci";

function makeRecord(overrides: Partial<CoordinationRecord> = {}): CoordinationRecord {
  return {
    id: "coord-1",
    project_id: "proj-1",
    user_id: null,
    tenant_id: null,
    utility_provider_id: "prov-1",
    utility_type: "electric",
    scope_description: "",
    current_stage: 1,
    current_stage_state: "IN_PROGRESS",
    utility_account_number: null,
    utility_contact_name: "Alex Utility",
    utility_contact_email: "alex@example.com",
    utility_contact_phone: null,
    application_submitted_at: null,
    acknowledgment_received_at: null,
    class_of_service_issued_at: null,
    energization_target_date: "2026-09-19",
    energization_actual_date: null,
    predicted_p50_date: null,
    predicted_p90_date: null,
    agent_monitored: false,
    last_error: null,
    metadata: {},
    created_at: "",
    updated_at: "",
    utility_providers: {
      id: "prov-1",
      slug: "pepco",
      name: "Pepco",
      display_name: "Pepco",
      utility_type: "electric",
      primary_portal_type: null,
      portal_url: null,
      automation_status: "active",
      is_active: true,
    },
    ...overrides,
  };
}

describe("uciBuilderReadiness", () => {
  it("formats provider + utility type from the coordination record", () => {
    assert.equal(formatUtilityProviderLabel(makeRecord()), "Pepco — electric");
  });

  it("does not invent load-factor or standby metrics", () => {
    const metrics = buildLoadProfileMetrics({
      version: "d2.1",
      utility_type: "electric",
      analysis_status: "preliminary",
      inputs_used: [],
      missing_inputs: [],
      needs_verification: [],
      assumptions: { template_id: null, template_version: null, notes: [] },
      calculated_values: { connected_load_kw: 1420, service_voltage: 480, amperage: 1600 },
      source_documents: [],
      generated_at: "",
      generated_by: "test",
      requires_human_review: true,
    });
    const byLabel = Object.fromEntries(metrics.map((m) => [m.label, m]));
    assert.match(String(byLabel["Peak demand / connected load"].value), /1420/);
    assert.equal(byLabel["Load factor"].comingSoon, true);
    assert.equal(byLabel["Load factor"].value, null);
    assert.equal(byLabel["Standby generator"].comingSoon, true);
  });

  it("blocks package build without a load profile draft", () => {
    const blocked = canBuildApplicationPackage({
      coordinationId: "coord-1",
      applications: [],
    });
    assert.equal(blocked.ok, false);
    assert.match(String(blocked.reason), /Load profile/i);

    const apps = [
      {
        id: "a1",
        record_source: "agent_draft",
        idempotency_key: "agent_2_load_profile:d2.1",
        load_summary: { version: "d2.1" },
      },
    ] as CoordinationApplication[];
    const ok = canBuildApplicationPackage({ coordinationId: "coord-1", applications: apps });
    assert.equal(ok.ok, true);
  });

  it("never marks owner section complete and derives progress from real readiness", () => {
    const sections = evaluateUciBuilderSections({
      hasProject: true,
      record: makeRecord(),
      applications: [
        {
          id: "lp",
          coordination_record_id: "coord-1",
          project_id: "proj-1",
          application_type: null,
          package_documents: null,
          load_summary: {
            version: "d2.1",
            utility_type: "electric",
            analysis_status: "preliminary",
            inputs_used: [],
            missing_inputs: [],
            needs_verification: [],
            assumptions: { template_id: null, template_version: null, notes: [] },
            calculated_values: {},
            source_documents: [],
            generated_at: "",
            generated_by: "test",
            requires_human_review: true,
          },
          submission_method: null,
          utility_ticket_number: null,
          submitted_at: null,
          submitted_by: null,
          reviewed_by: null,
          reviewed_at: null,
          draft_status: "draft",
          agent_draft_metadata: {},
          idempotency_key: "agent_2_load_profile:d2.1",
          last_error: null,
          record_source: "agent_draft",
          created_at: "",
          updated_at: "",
        },
      ],
      projectAddress: "100 Main St",
    });
    const owner = sections.find((s) => s.id === "owner");
    assert.equal(owner?.complete, false);
    assert.equal(owner?.status, "coming_soon");
    const pct = computeBuilderCompletionPercent(sections);
    assert.ok(pct < 100);
    assert.ok(pct > 0);
  });

  it("resolves service fields from live project/coordination/load data only", () => {
    const fields = resolveServiceFieldValues({
      projectName: "Demo Site",
      projectType: "commercial",
      record: makeRecord(),
      summary: {
        version: "d2.1",
        utility_type: "electric",
        analysis_status: "preliminary",
        inputs_used: [],
        missing_inputs: [],
        needs_verification: [],
        assumptions: { template_id: null, template_version: null, notes: [] },
        calculated_values: { service_voltage: 480, amperage: 800, phase: "3" },
        source_documents: [],
        generated_at: "",
        generated_by: "test",
        requires_human_review: false,
      },
    });
    assert.equal(fields.project, "Demo Site");
    assert.match(fields.utility, /Pepco/);
    assert.match(fields.voltage, /480/);
    assert.match(fields.amperage, /800/);
    assert.equal(fields.targetDate, "2026-09-19");
    assert.match(fields.contact, /Alex Utility/);
  });
});
