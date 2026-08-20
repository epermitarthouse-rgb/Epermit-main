import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupPortfolioByProject,
  isTestOrArchiveProject,
  listRecordOperatorAttentionItems,
  matchesPortfolioFilter,
} from "./uciPortfolioPresentation";
import type { PortfolioRecordLike } from "./uciPortfolioPresentation";

function record(overrides: Partial<PortfolioRecordLike> & { id: string; project_id: string }): PortfolioRecordLike {
  return {
    user_id: null,
    tenant_id: null,
    utility_provider_id: null,
    utility_type: "electric",
    scope_description: "",
    current_stage: 4,
    current_stage_state: "IN_PROGRESS",
    utility_account_number: null,
    utility_contact_name: null,
    utility_contact_email: null,
    utility_contact_phone: null,
    application_submitted_at: null,
    acknowledgment_received_at: null,
    class_of_service_issued_at: null,
    energization_target_date: null,
    energization_actual_date: null,
    predicted_p50_date: "2026-10-01",
    predicted_p90_date: "2026-11-01",
    prediction_baseline_source: "seed_fallback",
    agent_monitored: false,
    last_error: null,
    metadata: {},
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    projectName: "McDonald's Highland Springs",
    attentionCount: 0,
    communications: [],
    ...overrides,
  } as PortfolioRecordLike;
}

describe("portfolio project grouping", () => {
  it("nests Highland utilities under one project and keeps them in Active", () => {
    const groups = groupPortfolioByProject([
      record({ id: "e", project_id: "hs", utility_type: "electric", providerDisplayName: "Dominion" }),
      record({ id: "w", project_id: "hs", utility_type: "water", providerDisplayName: "County water", current_stage: 2 }),
      record({ id: "g", project_id: "hs", utility_type: "gas", providerDisplayName: "Columbia gas", current_stage: 3 }),
      record({
        id: "t",
        project_id: "s5uat-old",
        projectName: "s5uat synthetic fixture",
        metadata: { synthetic_test: true },
      }),
    ]);
    assert.equal(groups.length, 2);
    const highland = groups.find((group) => group.projectId === "hs");
    assert.equal(highland?.utilityCount, 3);
    assert.equal(highland?.furthestStage, 4);
    assert.match(highland?.p50Label || "", /Typical \(P50\).*fallback/);
    assert.equal(matchesPortfolioFilter(highland!, "active"), true);
    assert.equal(isTestOrArchiveProject("McDonald's Highland Springs", highland!.records), false);
    const testGroup = groups.find((group) => group.projectId === "s5uat-old");
    assert.equal(matchesPortfolioFilter(testGroup!, "active"), false);
    assert.equal(matchesPortfolioFilter(testGroup!, "archived_test"), true);
  });

  it("flags a null-provider Highland gas row for Assign provider", () => {
    const items = listRecordOperatorAttentionItems(
      record({
        id: "gas",
        project_id: "hs",
        utility_type: "gas",
        utility_provider_id: null,
        current_stage: 1,
        current_stage_state: "IN_PROGRESS",
      }),
    );
    assert.ok(items.some((item) => item.reason === "Gas provider needs confirmation"));
  });
});
