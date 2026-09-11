"use strict";

const {
  FEATURE_KEYS,
  featureLevelSatisfies,
  credentialGrantSatisfies,
  resolveRoleDefaultFeatureAccess,
  resolveActiveUserDefaultFeatureAccess,
  combineFeatureAccessLevels,
  DEFAULT_PROJECT_ACCESS_LEVEL,
  projectAccessToSyntheticRole,
  resolveDefaultCredentialGrantLevel,
} = require("./governance.constants.js");

/** @typedef {"legacy"|"shadow"|"enforce"} EnforceMode */
/** @typedef {"none"|"read"|"write"} FeatureAccessLevel */
/** @typedef {"none"|"use"|"manage"} CredentialGrantLevel */

const ENFORCE_MODES = new Set(["legacy", "shadow", "enforce"]);

/**
 * Map GOVERNANCE_ENFORCE env to mode; null when unset (fall back to DB).
 * @returns {EnforceMode | null}
 */
function enforceModeFromEnv() {
  const raw = process.env.GOVERNANCE_ENFORCE;
  if (raw == null || String(raw).trim() === "") {
    return null;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "enforce") {
    return "enforce";
  }
  if (normalized === "shadow") {
    return "shadow";
  }
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "legacy" ||
    normalized === "off"
  ) {
    return "legacy";
  }

  if (ENFORCE_MODES.has(normalized)) {
    return /** @type {EnforceMode} */ (normalized);
  }

  return null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Promise<EnforceMode>}
 */
async function getEnforceMode(supabase) {
  const fromEnv = enforceModeFromEnv();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const { data, error } = await supabase
      .from("governance_config")
      .select("enforce_mode")
      .limit(1)
      .maybeSingle();

    if (error) {
      return "legacy";
    }

    const mode = data?.enforce_mode;
    if (typeof mode === "string" && ENFORCE_MODES.has(mode)) {
      return /** @type {EnforceMode} */ (mode);
    }
  } catch {
    // Table may not exist during early migration.
  }

  return "legacy";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserActive(supabase, userId) {
  if (!userId) return false;

  try {
    const { data, error } = await supabase.rpc("is_user_active", {
      p_user_id: userId,
    });

    if (!error && typeof data === "boolean") {
      return data;
    }
  } catch {
    // RPC may not exist yet.
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("access_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return true;
  }

  return String(data.access_status || "active") !== "deactivated";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isPlatformAdmin(supabase, userId) {
  if (!userId) return false;

  try {
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    if (!error && typeof data === "boolean") {
      return data;
    }
  } catch {
    // RPC may not be callable with service role args.
  }

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);

  if (error) {
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<import("./governance.constants.js").ProjectRole>}
 */
async function resolveProjectRole(supabase, userId, projectId) {
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!projectErr && project && String(project.user_id) === String(userId)) {
    return "owner";
  }

  const { data: member, error: memberErr } = await supabase
    .from("project_team_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!memberErr && member?.role) {
    const role = String(member.role);
    if (role === "admin" || role === "editor" || role === "viewer") {
      return /** @type {import("./governance.constants.js").ProjectRole} */ (role);
    }
  }

  const { data: hasAccess, error: accessErr } = await supabase.rpc(
    "has_project_access",
    {
      _user_id: userId,
      _project_id: projectId,
    },
  );

  if (!accessErr && hasAccess) {
    return "viewer";
  }

  return "none";
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
async function hasProjectMembership(supabase, userId, projectId) {
  const level = await resolveProjectAccessLevel(supabase, userId, projectId);
  return level !== "none";
}

/**
 * Effective project access: default Write for active users; explicit overrides are exceptions.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<import("./governance.constants.js").ProjectAccessLevel>}
 */
async function resolveProjectAccessLevel(supabase, userId, projectId) {
  if (!userId || !projectId) {
    return "none";
  }

  if (!(await isUserActive(supabase, userId))) {
    return "none";
  }

  if (await isPlatformAdmin(supabase, userId)) {
    return "write";
  }

  try {
    const { data, error } = await supabase.rpc("_resolve_project_access_level", {
      p_user_id: userId,
      p_project_id: projectId,
    });

    if (!error && typeof data === "string") {
      const level = data;
      if (level === "owner" || level === "none" || level === "read" || level === "write") {
        return /** @type {import("./governance.constants.js").ProjectAccessLevel} */ (level);
      }
    }
  } catch {
    // RPC may not exist before migration is applied.
  }

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!projectErr && project && String(project.user_id) === String(userId)) {
    return "owner";
  }

  const { data: override, error: overrideErr } = await supabase
    .from("user_project_access_overrides")
    .select("access_level")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!overrideErr && override?.access_level) {
    const level = String(override.access_level);
    if (level === "none" || level === "read" || level === "write") {
      return /** @type {import("./governance.constants.js").ProjectAccessLevel} */ (level);
    }
  }

  const teamRole = await resolveProjectRole(supabase, userId, projectId);
  if (teamRole === "viewer") {
    return "read";
  }
  if (teamRole === "editor" || teamRole === "admin" || teamRole === "owner") {
    return teamRole === "owner" ? "owner" : "write";
  }

  return DEFAULT_PROJECT_ACCESS_LEVEL;
}

/**
 * User-level feature access (independent of project membership).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} featureKey
 * @returns {Promise<FeatureAccessLevel>}
 */
async function resolveGlobalFeatureAccess(supabase, userId, featureKey) {
  if (!(await isUserActive(supabase, userId))) {
    return "none";
  }

  if (await isPlatformAdmin(supabase, userId)) {
    return "write";
  }

  const { data: globalExplicit, error: globalErr } = await supabase
    .from("user_feature_permissions")
    .select("access_level")
    .eq("user_id", userId)
    .is("project_id", null)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (!globalErr && globalExplicit?.access_level) {
    const globalLevel = String(globalExplicit.access_level);
    if (globalLevel === "none" || globalLevel === "read" || globalLevel === "write") {
      return /** @type {FeatureAccessLevel} */ (globalLevel);
    }
  }

  return resolveActiveUserDefaultFeatureAccess(featureKey);
}

/**
 * Project-scoped effective feature access = global feature access ∩ project role baseline.
 * Project membership for data access is enforced separately via requireProjectAccess.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} projectId
 * @param {string} featureKey
 * @returns {Promise<FeatureAccessLevel>}
 */
async function resolveFeatureAccess(supabase, userId, projectId, featureKey) {
  const globalLevel = await resolveGlobalFeatureAccess(supabase, userId, featureKey);
  if (globalLevel === "none") {
    return "none";
  }

  if (!projectId) {
    return globalLevel;
  }

  const projectAccessLevel = await resolveProjectAccessLevel(supabase, userId, projectId);
  if (projectAccessLevel === "none") {
    return "none";
  }

  const syntheticRole = projectAccessToSyntheticRole(projectAccessLevel);

  const { data: explicit, error } = await supabase
    .from("user_feature_permissions")
    .select("access_level")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("feature_key", featureKey)
    .maybeSingle();

  let projectBaseline = resolveRoleDefaultFeatureAccess(syntheticRole, featureKey);
  if (!error && explicit?.access_level) {
    const level = String(explicit.access_level);
    if (level === "none" || level === "read" || level === "write") {
      projectBaseline = /** @type {FeatureAccessLevel} */ (level);
    }
  }

  return combineFeatureAccessLevels(globalLevel, projectBaseline);
}

/**
 * @param {object} p
 * @param {EnforceMode} p.mode
 * @param {boolean} p.allowed
 * @param {string} p.context
 */
function applyEnforceMode({ mode, allowed, context }) {
  if (allowed || mode === "legacy") {
    return { blocked: false, logged: false };
  }

  if (mode === "shadow") {
    console.warn("[governance][shadow] would-block:", context);
    return { blocked: false, logged: true };
  }

  return { blocked: true, logged: false };
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {string} p.featureKey
 * @param {FeatureAccessLevel} p.requiredLevel
 * @returns {Promise<{ allowed: boolean, mode: EnforceMode, effectiveLevel: FeatureAccessLevel }>}
 */
async function evaluateFeatureAccess({
  supabase,
  userId,
  projectId,
  featureKey,
  requiredLevel,
}) {
  const mode = await getEnforceMode(supabase);
  const effectiveLevel = await resolveFeatureAccess(
    supabase,
    userId,
    projectId,
    featureKey,
  );
  const allowed = featureLevelSatisfies(effectiveLevel, requiredLevel);
  return { allowed, mode, effectiveLevel };
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {string} p.featureKey
 * @param {FeatureAccessLevel} [p.requiredLevel]
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function assertFeatureAccess({
  supabase,
  userId,
  projectId,
  featureKey,
  requiredLevel = "read",
}) {
  const { allowed, mode, effectiveLevel } = await evaluateFeatureAccess({
    supabase,
    userId,
    projectId,
    featureKey,
    requiredLevel,
  });

  const context = `feature ${featureKey}@${projectId} required=${requiredLevel} effective=${effectiveLevel} user=${userId}`;
  const outcome = applyEnforceMode({ mode, allowed, context });

  if (outcome.blocked) {
    const err = new Error(`Forbidden: insufficient feature access (${featureKey})`);
    err.statusCode = 403;
    err.code = "FEATURE_ACCESS_DENIED";
    throw err;
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} credentialId
 * @returns {Promise<{ grantLevel: CredentialGrantLevel, projectId: string | null, jurisdiction: string | null }>}
 */
async function resolveCredentialGrant(supabase, userId, credentialId) {
  if (!(await isUserActive(supabase, userId))) {
    return { grantLevel: "none", projectId: null, jurisdiction: null };
  }

  const platformAdmin = await isPlatformAdmin(supabase, userId);

  const { data, error } = await supabase
    .from("user_portal_credential_grants")
    .select("grant_level, project_id, jurisdiction")
    .eq("user_id", userId)
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (error) {
    return {
      grantLevel: /** @type {CredentialGrantLevel} */ (
        resolveDefaultCredentialGrantLevel(platformAdmin)
      ),
      projectId: null,
      jurisdiction: null,
    };
  }

  if (!data) {
    return {
      grantLevel: /** @type {CredentialGrantLevel} */ (
        resolveDefaultCredentialGrantLevel(platformAdmin)
      ),
      projectId: null,
      jurisdiction: null,
    };
  }

  const grantLevel = String(data.grant_level || "none");
  if (grantLevel === "none") {
    return {
      grantLevel: "none",
      projectId: data.project_id ? String(data.project_id) : null,
      jurisdiction: data.jurisdiction ? String(data.jurisdiction) : null,
    };
  }

  const normalized =
    grantLevel === "use" || grantLevel === "manage" ? grantLevel : "none";

  return {
    grantLevel: /** @type {CredentialGrantLevel} */ (normalized),
    projectId: data.project_id ? String(data.project_id) : null,
    jurisdiction: data.jurisdiction ? String(data.jurisdiction) : null,
  };
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.credentialId
 * @param {"use"|"manage"} [p.requiredLevel]
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function assertCredentialGrant({
  supabase,
  userId,
  credentialId,
  requiredLevel = "use",
}) {
  const mode = await getEnforceMode(supabase);

  if (!(await isUserActive(supabase, userId))) {
    const context = `credential ${credentialId} user deactivated ${userId}`;
    const outcome = applyEnforceMode({ mode, allowed: false, context });
    if (outcome.blocked) {
      const err = new Error("Forbidden: user access deactivated");
      err.statusCode = 403;
      err.code = "USER_DEACTIVATED";
      throw err;
    }
    return;
  }

  const grant = await resolveCredentialGrant(supabase, userId, credentialId);
  const allowed = credentialGrantSatisfies(grant.grantLevel, requiredLevel);

  if (allowed && grant.projectId) {
    const member = await hasProjectMembership(supabase, userId, grant.projectId);
    if (!member) {
      const context = `credential ${credentialId} scoped project ${grant.projectId} user=${userId}`;
      const outcome = applyEnforceMode({ mode, allowed: false, context });
      if (outcome.blocked) {
        const err = new Error("Forbidden: credential scoped to inaccessible project");
        err.statusCode = 403;
        err.code = "CREDENTIAL_SCOPE_DENIED";
        throw err;
      }
      return;
    }
  }

  const context = `credential ${credentialId} required=${requiredLevel} effective=${grant.grantLevel} user=${userId}`;
  const outcome = applyEnforceMode({ mode, allowed, context });

  if (outcome.blocked) {
    const err = new Error("Forbidden: insufficient credential grant");
    err.statusCode = 403;
    err.code = "CREDENTIAL_GRANT_DENIED";
    throw err;
  }
}

/**
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.userId
 * @param {string} p.projectId
 * @param {string} [p.jurisdiction]
 * @param {string} [p.portalSource]
 * @throws {Error & { statusCode?: number, code?: string }}
 */
async function assertScrapedDataAccess({
  supabase,
  userId,
  projectId,
  jurisdiction,
  portalSource,
}) {
  const mode = await getEnforceMode(supabase);

  const { allowed: featureAllowed } = await evaluateFeatureAccess({
    supabase,
    userId,
    projectId,
    featureKey: "scraper.results",
    requiredLevel: "read",
  });

  if (!featureAllowed) {
    const context = `scraped-data feature scraper.results@${projectId} user=${userId}`;
    const outcome = applyEnforceMode({ mode, allowed: false, context });
    if (outcome.blocked) {
      const err = new Error("Forbidden: scraped data access denied");
      err.statusCode = 403;
      err.code = "SCRAPED_DATA_DENIED";
      throw err;
    }
    return;
  }

  const { data: scopes, error } = await supabase
    .from("user_scraped_data_scope")
    .select("scope_type, scope_ref")
    .eq("user_id", userId);

  if (error || !Array.isArray(scopes) || scopes.length === 0) {
    return;
  }

  let scopeMatch = false;

  for (const row of scopes) {
    const scopeType = String(row.scope_type || "");
    const scopeRef = String(row.scope_ref || "");

    if (scopeType === "project" && scopeRef === String(projectId)) {
      scopeMatch = true;
      break;
    }
    if (
      scopeType === "jurisdiction" &&
      jurisdiction &&
      scopeRef === String(jurisdiction)
    ) {
      scopeMatch = true;
      break;
    }
    if (
      scopeType === "portal_source" &&
      portalSource &&
      scopeRef === String(portalSource)
    ) {
      scopeMatch = true;
      break;
    }
  }

  const context = `scraped-data scope project=${projectId} jurisdiction=${jurisdiction || ""} source=${portalSource || ""} user=${userId}`;
  const outcome = applyEnforceMode({ mode, allowed: scopeMatch, context });

  if (outcome.blocked) {
    const err = new Error("Forbidden: scraped data scope mismatch");
    err.statusCode = 403;
    err.code = "SCRAPED_DATA_SCOPE_DENIED";
    throw err;
  }
}

/**
 * Build per-project effective feature map in memory (no per-feature DB round trips).
 * @param {object} p
 * @param {boolean} p.active
 * @param {boolean} p.platformAdmin
 * @param {string} p.projectId
 * @param {import("./governance.constants.js").ProjectRole} p.projectRole
 * @param {Map<string, FeatureAccessLevel>} p.explicitGlobalFeature
 * @param {Map<string, FeatureAccessLevel>} p.explicitByProjectFeature
 * @returns {Record<string, FeatureAccessLevel>}
 */
function computeProjectFeatureMap({
  active,
  platformAdmin,
  projectId,
  projectRole,
  explicitGlobalFeature,
  explicitByProjectFeature,
}) {
  /** @type {Record<string, FeatureAccessLevel>} */
  const features = {};

  if (!active) {
    for (const key of FEATURE_KEYS) {
      features[key] = "none";
    }
    return features;
  }

  if (platformAdmin) {
    for (const key of FEATURE_KEYS) {
      features[key] = "write";
    }
    return features;
  }

  for (const key of FEATURE_KEYS) {
    const globalExplicit = explicitGlobalFeature.get(key);
    const globalLevel =
      globalExplicit === "none" || globalExplicit === "read" || globalExplicit === "write"
        ? globalExplicit
        : resolveActiveUserDefaultFeatureAccess(key);

    const explicit = explicitByProjectFeature.get(`${projectId}:${key}`);
    const projectBaseline =
      explicit === "none" || explicit === "read" || explicit === "write"
        ? explicit
        : resolveRoleDefaultFeatureAccess(projectRole, key);

    features[key] = combineFeatureAccessLevels(globalLevel, projectBaseline);
  }

  return features;
}

/**
 * @param {object} p
 * @param {boolean} p.active
 * @param {boolean} p.platformAdmin
 * @param {Map<string, FeatureAccessLevel>} p.explicitGlobalFeature
 * @returns {Record<string, FeatureAccessLevel>}
 */
function computeGlobalFeatureMap({ active, platformAdmin, explicitGlobalFeature }) {
  /** @type {Record<string, FeatureAccessLevel>} */
  const features = {};

  if (!active) {
    for (const key of FEATURE_KEYS) {
      features[key] = "none";
    }
    return features;
  }

  if (platformAdmin) {
    for (const key of FEATURE_KEYS) {
      features[key] = "write";
    }
    return features;
  }

  for (const key of FEATURE_KEYS) {
    const globalExplicit = explicitGlobalFeature.get(key);
    if (globalExplicit === "none" || globalExplicit === "read" || globalExplicit === "write") {
      features[key] = globalExplicit;
    } else {
      features[key] = resolveActiveUserDefaultFeatureAccess(key);
    }
  }

  return features;
}

/**
 * Fast batched effective-permissions payload matching admin_get_effective_permissions shape.
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Record<string, unknown>>}
 */
async function computeEffectivePermissionsFast(supabase, userId) {
  const [
    profileRes,
    rolesRes,
    ownedProjectsRes,
    teamRowsRes,
    featureRowsRes,
    scopeRowsRes,
    grantRowsRes,
    reviewRes,
    adminCountRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("access_status")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("projects").select("id, name").eq("user_id", userId),
    supabase
      .from("project_team_members")
      .select("project_id, role, projects(id, name)")
      .eq("user_id", userId),
    supabase
      .from("user_feature_permissions")
      .select(
        "id, project_id, feature_key, access_level, granted_by, updated_at",
      )
      .eq("user_id", userId),
    supabase
      .from("user_scraped_data_scope")
      .select("id, scope_type, scope_ref, granted_by, created_at")
      .eq("user_id", userId),
    supabase
      .from("user_portal_credential_grants")
      .select(
        "id, credential_id, grant_level, project_id, jurisdiction, granted_by, updated_at",
      )
      .eq("user_id", userId),
    supabase
      .from("user_access_reviews")
      .select("reviewed_by, reviewed_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin"),
  ]);

  const accessStatus =
    profileRes.data?.access_status === "deactivated" ? "deactivated" : "active";
  const active = accessStatus === "active";
  const platformRoles = (rolesRes.data || []).map((row) => String(row.role));
  const platformAdmin = platformRoles.includes("admin");

  /** @type {Map<string, { project_id: string, project_name: string | null, project_role: import("./governance.constants.js").ProjectRole }>} */
  const projectMap = new Map();

  for (const row of ownedProjectsRes.data || []) {
    projectMap.set(String(row.id), {
      project_id: String(row.id),
      project_name: row.name ? String(row.name) : null,
      project_role: "owner",
    });
  }

  for (const row of teamRowsRes.data || []) {
    const pid = String(row.project_id);
    if (projectMap.has(pid)) {
      continue;
    }
    const nested = row.projects && typeof row.projects === "object" ? row.projects : null;
    const role = String(row.role || "viewer");
    const normalizedRole =
      role === "admin" || role === "editor" || role === "viewer" ? role : "viewer";
    projectMap.set(pid, {
      project_id: pid,
      project_name:
        nested && "name" in nested && nested.name != null
          ? String(nested.name)
          : null,
      project_role: /** @type {import("./governance.constants.js").ProjectRole} */ (
        normalizedRole
      ),
    });
  }

  const featurePermissions = featureRowsRes.data || [];
  /** @type {Map<string, FeatureAccessLevel>} */
  const explicitGlobalFeature = new Map();
  /** @type {Map<string, FeatureAccessLevel>} */
  const explicitByProjectFeature = new Map();
  for (const row of featurePermissions) {
    const level = String(row.access_level || "none");
    if (level !== "none" && level !== "read" && level !== "write") {
      continue;
    }
    if (row.project_id == null) {
      explicitGlobalFeature.set(String(row.feature_key), /** @type {FeatureAccessLevel} */ (level));
      continue;
    }
    explicitByProjectFeature.set(
      `${String(row.project_id)}:${String(row.feature_key)}`,
      /** @type {FeatureAccessLevel} */ (level),
    );
  }

  const scopeRows = scopeRowsRes.data || [];
  const grantRows = grantRowsRes.data || [];
  const scopeLabels = scopeRows.map(
    (row) => `${String(row.scope_type)}:${String(row.scope_ref)}`,
  );
  const activeGrantSummaries = grantRows
    .filter((row) => String(row.grant_level || "none") !== "none")
    .map((row) => ({
      credential_id: String(row.credential_id),
      grant: String(row.grant_level),
    }));

  /** @type {Array<Record<string, unknown>>} */
  const projects = [];
  for (const entry of projectMap.values()) {
    projects.push({
      project_id: entry.project_id,
      project_name: entry.project_name,
      project_role: entry.project_role,
      features: computeProjectFeatureMap({
        active,
        platformAdmin,
        projectId: entry.project_id,
        projectRole: entry.project_role,
        explicitGlobalFeature,
        explicitByProjectFeature,
      }),
      scraped_data_scopes: scopeLabels,
      credentials: activeGrantSummaries,
    });
  }

  /** @type {string[]} */
  const risks = [];
  if (platformAdmin && (adminCountRes.count ?? 0) <= 1) {
    risks.push("sole_platform_admin");
  }

  return {
    user_id: userId,
    access_status: accessStatus,
    platform_admin: platformAdmin,
    platform_roles: platformRoles,
    feature_permissions: featurePermissions.map((row) => ({
      id: row.id,
      project_id: row.project_id ?? null,
      feature_key: String(row.feature_key),
      access_level: String(row.access_level),
      granted_by: row.granted_by ?? null,
      updated_at: row.updated_at ?? null,
    })),
    scraped_data_scope: scopeRows.map((row) => ({
      id: row.id,
      scope_type: String(row.scope_type),
      scope_ref: String(row.scope_ref),
      granted_by: row.granted_by ?? null,
      created_at: row.created_at ?? null,
    })),
    credential_grants: grantRows.map((row) => ({
      id: row.id,
      credential_id: String(row.credential_id),
      grant_level: String(row.grant_level),
      project_id: row.project_id ?? null,
      jurisdiction: row.jurisdiction ?? null,
      granted_by: row.granted_by ?? null,
      updated_at: row.updated_at ?? null,
    })),
    access_review: reviewRes.data
      ? {
          reviewed_by: reviewRes.data.reviewed_by,
          reviewed_at: reviewRes.data.reviewed_at,
        }
      : null,
    global_features: computeGlobalFeatureMap({
      active,
      platformAdmin,
      explicitGlobalFeature,
    }),
    projects,
    risks,
  };
}

/**
 * Add computed per-project feature maps to an RPC payload without extra DB reads.
 * @param {Record<string, unknown>} payload
 */
function enrichRpcEffectivePermissionsPayload(payload) {
  const accessStatus = String(payload.access_status || "active");
  const active = accessStatus === "active";
  const platformAdmin = Boolean(payload.platform_admin);

  /** @type {Map<string, FeatureAccessLevel>} */
  const explicitGlobalFeature = new Map();
  /** @type {Map<string, FeatureAccessLevel>} */
  const explicitByProjectFeature = new Map();
  if (Array.isArray(payload.feature_permissions)) {
    for (const row of payload.feature_permissions) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const record = /** @type {Record<string, unknown>} */ (row);
      const level = String(record.access_level || "none");
      if (level !== "none" && level !== "read" && level !== "write") {
        continue;
      }
      if (record.project_id == null) {
        explicitGlobalFeature.set(
          String(record.feature_key),
          /** @type {FeatureAccessLevel} */ (level),
        );
        continue;
      }
      explicitByProjectFeature.set(
        `${String(record.project_id)}:${String(record.feature_key)}`,
        /** @type {FeatureAccessLevel} */ (level),
      );
    }
  }

  const scopeLabels = Array.isArray(payload.scraped_data_scope)
    ? payload.scraped_data_scope
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const record = /** @type {Record<string, unknown>} */ (row);
          return `${String(record.scope_type)}:${String(record.scope_ref)}`;
        })
    : [];

  const activeGrantSummaries = Array.isArray(payload.credential_grants)
    ? payload.credential_grants
        .filter((row) => row && typeof row === "object")
        .filter(
          (row) =>
            String(
              /** @type {Record<string, unknown>} */ (row).grant_level || "none",
            ) !== "none",
        )
        .map((row) => {
          const record = /** @type {Record<string, unknown>} */ (row);
          return {
            credential_id: String(record.credential_id),
            grant: String(record.grant_level),
          };
        })
    : [];

  payload.global_features = computeGlobalFeatureMap({
    active,
    platformAdmin,
    explicitGlobalFeature,
  });

  if (Array.isArray(payload.projects)) {
    payload.projects = payload.projects.map((row) => {
      if (!row || typeof row !== "object") {
        return row;
      }
      const record = /** @type {Record<string, unknown>} */ (row);
      const projectId = String(record.project_id || "");
      const projectRoleRaw = String(record.project_role || "none");
      const projectRole =
        projectRoleRaw === "owner" ||
        projectRoleRaw === "admin" ||
        projectRoleRaw === "editor" ||
        projectRoleRaw === "viewer"
          ? projectRoleRaw
          : "none";

      return {
        ...record,
        features: computeProjectFeatureMap({
          active,
          platformAdmin,
          projectId,
          projectRole: /** @type {import("./governance.constants.js").ProjectRole} */ (
            projectRole
          ),
          explicitGlobalFeature,
          explicitByProjectFeature,
        }),
        scraped_data_scopes: scopeLabels,
        credentials: activeGrantSummaries,
      };
    });
  }

  if (!Array.isArray(payload.risks)) {
    payload.risks = [];
  }
}

/**
 * Build default+override effective views for admin UI (all projects / all credentials).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} payload
 */
async function assembleEffectiveAccessViews(supabase, payload) {
  const userId = String(payload.user_id || "");
  if (!userId) {
    return;
  }

  const accessStatus = String(payload.access_status || "active");
  const active = accessStatus === "active";
  const platformAdmin = Boolean(payload.platform_admin);

  const explicitGrants = Array.isArray(payload.credential_grants)
    ? payload.credential_grants
    : [];
  /** @type {Map<string, Record<string, unknown>>} */
  const grantByCredential = new Map();
  for (const row of explicitGrants) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = /** @type {Record<string, unknown>} */ (row);
    grantByCredential.set(String(record.credential_id), record);
  }

  const explicitFeatures = Array.isArray(payload.feature_permissions)
    ? payload.feature_permissions.filter(
        (row) =>
          row &&
          typeof row === "object" &&
          /** @type {Record<string, unknown>} */ (row).project_id == null,
      )
    : [];

  const [
    allProjectsRes,
    allCredentialsRes,
    overridesRes,
  ] = await Promise.all([
    supabase.from("projects").select("id, name, user_id").order("name"),
    supabase
      .from("portal_credentials")
      .select("id, jurisdiction, portal_username")
      .order("jurisdiction")
      .order("portal_username"),
    supabase
      .from("user_project_access_overrides")
      .select("project_id, access_level")
      .eq("user_id", userId),
  ]);

  /** @type {Map<string, string>} */
  const overrideByProject = new Map();
  for (const row of overridesRes.data || []) {
    overrideByProject.set(String(row.project_id), String(row.access_level));
  }

  /** @type {Array<Record<string, unknown>>} */
  const projectAccess = [];
  let projectExceptionCount = 0;

  for (const project of allProjectsRes.data || []) {
    const projectId = String(project.id);
    const isOwner = String(project.user_id) === userId;
    let effectiveAccess = "write";
    let source = "Default";
    let control = "default";

    if (!active) {
      effectiveAccess = "none";
      source = "Inactive user";
      control = "none";
    } else if (isOwner) {
      effectiveAccess = "owner";
      source = "Project ownership";
      control = "default";
    } else if (platformAdmin) {
      effectiveAccess = "write";
      source = "Platform admin";
      control = "default";
    } else {
      const override = overrideByProject.get(projectId);
      if (override) {
        effectiveAccess = override;
        source = override === "none" ? "Admin restriction" : "Admin override";
        control = override;
        projectExceptionCount += 1;
      } else {
        const level = await resolveProjectAccessLevel(supabase, userId, projectId);
        if (level === "owner") {
          effectiveAccess = "owner";
          source = "Project ownership";
        } else if (level !== DEFAULT_PROJECT_ACCESS_LEVEL) {
          effectiveAccess = level;
          source = level === "none" ? "Admin restriction" : "Admin override";
          control = level;
          projectExceptionCount += 1;
        }
      }
    }

    projectAccess.push({
      project_id: projectId,
      project_name: project.name ? String(project.name) : null,
      effective_access: effectiveAccess,
      source,
      control,
      is_owner: isOwner,
    });
  }

  const defaultCredentialGrant = resolveDefaultCredentialGrantLevel(platformAdmin);
  /** @type {Array<Record<string, unknown>>} */
  const credentialAccess = [];
  let credentialExceptionCount = 0;

  for (const credential of allCredentialsRes.data || []) {
    const credentialId = String(credential.id);
    const explicit = grantByCredential.get(credentialId);
    const explicitLevel = explicit ? String(explicit.grant_level || "none") : null;

    let effectiveGrant = defaultCredentialGrant;
    let source = "Default";
    let control = "default";

    if (!active) {
      effectiveGrant = "none";
      source = "Inactive user";
      control = "none";
    } else if (explicitLevel) {
      effectiveGrant =
        explicitLevel === "use" || explicitLevel === "manage" || explicitLevel === "none"
          ? explicitLevel
          : "none";
      if (effectiveGrant === defaultCredentialGrant) {
        source = "Default";
        control = "default";
      } else {
        source = effectiveGrant === "none" ? "Admin restriction" : "Admin override";
        control = effectiveGrant;
        credentialExceptionCount += 1;
      }
    }

    credentialAccess.push({
      credential_id: credentialId,
      jurisdiction: credential.jurisdiction ?? null,
      portal_username: credential.portal_username ?? null,
      effective_access: effectiveGrant,
      source,
      control,
    });
  }

  let featureExceptionCount = 0;
  if (active && !platformAdmin) {
    featureExceptionCount = explicitFeatures.length;
  }

  payload.project_access = projectAccess;
  payload.credential_access = credentialAccess;
  payload.access_summaries = {
    projects:
      !active
        ? "No project access"
        : platformAdmin
          ? "All projects — Write"
          : `All projects — Write`,
    projects_exception_count: projectExceptionCount,
    features:
      !active
        ? "No feature access"
        : platformAdmin
          ? "All standard features — Write"
          : "All standard features — Write",
    features_exception_count: featureExceptionCount,
    credentials:
      !active
        ? "No credential access"
        : platformAdmin
          ? "All credentials — Manage"
          : "All credentials — Use",
    credentials_exception_count: credentialExceptionCount,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Record<string, unknown>>}
 */
async function computeEffectivePermissions(supabase, userId) {
  let payload;

  try {
    const { data, error } = await supabase.rpc("admin_get_effective_permissions", {
      p_user_id: userId,
    });

    if (!error && data && typeof data === "object") {
      payload = /** @type {Record<string, unknown>} */ (data);
      enrichRpcEffectivePermissionsPayload(payload);
    }
  } catch {
    // Fall through to batched JS computation.
  }

  if (!payload) {
    payload = await computeEffectivePermissionsFast(supabase, userId);
  }

  await assembleEffectiveAccessViews(supabase, payload);
  return payload;
}

/**
 * Strip password-like fields from audit payloads.
 * @param {unknown} value
 * @returns {unknown}
 */
function sanitizeAuditJson(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditJson(item));
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const lower = key.toLowerCase();
    if (
      lower.includes("password") ||
      lower.includes("secret") ||
      lower.includes("token") ||
      lower === "portal_password"
    ) {
      continue;
    }
    out[key] = sanitizeAuditJson(val);
  }
  return out;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ id?: string }>}
 */
async function appendAuditEvent(supabase, payload) {
  const sanitized = {
    correlation_id: payload.correlation_id ?? null,
    actor_id: payload.actor_id ?? null,
    action: payload.action ?? "unknown",
    target_type: payload.target_type ?? null,
    target_id: payload.target_id != null ? String(payload.target_id) : null,
    project_id: payload.project_id ?? null,
    feature_key: payload.feature_key ?? null,
    before_json: sanitizeAuditJson(payload.before_json ?? null),
    after_json: sanitizeAuditJson(payload.after_json ?? null),
    result: payload.result ?? "success",
  };

  try {
    const { data, error } = await supabase.rpc("admin_append_audit_event", {
      p_action: sanitized.action,
      p_target_type: sanitized.target_type,
      p_target_id: sanitized.target_id,
      p_project_id: sanitized.project_id,
      p_feature_key: sanitized.feature_key,
      p_before_json: sanitized.before_json,
      p_after_json: sanitized.after_json,
      p_result: sanitized.result,
      p_correlation_id: sanitized.correlation_id,
      p_actor_id: sanitized.actor_id,
    });

    if (!error) {
      return { id: data != null ? String(data) : undefined };
    }
  } catch {
    // Fall through to direct insert.
  }

  const { data, error } = await supabase
    .from("platform_audit_events")
    .insert(sanitized)
    .select("id")
    .single();

  if (error) {
    throw Object.assign(new Error(error.message || "Failed to append audit event"), {
      cause: error,
      statusCode: 500,
      code: "AUDIT_APPEND_FAILED",
    });
  }

  return { id: data?.id ? String(data.id) : undefined };
}

module.exports = {
  enforceModeFromEnv,
  getEnforceMode,
  isUserActive,
  isPlatformAdmin,
  resolveProjectRole,
  resolveProjectAccessLevel,
  hasProjectMembership,
  resolveGlobalFeatureAccess,
  resolveFeatureAccess,
  evaluateFeatureAccess,
  assertFeatureAccess,
  resolveCredentialGrant,
  assertCredentialGrant,
  assertScrapedDataAccess,
  computeEffectivePermissions,
  assembleEffectiveAccessViews,
  sanitizeAuditJson,
  appendAuditEvent,
};
