"use strict";

const crypto = require("crypto");

function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1];
}

function isServiceRoleKey(token, serviceRoleKey) {
  if (!token || !serviceRoleKey) {
    return false;
  }
  const left = Buffer.from(String(token));
  const right = Buffer.from(String(serviceRoleKey));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/**
 * Compliance scraper routes: accept end-user JWT (Supabase Auth) or the project's
 * service-role key from trusted backend workers (Code Analyzer worker, Express).
 */
async function authenticateComplianceServiceRequest(req, supabaseAdmin) {
  const token = extractBearerToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Authentication required",
    };
  }

  const configuredServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configuredServiceKey && isServiceRoleKey(token, configuredServiceKey)) {
    return { ok: true, caller: "service_role" };
  }

  if (supabaseAdmin) {
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (!authError && user) {
      return { ok: true, caller: "user", user };
    }
  }

  return {
    ok: false,
    status: 401,
    error: "Invalid or expired authentication token",
  };
}

module.exports = {
  authenticateComplianceServiceRequest,
  extractBearerToken,
  isServiceRoleKey,
};
