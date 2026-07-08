import { describe, expect, it } from "vitest";
import {
  decodeAccessTokenExpiry,
  formatUciUserError,
  isAccessTokenExpiredOrExpiringSoon,
  UciSessionExpiredError,
  UCI_SESSION_EXPIRED_MESSAGE,
} from "@/lib/uciApi";

function buildJwtWithExp(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

describe("UCI auth helpers", () => {
  it("detects tokens expiring within the refresh lead window", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isAccessTokenExpiredOrExpiringSoon(nowSec + 30)).toBe(true);
    expect(isAccessTokenExpiredOrExpiringSoon(nowSec + 120)).toBe(false);
    expect(isAccessTokenExpiredOrExpiringSoon(nowSec - 10)).toBe(true);
  });

  it("decodes JWT exp without logging token contents", () => {
    const exp = 1_900_000_000;
    const token = buildJwtWithExp(exp);
    expect(decodeAccessTokenExpiry(token)).toBe(exp);
  });

  it("maps INVALID_JWT backend text to the sign-in message", () => {
    expect(
      formatUciUserError(new Error("Invalid or expired authentication token"), "fallback"),
    ).toBe(UCI_SESSION_EXPIRED_MESSAGE);
  });

  it("maps UciSessionExpiredError to the sign-in message", () => {
    expect(formatUciUserError(new UciSessionExpiredError(), "fallback")).toBe(
      UCI_SESSION_EXPIRED_MESSAGE,
    );
  });
});
