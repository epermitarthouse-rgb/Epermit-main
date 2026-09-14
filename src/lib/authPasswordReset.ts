import { z } from "zod";

export const PASSWORD_RESET_REDIRECT_PATH = "/auth/reset-password";
export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";

export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export function buildPasswordResetRedirectUrl(origin?: string): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${PASSWORD_RESET_REDIRECT_PATH}`;
}

export function isPasswordRecoveryUrl(
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
  search: string = typeof window !== "undefined" ? window.location.search : "",
): boolean {
  const combined = `${hash}${search}`.toLowerCase();
  return (
    combined.includes("type=recovery") ||
    combined.includes("password_recovery") ||
    combined.includes("recovery")
  );
}
