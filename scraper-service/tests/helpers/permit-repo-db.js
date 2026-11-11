"use strict";

/**
 * PGlite (real Postgres 16, WASM) harness for the central permit repository migration.
 *
 * PGlite starts empty, so the Supabase and pre-existing app objects the migration depends on are
 * created here as stubs. Function bodies are copied from the production migrations named beside
 * each one; table stubs carry only the columns the new migration touches. A divergence between
 * these stubs and production is the main limit of these tests (see PROGRESS.md).
 */

const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");
const MIGRATION = process.env.PERMIT_REPO_MIGRATION || path.join(MIGRATIONS_DIR, "20261111100000_central_permit_repository.sql");
const QUEUE_MIGRATION = process.env.PERMIT_QUEUE_MIGRATION || path.join(MIGRATIONS_DIR, "20261111100100_permit_sync_queue.sql");
const UI_MIGRATION = process.env.PERMIT_UI_MIGRATION || path.join(MIGRATIONS_DIR, "20261111100200_central_permits_ui.sql");

const STUBS = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- 20260112060817
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 20260112170034 + super_admin enum value (20260911200000)
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'super_admin');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, UNIQUE (user_id, role));
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, access_status text NOT NULL DEFAULT 'active');

-- 20260911200500
CREATE FUNCTION public.is_platform_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT public.has_role(_user_id, 'admin'::public.app_role) OR public.has_role(_user_id, 'super_admin'::public.app_role); $$;
CREATE FUNCTION public._admin_require_platform_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END; $$;

-- 20260910120000
CREATE FUNCTION public.is_user_active(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT COALESCE((SELECT p.access_status = 'active' FROM public.profiles p WHERE p.user_id = p_user_id), FALSE); $$;
CREATE FUNCTION public._grant_level_rank(p_level text) RETURNS integer LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE p_level WHEN 'manage' THEN 2 WHEN 'use' THEN 1 ELSE 0 END; $$;

-- 20260210000000
CREATE TABLE public.portal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  jurisdiction text NOT NULL,
  portal_username text NOT NULL,
  portal_password text NOT NULL
);

CREATE TABLE public.user_portal_credential_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id uuid NOT NULL REFERENCES public.portal_credentials(id) ON DELETE CASCADE,
  grant_level text NOT NULL DEFAULT 'none' CHECK (grant_level IN ('none', 'use', 'manage')),
  UNIQUE (user_id, credential_id)
);

-- 20260911200500 (current definition)
CREATE FUNCTION public.credential_has_grant(p_user_id uuid, p_credential_id uuid, p_min_level text DEFAULT 'use')
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grant_level TEXT;
  v_required_rank INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_credential_id IS NULL THEN RETURN FALSE; END IF;
  IF public.is_platform_admin(p_user_id) THEN RETURN TRUE; END IF;
  IF NOT public.is_user_active(p_user_id) THEN RETURN FALSE; END IF;
  v_required_rank := public._grant_level_rank(p_min_level);
  SELECT g.grant_level INTO v_grant_level FROM public.user_portal_credential_grants g
  WHERE g.user_id = p_user_id AND g.credential_id = p_credential_id;
  IF v_grant_level IS NULL THEN RETURN FALSE; END IF;
  RETURN public._grant_level_rank(v_grant_level) >= v_required_rank;
END; $$;

-- 20260715140000
CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE);
CREATE TABLE public.tenant_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid NOT NULL, role text NOT NULL DEFAULT 'member', UNIQUE (tenant_id, user_id));
CREATE FUNCTION public.has_tenant_access(_user_id uuid, _tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = _tenant_id AND user_id = _user_id) $$;

CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text);

CREATE TABLE public.platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text, actor_id uuid, action text NOT NULL, target_type text, target_id text,
  project_id uuid, feature_key text, before_json jsonb, after_json jsonb,
  result text NOT NULL DEFAULT 'success', created_at timestamptz NOT NULL DEFAULT now()
);

-- 20260918200000 (columns used by the UI migration)
CREATE TABLE public.feature_flags (key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false, label text NOT NULL, description text, category text);

-- Supabase storage (subset)
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.objects TO anon, authenticated;
GRANT ALL ON storage.objects, storage.buckets TO service_role;
`;

async function createPermitRepoDb() {
  const db = new PGlite();
  await db.exec(STUBS);
  const migration = fs.readFileSync(MIGRATION, "utf8");
  const queueMigration = fs.readFileSync(QUEUE_MIGRATION, "utf8");
  const uiMigration = fs.readFileSync(UI_MIGRATION, "utf8");
  await db.exec(migration);
  await db.exec(queueMigration);
  await db.exec(uiMigration);

  /** Runs fn(tx) inside a transaction as the given role with auth.uid() = sub. */
  async function as(role, sub, fn) {
    return db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub || ""]);
      await tx.exec(`SET LOCAL ROLE ${role}`);
      return fn(tx);
    });
  }

  const helpers = {
    db,
    migrationSql: migration,
    queueMigrationSql: queueMigration,
    uiMigrationSql: uiMigration,

    /** Calls a service-role function with positional params; returns the first column of the first row. */
    async svc(sql, params = []) {
      return as("service_role", null, async (tx) => {
        const r = await tx.query(sql, params);
        return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
      });
    },
    asUser: (uid, fn) => as("authenticated", uid, fn),
    asAnon: (fn) => as("anon", null, fn),
    asService: (fn) => as("service_role", null, fn),

    async rpc(name, arg) {
      return as("service_role", null, async (tx) => {
        const r = await tx.query(`SELECT public.${name}($1::jsonb) AS out`, [JSON.stringify(arg)]);
        return r.rows[0].out;
      });
    },

    async createUser(id, { role = null, active = true } = {}) {
      await db.query(`INSERT INTO auth.users (id) VALUES ($1)`, [id]);
      await db.query(`INSERT INTO public.profiles (user_id, access_status) VALUES ($1, $2)`, [id, active ? "active" : "suspended"]);
      if (role) await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)`, [id, role]);
      return id;
    },

    async createCredential(id, ownerId, password = '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}') {
      await db.query(
        `INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password) VALUES ($1, $2, 'Washington DC', 'acct', $3)`,
        [id, ownerId, password],
      );
      return id;
    },

    async grantCredential(userId, credentialId, level) {
      await db.query(
        `INSERT INTO public.user_portal_credential_grants (user_id, credential_id, grant_level) VALUES ($1, $2, $3)`,
        [userId, credentialId, level],
      );
    },

    async count(table, where = "TRUE", params = []) {
      const r = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
      return r.rows[0].n;
    },
  };
  return helpers;
}

module.exports = { createPermitRepoDb, MIGRATION, QUEUE_MIGRATION, UI_MIGRATION };
