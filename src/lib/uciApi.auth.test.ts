import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeAccessTokenExpiry,
  formatUciUserError,
  isAccessTokenExpiredOrExpiringSoon,
  UciSessionExpiredError,
  UCI_SESSION_EXPIRED_MESSAGE,
} from "./uciApi.ts";

function buildJwtWithExp(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

describe("UCI auth helpers", () => {
  it("detects tokens expiring within the refresh lead window", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    assert.equal(isAccessTokenExpiredOrExpiringSoon(nowSec + 30), true);
    assert.equal(isAccessTokenExpiredOrExpiringSoon(nowSec + 120), false);
    assert.equal(isAccessTokenExpiredOrExpiringSoon(nowSec - 10), true);
  });

  it("decodes JWT exp without logging token contents", () => {
    const exp = 1_900_000_000;
    const token = buildJwtWithExp(exp);
    assert.equal(decodeAccessTokenExpiry(token), exp);
  });

  it("maps INVALID_JWT backend text to the sign-in message", () => {
    assert.equal(
      formatUciUserError(new Error("Invalid or expired authentication token"), "fallback"),
      UCI_SESSION_EXPIRED_MESSAGE,
    );
  });

  it("maps UciSessionExpiredError to the sign-in message", () => {
    assert.equal(formatUciUserError(new UciSessionExpiredError(), "fallback"), UCI_SESSION_EXPIRED_MESSAGE);
  });
});
