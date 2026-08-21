"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolvePackageDocumentSlots,
} = require("../app/services/uci/uci-package-document-bridge.service.js");

describe("uci-package-document-bridge registry integration", () => {
  it("auto-matches template slots via registry when document_type is other", () => {
    const result = resolvePackageDocumentSlots({
      requiredDocuments: [
        {
          key: "single_line_diagram",
          label: "Single-line diagram",
          aliases: ["single_line", "one_line_diagram"],
        },
        {
          key: "site_plan",
          label: "Site plan",
          aliases: ["site_plan"],
        },
      ],
      projectDocuments: [
        {
          id: "doc-sld",
          document_type: "other",
          file_name: "02_SINGLE_LINE_DIAGRAM.pdf",
        },
        {
          id: "doc-site",
          document_type: "other",
          file_name: "06_SITE_PLAN.pdf",
        },
      ],
      registryDocuments: [
        {
          project_document_id: "doc-sld",
          effective_role: "single_line_diagram",
          provider_slot_keys: ["single_line_diagram"],
          role_confidence: "high",
          project_document: {
            id: "doc-sld",
            document_type: "other",
            file_name: "02_SINGLE_LINE_DIAGRAM.pdf",
          },
        },
        {
          project_document_id: "doc-site",
          effective_role: "site_plan",
          provider_slot_keys: ["site_plan"],
          role_confidence: "high",
          project_document: {
            id: "doc-site",
            document_type: "other",
            file_name: "06_SITE_PLAN.pdf",
          },
        },
      ],
      accessContext: {
        projectId: "proj-1",
        coordinationRecordId: "coord-1",
      },
    });

    assert.equal(result.missingDocuments.length, 0);
    assert.equal(result.packageDocuments.length, 2);
    const sld = result.packageDocuments.find((d) => d.key === "single_line_diagram");
    assert.equal(sld?.project_document_id, "doc-sld");
    assert.equal(sld?.registry_role, "single_line_diagram");
  });
});
