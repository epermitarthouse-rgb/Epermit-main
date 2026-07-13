import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildOperationSummary,
  type PepcoPortalHeaderSectionProps,
} from "./PepcoPortalDrawerSection.tsx";

/**
 * Fixture derived from GET /api/uci/coordination/0de0938f-9ede-4e36-a0f9-bbc6113a2296
 * after openDetail() resets pepcoLastNormalizedSync to null (detail API has no top-level
 * normalized_sync field; metadata.uci_last_portal_sync_summary is a different shape).
 */
const coordinationDetailDrawerProps: PepcoPortalHeaderSectionProps = {
  detailId: "0de0938f-9ede-4e36-a0f9-bbc6113a2296",
  detailLoading: false,
  formatWhen: (iso) => iso ?? "—",
  mutedClass: "text-muted-foreground",
  sectionTitleClass: "text-foreground",
  pepcoDownloadDocuments: false,
  onPepcoDownloadDocumentsChange: () => {},
  pepcoDiscoveryBusy: false,
  pepcoResumeBusy: false,
  pepcoDashboardBusy: false,
  pepcoAppDetailBusy: false,
  pepcoAppDetailResumeBusy: false,
  pepcoCodeSubmitBusy: false,
  pepcoCodeModalOpen: false,
  normalizedSyncBusy: false,
  pepcoPendingSessionId: null,
  pepcoAppDetailPendingSessionId: null,
  pepcoAppDetailMfaSessionId: null,
  pepcoDiscoveryMsg: null,
  pepcoDashboardMsg: null,
  pepcoAppDetailMsg: null,
  pepcoLastNormalizedSync: null,
  hasPepcoDashboardCards: true,
  hasPepcoApplicationDetails: true,
  pepcoDashboardFromMetadata: {
    status: "completed",
    lastAt: "2026-07-07T15:28:51.409Z",
    cardsFound: 3,
    applicationIdsFound: 3,
    discoverySource: null,
    listApiWarning: null,
  },
  pepcoApplicationDetailDiscovery: {
    lastStatus: "completed",
    lastScrapedAt: "2026-07-08T17:57:11.940Z",
    applications: [
      {
        applicationUuid: "05f5038f-0edd-4151-b575-60569a55e827",
        currentStatus: "Contract Sent",
        scrapedAt: "2026-07-08T17:57:11.940Z",
        scrapeStatus: "completed",
      },
    ],
  },
  onLoginCheck: () => {},
  onDiscoverDashboard: () => {},
  onResumeInterrupted: () => {},
  onNormalizedSync: () => {},
};

describe("PepcoPortalHeaderSection buildOperationSummary", () => {
  it("does not throw when pepcoLastNormalizedSync is null after coordination detail load", () => {
    assert.doesNotThrow(() => buildOperationSummary(coordinationDetailDrawerProps));
    assert.equal(buildOperationSummary(coordinationDetailDrawerProps), null);
  });

  it("surfaces partial normalized sync when a result object is present", () => {
    const summary = buildOperationSummary({
      ...coordinationDetailDrawerProps,
      pepcoLastNormalizedSync: {
        status: "partial",
        applications: { discovered: 1, inserted: 0, updated: 1, skipped: 0, failed: 0 },
        communications: { discovered: 1, inserted: 0, updated: 0, skipped: 0, failed: 1 },
        milestones: { discovered: 5, inserted: 0, updated: 5, skipped: 0, failed: 0 },
        errors: ["communication_insert_failed"],
        synced_at: "2026-07-08T17:57:11.940Z",
      },
    });
    assert.equal(summary?.label, "System sync issue");
    assert.match(String(summary?.detail), /partial/i);
  });
});
