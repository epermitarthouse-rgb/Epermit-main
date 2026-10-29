import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessDoorEvidence,
  assessGuardrailHeightAssociation,
  assessHydraulicRelationships,
  buildEvidencePackage,
  collectTopicHits,
  computePilotMetrics,
  PILOT_SHEETS,
  VISUAL_EVIDENCE_PILOT_VERSION,
} from "../lib/visualEvidencePilot.mjs";

describe("visual evidence pilot", () => {
  it("keeps provenance unverified and distinguishes not_found", () => {
    assert.match(VISUAL_EVIDENCE_PILOT_VERSION, /phase3\.visual-evidence-pilot/);
    const sheet = PILOT_SHEETS[0];
    const empty = buildEvidencePackage({ sheet, topic: "locking", hits: [] });
    assert.equal(empty.status, "not_found");
    assert.equal(empty.notFoundVsNotExamined, "not_found_on_examined_ocr_layout");
    assert.equal(empty.provenance.independentlyVerified, false);
  });

  it("associates guardrail height only with co-located guard-rail evidence", () => {
    const associated = assessGuardrailHeightAssociation([
      {
        text: "3'-6\"MIN HEIGHT FROM",
        bbox: { x: 190, y: 1460, width: 20, height: 80 },
        regionId: "band-drawing-field",
      },
      {
        text: "EXTEND GUARD RAIL MIN. 30\"",
        bbox: { x: 290, y: 1600, width: 200, height: 20 },
        regionId: "band-drawing-field",
      },
    ]);
    assert.equal(associated.applicableToGuardrail, "likely_same_detail_candidate");

    const distant = assessGuardrailHeightAssociation([
      {
        text: "MIN HEIGHT FROM membrane",
        bbox: { x: 10, y: 10, width: 40, height: 10 },
        regionId: "other",
      },
      {
        text: "GUARD RAIL SLEEVE",
        bbox: { x: 2000, y: 1600, width: 40, height: 10 },
        regionId: "far",
      },
    ]);
    assert.equal(distant.applicableToGuardrail, "unresolved");
  });

  it("treats density×area as distinct from FLOW DEMAND", () => {
    const assessment = assessHydraulicRelationships([
      { text: "DENSITY:" },
      { text: "0.15 GPM" },
      { text: "DISCHARGE AREA:" },
      { text: "1524" },
      { text: "HOSE ALLOWANCE:" },
      { text: "250.00 GPM" },
      { text: "FLOW DEMAND:" },
      { text: "596.81 GPM" },
    ]);
    assert.equal(assessment.values.densityGpmPerSqFt, 0.15);
    assert.equal(assessment.values.dischargeAreaSqFt, 1524);
    assert.equal(assessment.values.densityTimesArea, 228.6);
    assert.equal(assessment.values.flowDemandGpm, 596.81);
    assert.equal(assessment.relationships.densityAreaEqualsFlowDemand, false);
    assert.equal(assessment.independentlyVerified, false);
  });

  it("flags door locking/fire quotes as contradiction candidates for absence Criticals", () => {
    const hits = collectTopicHits({
      associations: [
        { text: "1 EA PANIC 9975EO-LD", bbox: { x: 1, y: 1, width: 10, height: 10 }, regionKind: "drawing_field", origin: "visual_interpretation" },
        { text: "11. PROVIDE FIRE RATED GASKETS FOR DOOR #11", bbox: { x: 2, y: 2, width: 10, height: 10 }, regionKind: "notes_band", origin: "visual_interpretation" },
        { text: "DOOR SCHEDULE", bbox: { x: 3, y: 3, width: 10, height: 10 }, regionKind: "schedule_candidate", origin: "visual_interpretation" },
      ],
    }, "locking");
    assert.ok(hits.length >= 1);
    const door = assessDoorEvidence({
      door_schedule: [{ text: "DOOR SCHEDULE" }],
      locking: hits,
      fire_rating: [{ text: "11. PROVIDE FIRE RATED GASKETS FOR DOOR #11" }],
      egress_notes: [{ text: "ALL EXIT DOORS SHALL BE KEYLESS IN THE DIRECTION OF EGRESS." }],
    });
    assert.equal(door.phase2bCriticalStance.lockingAbsenceCritical, "contradicted_candidate_by_quoted_hardware");
    assert.match(door.phase2bCriticalStance.fireRatingAbsenceCritical, /partially_contradicted/);
  });

  it("summarizes recovery metrics without claiming accuracy", () => {
    const metrics = computePilotMetrics(
      [{ status: "evidence_recovered", crop: { status: "ok", path: "/tmp/x.png" } }, { status: "not_found", crop: null }],
      [{
        sheetId: "A-6.00",
        assessments: { door: { lockingHardwareQuoted: true, fireRatingLanguageQuoted: true } },
      }, {
        sheetId: "A-3.06",
        assessments: { guardrail: { applicableToGuardrail: "likely_same_detail_candidate" } },
      }, {
        sheetId: "FP200",
        assessments: {
          hydraulic: {
            values: {
              densityGpmPerSqFt: 0.15,
              dischargeAreaSqFt: 1524,
              flowDemandGpm: 596.81,
              hoseAllowanceGpm: 250,
            },
            relationships: { densityAreaEqualsFlowDemand: false },
          },
        },
      }],
    );
    assert.equal(metrics.evidenceRecovered, 1);
    assert.equal(metrics.a6LockingRecovered, true);
    assert.equal(metrics.fp200DensityAreaEqualsFlowDemand, false);
  });
});
