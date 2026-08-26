import { describe, expect, it } from "vitest";
import { readSupabaseBrowserEnv, resolveSupabaseAnonKey } from "@/lib/supabaseEnv";

describe("resolveSupabaseAnonKey", () => {
  it("prefers VITE_SUPABASE_ANON_KEY", () => {
    expect(
      resolveSupabaseAnonKey({
        VITE_SUPABASE_ANON_KEY: "anon-primary",
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      }),
    ).toBe("anon-primary");
  });

  it("falls back to VITE_SUPABASE_PUBLISHABLE_KEY", () => {
    expect(
      resolveSupabaseAnonKey({
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-only",
      }),
    ).toBe("publishable-only");
  });
});

describe("readSupabaseBrowserEnv", () => {
  it("returns url and anon key when configured", () => {
    expect(
      readSupabaseBrowserEnv({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "public-anon-key",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      anonKey: "public-anon-key",
    });
  });

  it("throws when URL is missing", () => {
    expect(() =>
      readSupabaseBrowserEnv({
        VITE_SUPABASE_ANON_KEY: "public-anon-key",
      }),
    ).toThrow(/VITE_SUPABASE_URL/);
  });

  it("throws when anon key is missing", () => {
    expect(() =>
      readSupabaseBrowserEnv({
        VITE_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it("rejects service-role keys in browser configuration", () => {
    expect(() =>
      readSupabaseBrowserEnv({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: "eyJ-role-service_role-marker",
      }),
    ).toThrow(/service-role/i);
  });
});
