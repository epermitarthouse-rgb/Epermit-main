import { describe, expect, it } from "vitest";
import {
  buildPasswordResetRedirectUrl,
  isPasswordRecoveryUrl,
  resetPasswordSchema,
} from "@/lib/authPasswordReset";

describe("authPasswordReset", () => {
  it("builds reset redirect URL from origin", () => {
    expect(buildPasswordResetRedirectUrl("https://app.example.com")).toBe(
      "https://app.example.com/auth/reset-password",
    );
  });

  it("detects recovery hash/query markers", () => {
    expect(isPasswordRecoveryUrl("#access_token=x&type=recovery", "")).toBe(true);
    expect(isPasswordRecoveryUrl("", "?type=recovery")).toBe(true);
    expect(isPasswordRecoveryUrl("#access_token=x&type=signup", "")).toBe(false);
  });

  it("validates matching reset passwords", () => {
    const ok = resetPasswordSchema.safeParse({
      newPassword: "NewPass123",
      confirmPassword: "NewPass123",
    });
    expect(ok.success).toBe(true);

    const bad = resetPasswordSchema.safeParse({
      newPassword: "NewPass123",
      confirmPassword: "Mismatch1",
    });
    expect(bad.success).toBe(false);
  });
});
