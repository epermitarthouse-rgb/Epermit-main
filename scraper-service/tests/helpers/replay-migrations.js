"use strict";

/**
 * Replays the full supabase/migrations chain (in filename order) on PGlite with a minimal Supabase
 * platform baseline: roles, auth/storage schemas, and stand-ins for extensions PGlite cannot load
 * (pg_cron, pg_net, Vault, pgcrypto). pgvector is the real extension.
 *
 * Purpose: prove the central permit repository migration applies on top of the real existing schema
 * (real portal_credentials, credential_has_grant, projects, ...) instead of hand-written stubs.
 * Stand-ins only satisfy DDL; cron jobs, HTTP calls and secrets never execute.
 *
 * Usage: node tests/helpers/replay-migrations.js [--upto <filename>]
 * `exclude` drops named files, so a chain can be compared with and without specific migrations.
 */

const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { vector } = require("@electric-sql/pglite/vector");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

const PLATFORM_BASELINE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_admin NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE supabase_storage_admin NOLOGIN;
CREATE ROLE dashboard_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE FUNCTION extensions.digest(data text, alg text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE lower(alg) WHEN 'sha256' THEN sha256(convert_to(data, 'UTF8')) ELSE NULL END $$;
CREATE FUNCTION extensions.digest(data bytea, alg text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE lower(alg) WHEN 'sha256' THEN sha256(data) ELSE NULL END $$;
CREATE FUNCTION extensions.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql VOLATILE AS
  $$ SELECT decode(string_agg(lpad(to_hex((random() * 255)::int), 2, '0'), ''), 'hex') FROM generate_series(1, n) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  instance_id uuid, id uuid PRIMARY KEY, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, last_sign_in_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean, phone text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), banned_until timestamptz,
  deleted_at timestamptz, is_anonymous boolean NOT NULL DEFAULT false
);
GRANT SELECT ON auth.users TO service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, owner uuid, owner_id text, public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, user_metadata jsonb, version text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT reverse(split_part(reverse(name), '.', 1)) $$;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon, authenticated, service_role;

-- pg_cron stand-in (DDL only; nothing is scheduled or run)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, jobname text UNIQUE, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
     ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
  $$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS
  $$ WITH d AS (DELETE FROM cron.job WHERE jobid = job_id RETURNING 1) SELECT count(*) > 0 FROM d $$;

-- pg_net stand-in (records nothing, sends nothing)
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE FUNCTION extensions.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;

-- Vault stand-in
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '') RETURNS uuid
  LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, secret, description) VALUES (new_name, new_secret, new_description) RETURNING id $$;

CREATE PUBLICATION supabase_realtime;
`;

/** Production data fixes that assert specific rows exist; they have no schema effect on an empty DB. */
const DATA_ONLY_MIGRATIONS = new Set([
  "20260817160000_reset_highland_springs_package_review.sql",
]);

/**
 * Statements run in their own transaction before a file. The super_admin migration adds an enum value
 * and uses it in the same file, which Postgres rejects when the file runs as one transaction.
 */
const PRE_FILE = {
  "20260911200000_super_admin_hierarchy.sql": "ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';",
};

/** Extensions handled by the baseline or PGlite plugins are removed from migration text. */
function preprocess(sql) {
  return sql
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+(pg_cron|pg_net|pgcrypto)[^;]*;/gi, "-- [replay] extension $1 provided by baseline")
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector\b[^;]*;/gi, "CREATE EXTENSION IF NOT EXISTS vector;");
}

async function replay({ upto = null, exclude = [], extra = [] } = {}) {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(PLATFORM_BASELINE);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied = [];
  const skipped = [];
  for (const f of files) {
    if (DATA_ONLY_MIGRATIONS.has(f) || exclude.includes(f)) {
      skipped.push(f);
      continue;
    }
    const sql = preprocess(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    try {
      if (PRE_FILE[f]) await db.exec(PRE_FILE[f]);
      await db.exec(sql);
    } catch (e) {
      const err = new Error(`${f}: ${e.message}`);
      err.file = f;
      err.applied = applied;
      throw err;
    }
    applied.push(f);
    if (upto && f === upto) break;
  }
  for (const sql of extra) await db.exec(sql);
  return { db, applied, skipped };
}

module.exports = { replay, preprocess, MIGRATIONS_DIR, DATA_ONLY_MIGRATIONS, PLATFORM_BASELINE, PRE_FILE };

if (require.main === module) {
  const i = process.argv.indexOf("--upto");
  replay({ upto: i > 0 ? process.argv[i + 1] : null })
    .then(({ applied, skipped }) =>
      console.log(`applied ${applied.length} migrations (skipped data-only: ${skipped.join(", ") || "none"}); last ${applied[applied.length - 1]}`))
    .catch((e) => {
      console.error(`FAILED after ${e.applied ? e.applied.length : "?"} migrations\n${e.message}`);
      process.exit(1);
    });
}
