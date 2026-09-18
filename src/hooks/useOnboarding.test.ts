import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldShowOnboarding } from "./onboardingLogic";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("shouldShowOnboarding", () => {
  it("shows wizard for admin-created user with onboarding_completed=false", () => {
    assert.equal(
      shouldShowOnboarding({ isAuthenticated: true, onboardingCompleted: false }),
      true,
    );
  });

  it("hides wizard for migrated existing user with onboarding_completed=true", () => {
    assert.equal(
      shouldShowOnboarding({ isAuthenticated: true, onboardingCompleted: true }),
      false,
    );
  });

  it("hides wizard when user is not authenticated", () => {
    assert.equal(
      shouldShowOnboarding({ isAuthenticated: false, onboardingCompleted: false }),
      false,
    );
  });

  it("shows wizard when profile flag is missing (treat as incomplete)", () => {
    assert.equal(
      shouldShowOnboarding({ isAuthenticated: true, onboardingCompleted: null }),
      true,
    );
  });
});

describe("useOnboarding hook implementation", () => {
  const source = readSource("src/hooks/useOnboarding.ts");

  it("reads onboarding_completed from profiles, not full_name", () => {
    assert.match(source, /select\("onboarding_completed"\)/);
    assert.doesNotMatch(source, /select\("full_name"\)/);
    assert.doesNotMatch(source, /from\("projects"\)/);
    assert.match(source, /shouldShowOnboarding/);
  });

  it("does not gate on localStorage before DB check", () => {
    assert.doesNotMatch(source, /localStorage\.getItem/);
  });

  it("persists onboarding_completed=true on completeOnboarding", () => {
    assert.match(source, /update\(\{\s*onboarding_completed:\s*true\s*\}\)/);
    assert.match(source, /\.eq\("user_id", user\.id\)/);
  });

  it("writes localStorage only after successful DB persist (secondary cache)", () => {
    assert.match(source, /onboarding_completed:\s*true/);
    assert.match(source, /localStorage\.setItem\(`\$\{ONBOARDING_KEY\}_\$\{user\.id\}`, "true"\)/);
    const completeBlock = source.slice(
      source.indexOf("const completeOnboarding"),
      source.indexOf("const resetOnboarding"),
    );
    assert.ok(completeBlock.indexOf("onboarding_completed: true") < completeBlock.indexOf("localStorage.setItem"));
  });

  it("enrolls in drip campaign once on completion", () => {
    assert.match(source, /enrollInDripCampaign/);
    assert.match(source, /campaign_type:\s*"onboarding"/);
    assert.match(source, /completeOnboarding[\s\S]*enrollInDripCampaign/);
  });

  it("resetOnboarding clears DB flag", () => {
    assert.match(source, /update\(\{\s*onboarding_completed:\s*false\s*\}\)/);
    assert.match(source, /localStorage\.removeItem/);
  });
});

describe("admin-created user profile", () => {
  it("sets onboarding_completed=false in admin create upsert", () => {
    const source = readSource(
      "scraper-service/app/services/governance/admin-create-user.service.js",
    );
    assert.match(source, /onboarding_completed:\s*false/);
  });
});

describe("onboarding migration", () => {
  it("adds column and backfills existing users as completed", () => {
    const migration = readSource(
      "supabase/migrations/20260919010000_profiles_onboarding_completed.sql",
    );
    assert.match(migration, /ADD COLUMN.*onboarding_completed boolean NOT NULL DEFAULT false/s);
    assert.match(migration, /UPDATE public\.profiles[\s\S]*SET onboarding_completed = true/s);
    assert.match(migration, /handle_new_user[\s\S]*onboarding_completed[\s\S]*false/s);
  });
});

describe("cross-browser persistence", () => {
  it("DB flag is authoritative — no localStorage read gate", () => {
    const source = readSource("src/hooks/useOnboarding.ts");
    assert.match(source, /from\("profiles"\)/);
    assert.doesNotMatch(source, /localStorage\.getItem/);
    assert.match(source, /onboarding_completed/);
  });
});
