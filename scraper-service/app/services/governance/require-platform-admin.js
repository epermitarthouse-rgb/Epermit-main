"use strict";

const {
  requireAuthenticatedUser,
  sanitizeUciError,
} = require("../uci/uci-access.service.js");
const { isUserActive, isPlatformAdmin } = require("./governance.service.js");

/**
 * @param {{ supabase: import("@supabase/supabase-js").SupabaseClient }} opts
 */
function createRequirePlatformAdmin(opts) {
  const { supabase } = opts;

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {import("express").NextFunction} next
   */
  return async function requirePlatformAdmin(req, res, next) {
    try {
      const user = await requireAuthenticatedUser(req, supabase);

      const active = await isUserActive(supabase, user.id);
      if (!active) {
        return res.status(403).json({
          error: "USER_DEACTIVATED",
          message: "User access is deactivated",
        });
      }

      const admin = await isPlatformAdmin(supabase, user.id);
      if (!admin) {
        return res.status(403).json({
          error: "PLATFORM_ADMIN_REQUIRED",
          message: "Platform admin access required",
        });
      }

      req.platformAdminUser = user;
      next();
    } catch (err) {
      const s = sanitizeUciError(err);
      res.status(s.httpStatus).json(s.body);
    }
  };
}

module.exports = {
  createRequirePlatformAdmin,
};
