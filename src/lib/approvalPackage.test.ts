import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatLicenseWarning,
  normalizeApprovalPackage,
  getPropertyIntelligenceError,
} from "./approvalPackage.ts";

describe("approvalPackage normalization", () => {
  it("formats license warnings stored as objects into display strings", () => {
    const warning = {
      professional_name: "Avery Chen",
      license_type: "Architect",
      license_number: "ARCH-000000",
      role_on_project: "Architect of Record",
      status: "not_found",
      issue: "License is not_found",
    };
    const formatted = formatLicenseWarning(warning);
    assert.match(formatted, /Avery Chen/);
    assert.match(formatted, /ARCH-000000/);
    assert.match(formatted, /not_found/);
  });

  it("normalizes a complete approval_package for Review UI", () => {
    const normalized = normalizeApprovalPackage({
      assembled_at: "2026-08-22T00:00:00.000Z",
      property_intelligence: { address: "1200 First St NE", zoning_district: "R-4" },
      license_validation: {
        all_active: false,
        warnings: [
          {
            professional_name: "Avery Chen",
            license_number: "ARCH-000000",
            status: "not_found",
            issue: "License is not_found",
          },
        ],
        results: [{ professional_name: "Avery Chen", validation_status: "not_found" }],
      },
      document_preparation: {
        total_documents: 3,
        documents: [{ name: "plans.pdf", type: "plan", format: "pdf", status: "valid", order: 1 }],
        checklist_results: [{ label: "Construction Plans", found: true, document_name: "plans.pdf" }],
      },
      permit_classification: { permit_type: "building", confidence: 0.91, review_track: "walk_through" },
      agent_summary: [{ agent_name: "property_intelligence", status: "completed", duration_ms: 100 }],
    });

    assert.ok(normalized);
    assert.equal(normalized!.license_validation!.warnings!.length, 1);
    assert.equal(typeof normalized!.license_validation!.warnings![0], "string");
    assert.equal(normalized!.document_preparation!.documents![0].document_name, "plans.pdf");
    assert.equal(normalized!.document_preparation!.documents![0].validation_status, "valid");
    assert.equal(normalized!.document_preparation!.checklist_results![0].item, "Construction Plans");
    assert.equal(normalized!.document_preparation!.checklist_results![0].status, "pass");
  });

  it("handles missing optional sections without throwing", () => {
    const normalized = normalizeApprovalPackage({
      license_validation: { warnings: undefined, results: undefined },
      document_preparation: {},
    });
    assert.deepEqual(normalized!.license_validation!.warnings, []);
    assert.deepEqual(normalized!.license_validation!.results, []);
    assert.deepEqual(normalized!.document_preparation!.documents, []);
  });

  it("extracts property intelligence error strings", () => {
    assert.equal(getPropertyIntelligenceError({ error: "lookup failed" }), "lookup failed");
    assert.equal(getPropertyIntelligenceError({ address: "123 Main" }), null);
  });
});
