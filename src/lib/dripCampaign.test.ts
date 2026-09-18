import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDripStats,
  daysSinceEnrollment,
  getEmailProgress,
  isDripCampaignComplete,
  ONBOARDING_DRIP_EMAIL_COUNT,
  resolveNextDripEmailIndex,
  type DripCampaignRow,
} from "./dripCampaignStats";
import {
  isDripCampaignEmpty,
  isDripCampaignFetchError,
} from "./dripCampaignAdmin";
import {
  isDripProcessorAdminRole,
  isDripProcessorServiceRoleAuth,
  verifyProcessorBearerToken,
} from "./processorAuth";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function makeCampaign(overrides: Partial<DripCampaignRow> = {}): DripCampaignRow {
  return {
    id: "c1",
    user_id: "u1",
    email: "user@example.com",
    user_name: "Test User",
    campaign_type: "onboarding",
    enrolled_at: new Date().toISOString(),
    emails_sent: 0,
    last_email_sent_at: null,
    is_active: true,
    completed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("onboarding enrollment creation", () => {
  it("useOnboarding enrolls with campaign_type onboarding on complete", () => {
    const source = readSource("src/hooks/useOnboarding.ts");
    assert.match(source, /enrollInDripCampaign/);
    assert.match(source, /campaign_type:\s*"onboarding"/);
    assert.match(source, /user_drip_campaigns/);
    assert.match(source, /completeOnboarding[\s\S]*enrollInDripCampaign/);
  });

  it("ignores duplicate enrollment via unique constraint", () => {
    const source = readSource("src/hooks/useOnboarding.ts");
    assert.match(source, /unique_user_campaign/);
  });
});

describe("admin list via admin-drip-campaigns edge function", () => {
  it("requires admin role before listing all enrollments", () => {
    const source = readSource("supabase/functions/admin-drip-campaigns/index.ts");
    assert.match(source, /Admin access required/);
    assert.match(source, /user_drip_campaigns/);
    assert.match(source, /action === "list"/);
  });

  it("DripCampaignManager uses admin-drip-campaigns not direct table query", () => {
    const source = readSource("src/lib/dripCampaignAdmin.ts");
    assert.match(source, /admin-drip-campaigns/);
    assert.doesNotMatch(readSource("src/components/admin/DripCampaignManager.tsx"), /from\('user_drip_campaigns'\)/);
  });
});

describe("drip sequence progression", () => {
  it("sends day 1 email on enrollment day", () => {
    assert.equal(resolveNextDripEmailIndex(0, 0), 0);
  });

  it("waits until day 3 threshold before second email", () => {
    assert.equal(resolveNextDripEmailIndex(1, 1), null);
    assert.equal(resolveNextDripEmailIndex(2, 1), 1);
  });

  it("progresses through all four emails", () => {
    assert.equal(resolveNextDripEmailIndex(0, 0), 0);
    assert.equal(resolveNextDripEmailIndex(2, 1), 1);
    assert.equal(resolveNextDripEmailIndex(4, 2), 2);
    assert.equal(resolveNextDripEmailIndex(6, 3), 3);
  });

  it("returns null when sequence is complete", () => {
    assert.equal(resolveNextDripEmailIndex(10, 4), null);
    assert.equal(isDripCampaignComplete(4), true);
    assert.equal(isDripCampaignComplete(3), false);
  });

  it("increments emails_sent and marks inactive after final email", () => {
    const processorSource = readSource("supabase/functions/process-drip-emails/index.ts");
    assert.match(processorSource, /emails_sent: newEmailsSent/);
    assert.match(processorSource, /is_active: !isComplete/);
    assert.match(processorSource, /completed_at: isComplete/);
  });
});

describe("calculateDripStats", () => {
  it("computes accurate stats for mixed enrollments", () => {
    const campaigns = [
      makeCampaign({ is_active: true, emails_sent: 2, completed_at: null }),
      makeCampaign({ id: "c2", is_active: false, emails_sent: 4, completed_at: "2026-01-01T00:00:00Z" }),
      makeCampaign({ id: "c3", is_active: true, emails_sent: 1, completed_at: null }),
    ];

    const stats = calculateDripStats(campaigns);
    assert.equal(stats.totalEnrolled, 3);
    assert.equal(stats.activeCount, 2);
    assert.equal(stats.completedCount, 1);
    assert.equal(stats.totalEmailsSent, 7);
    assert.equal(stats.avgEmailsPerUser, 7 / 3);
    assert.equal(stats.completionRate, (1 / 3) * 100);
  });

  it("handles empty enrollments without crash", () => {
    const stats = calculateDripStats([]);
    assert.equal(stats.totalEnrolled, 0);
    assert.equal(stats.avgEmailsPerUser, 0);
    assert.equal(stats.completionRate, 0);
    assert.equal(getEmailProgress(0).totalEmails, ONBOARDING_DRIP_EMAIL_COUNT);
  });
});

describe("automatic processing cron path", () => {
  it("migration defines invoke_process_drip_emails with service role", () => {
    const migration = readSource("supabase/migrations/20260918230000_onboarding_drip_cron.sql");
    assert.match(migration, /invoke_process_drip_emails/);
    assert.match(migration, /process-drip-emails/);
    assert.match(migration, /app\.settings\.supabase_url/);
    assert.match(migration, /app\.settings\.service_role_key/);
    assert.match(migration, /Authorization.*service_role_key/s);
    assert.match(migration, /cron\.schedule/);
  });

  it("process-drip-emails uses verifyDripProcessorRequest at entry", () => {
    const source = readSource("supabase/functions/process-drip-emails/index.ts");
    assert.match(source, /verifyDripProcessorRequest/);
    assert.match(source, /processorUnauthorizedResponse/);
  });
});

describe("manual Process Now auth", () => {
  it("accepts service role bearer for cron/manual service calls", () => {
    assert.equal(isDripProcessorServiceRoleAuth("Bearer secret-key", "secret-key"), true);
  });

  it("accepts platform admin roles", () => {
    assert.equal(isDripProcessorAdminRole(["admin"]), true);
    assert.equal(isDripProcessorAdminRole(["super_admin"]), true);
  });

  it("rejects non-admin users", () => {
    assert.equal(isDripProcessorAdminRole(["user"]), false);
    assert.equal(isDripProcessorAdminRole([]), false);
    assert.equal(isDripProcessorAdminRole(null), false);
  });
});

describe("processor auth rejection", () => {
  it("rejects missing or wrong bearer (anonymous)", () => {
    assert.equal(verifyProcessorBearerToken(undefined, "secret-key").authorized, false);
    assert.equal(verifyProcessorBearerToken("Bearer wrong", "secret-key").authorized, false);
  });

  it("returns 403 for admin access required in drip processor", () => {
    const source = readSource("supabase/functions/_shared/processorAuth.ts");
    assert.match(source, /Admin access required.*403/s);
  });
});

describe("email branding consistency", () => {
  it("uses PermitPilot branding in drip templates", () => {
    const source = readSource("supabase/functions/_shared/dripOnboardingEmail.ts");
    assert.match(source, /PermitPilot/);
    assert.doesNotMatch(source, /Permit Insight/);
  });

  it("resolves from address from DRIP_FROM_EMAIL or RESEND_FROM_EMAIL", () => {
    const source = readSource("supabase/functions/_shared/dripOnboardingEmail.ts");
    assert.match(source, /DRIP_FROM_EMAIL/);
    assert.match(source, /RESEND_FROM_EMAIL/);
  });

  it("loads shared email_branding_settings in processor", () => {
    const source = readSource("supabase/functions/process-drip-emails/index.ts");
    assert.match(source, /email_branding_settings/);
  });
});

describe("admin UI error vs empty states", () => {
  it("treats fetch error separately from empty list", () => {
    assert.equal(isDripCampaignFetchError({ status: "error", message: "Admin access required" }), true);
    assert.equal(isDripCampaignEmpty({ status: "ready", campaigns: [] }), true);
    assert.equal(
      isDripCampaignEmpty({ status: "error", message: "Admin access required" }),
      false,
    );
  });

  it("DripCampaignManager shows error alert without stats crash", () => {
    const source = readSource("src/components/admin/DripCampaignManager.tsx");
    assert.match(source, /Unable to load onboarding enrollments/);
    assert.match(source, /stats\?\.avgEmailsPerUser \?\? 0\)\.toFixed/);
    assert.match(source, /completionRate \?\? 0\)\.toFixed/);
  });
});

describe("admin page onboarding wording", () => {
  it("describes onboarding emails not jurisdiction subscribers", () => {
    const page = readSource("src/pages/admin/AdminPlatformCampaigns.tsx");
    assert.match(page, /Onboarding emails/);
    assert.doesNotMatch(page, /jurisdiction subscribers/i);
    assert.doesNotMatch(page, /drip marketing/i);
  });
});

describe("daysSinceEnrollment", () => {
  it("computes whole days since enrolled_at", () => {
    const enrolled = new Date("2026-01-01T12:00:00Z");
    const now = new Date("2026-01-04T11:00:00Z");
    assert.equal(daysSinceEnrollment(enrolled, now), 2);
  });
});
