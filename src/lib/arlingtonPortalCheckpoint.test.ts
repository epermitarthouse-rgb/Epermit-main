import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergePortalDataIfNewer, readPortalCheckpointVersion } from "./arlingtonPortalCheckpoint";

function countAttachmentRows(portalData: Record<string, unknown> | null) {
  const tabs = portalData?.tabs as Record<string, unknown> | undefined;
  const att = tabs?.attachments as { tables?: { rows?: unknown[] }[] } | undefined;
  const rows = att?.tables?.[0]?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Progressive UI contract exercised by PortalDataViewer + useArlingtonLivePortalRefresh.
 * Simulates checkpoint polling without a live browser.
 */
function applyProgressiveRefresh(
  visible: Record<string, unknown> | null,
  incoming: Record<string, unknown> | null,
) {
  return mergePortalDataIfNewer(visible, incoming);
}

describe("Arlington progressive UI integration contract", () => {
  for (const permitKind of ["building", "zoning"] as const) {
    it(`${permitKind}: steps 1-10 progressive refresh and remount`, () => {
      // 1. Start at checkpointVersion 0
      let visible: Record<string, unknown> | null = {
        checkpointVersion: 0,
        tabs: { attachments: { tables: [{ rows: [] }] } },
        permitKind,
      };
      assert.equal(readPortalCheckpointVersion(visible), 0);

      // 2. Running job exists (external); poll applies v1
      const v1 = {
        checkpointVersion: 1,
        tabs: {
          attachments: {
            tables: [{ rows: [{ name: "a.pdf", publicUrl: "https://x/a.pdf" }] }],
          },
        },
        permitKind,
      };
      visible = applyProgressiveRefresh(visible, v1);
      assert.equal(readPortalCheckpointVersion(visible), 1);
      assert.equal(countAttachmentRows(visible), 1);

      // 5-6. v2 adds another file
      const v2 = {
        checkpointVersion: 2,
        tabs: {
          attachments: {
            tables: [
              {
                rows: [
                  { name: "a.pdf", publicUrl: "https://x/a.pdf" },
                  { name: "b.pdf", publicUrl: "https://x/b.pdf" },
                ],
              },
            ],
          },
        },
        permitKind,
      };
      visible = applyProgressiveRefresh(visible, v2);
      assert.equal(readPortalCheckpointVersion(visible), 2);
      assert.equal(countAttachmentRows(visible), 2);

      // 7-8. stale v0 must not regress
      const stale = {
        checkpointVersion: 0,
        tabs: { attachments: { tables: [{ rows: [] }] } },
        permitKind,
      };
      visible = applyProgressiveRefresh(visible, stale);
      assert.equal(readPortalCheckpointVersion(visible), 2);
      assert.equal(countAttachmentRows(visible), 2);

      // 9-10. remount reloads v2 from Supabase snapshot
      const remountedFromDb = structuredClone(v2);
      visible = applyProgressiveRefresh(null, remountedFromDb);
      assert.equal(readPortalCheckpointVersion(visible), 2);
      assert.equal(countAttachmentRows(visible), 2);
    });
  }

  it("step 3-4: accepts checkpointVersion 1 with one downloaded file", () => {
    const incoming = {
      checkpointVersion: 1,
      tabs: {
        attachments: {
          tables: [{ rows: [{ name: "a.pdf", publicUrl: "https://x/a.pdf" }] }],
        },
      },
    };
    const merged = mergePortalDataIfNewer(null, incoming);
    assert.equal(readPortalCheckpointVersion(merged), 1);
    assert.equal(countAttachmentRows(merged), 1);
  });

  it("step 7-8: stale version 0 is rejected when current is version 2", () => {
    const current = {
      checkpointVersion: 2,
      tabs: {
        attachments: {
          tables: [{ rows: [{ name: "b.pdf", publicUrl: "https://x/b.pdf" }] }],
        },
      },
    };
    const stale = {
      checkpointVersion: 0,
      tabs: { attachments: { tables: [{ rows: [] }] } },
    };
    const merged = mergePortalDataIfNewer(current, stale);
    assert.equal(readPortalCheckpointVersion(merged), 2);
    assert.equal(countAttachmentRows(merged), 1);
  });
});
