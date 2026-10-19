---
name: epermit-supabase
description: Use for Epermit Supabase schema, individually reviewed migrations, Auth, RLS, tenant permissions, and read-only hosted verification.
---

# epermit-supabase

## Shared operating rules (confirmed with Epermit owner, 2026-10-19)
- Source of truth: `epermitarthouse-rgb/Epermit-main` ONLY. Never consult, use, or merge facts from `D71404/Epermit`.
- Begin with `docs/context-handoff/12-MASTER-CONTEXT-INDEX.md`, then relevant handoff chapters and current code. Read `11-CONTEXT-GAPS.md` before making production claims. The handoff represents `main` at `fc74c35`; re-check newer code.
- Production is the default **environment context** unless the user explicitly selects development. Production default is NOT authorization to make a live change. A commit, push, merge, migration application, API send, Railway deployment, Vercel-triggering push, or production write must each be authorized by the user's requested task.
- Supabase project is `eeqxyjrcldivtpikcpvk`. NEVER execute `supabase db push` to replay the migration backlog. Only apply a single individually reviewed, explicitly approved migration after read-only hosted checks. Existing older migrations and seven DO NOT APPLY files are not to be auto-applied.
- GitHub is the code remote. Railway does NOT automatically pick up GitHub changes; the owner deploys the selected Railway service DIRECTLY. Vercel is GitHub-connected and can automatically release frontend commits on its configured production branch. Keep GitHub push, direct Railway deploy, migration application, and merge separate operations.
- Do not follow the old always-apply Cursor rule's blanket `railway up` on push. Task- and service-specific deploy approval takes precedence. Never force a Lovable visual change onto production.
- Code Analyzer V2 is active work; the Vercel `VITE_CODE_ANALYZER_ASYNC_V2` flag is not yet confirmed. No V1 browser fallback, no passing sheets without on-sheet evidence, no V2 rollback by default.
- The older ingestion-worker deployment is accepted. Do not rebuild/deploy just because its image predates `main`.
- Never expose .env contents, API secrets, service-role keys, OAuth tokens, passwords, customer documents or sensitive logs. Refer to variable NAMES, not secret values.
- A function with `verify_jwt = false` needs independent caller authentication or a legitimate alternative such as a validated webhook signature; do not blanket-enable JWT.
- Read-only diagnosis before change. Distinguish VERIFIED, HISTORICAL, INFERRED and UNKNOWN. Report affected components, validation, and approval needed.

## Procedure sourced from the reviewed handoff

### S3: Supabase migrations

**Purpose:** Change schema without destroying hosted data or applying files marked do-not-apply.

**Activate when:** Any task touches `supabase/migrations/` or claims a column is missing.

**Required context:** [04-DATABASE-AND-SUPABASE.md](./04-DATABASE-AND-SUPABASE.md).

**Procedure:**

1. Search migrations for the table and column before adding one.
2. Remember `projects.portal_data` and `profiles.subscription_*` may exist only in production.
3. Read headers of the seven do-not-apply files before `supabase db push`.
4. New project-scoped tables use the current `has_project_access` helpers, not a copied January 2026 owner-only policy, unless the task is specifically to narrow access.
5. RLS on by default. Service-role-only tables (OAuth tokens) get no anon policies.
6. Do not apply against the hosted project unless the user asked.

**Verify:** Migration is additive (`IF NOT EXISTS` where that matches local style). A one-line note of what a rollback would be (usually forward-fix, not a down migration). Types regeneration called out if columns changed.

**Prohibited:** `supabase db reset` on the hosted project. Editing applied migration files that are already on `main`. Putting seed passwords or keys in SQL.

---

---

### S4: Auth and RLS

**Purpose:** Keep team, tenant, and admin rules intact.

**Activate when:** Policies, `has_project_*`, invites, `user_roles`, `access_status`, credential grants, or admin RPCs change.

**Required context:** [04](./04-DATABASE-AND-SUPABASE.md) access-control section. `docs/admin-dashboard/ADMIN_ROLE_AND_PERMISSION_MATRIX.md` for intended admin behavior.

**Procedure:**

1. State who can read and write before and after the change: owner, team editor, team admin, platform admin, super admin, deactivated user, demo tenant, service role.
2. Respect `is_user_active`, `can_access_tenant`, and the default-write override model.
3. Invitation tokens stay hashed (`token_hash`). Do not return raw tokens from list APIs.
4. Frontend `useRequireAdmin` is not sufficient. The table or RPC must enforce the same rule.

**Verify:** A deactivated user and a user without the role cannot perform the new operation. Demo tenant cannot read production tenant rows.

**Prohibited:** Disabling RLS to “make the UI work.” Granting `anon` execute on admin RPCs. Logging portal passwords.

---

## Individual migration workflow — overrides older guidance
1. Identify intended change and inspect current hosted object/schema in read-only mode.
2. Compare exact applicable migration(s) and their dependencies with live state. Never equate missing old migrations with a mandate to run them.
3. Draft ONE targeted migration with RLS/access review and forward-fix/rollback plan.
4. Show its SQL and impact for approval; apply ONLY that approved file through a suitable individual migration mechanism. Never `supabase db push`, `db reset`, or run unapproved "DO NOT APPLY" migrations.
5. Verify schema and access afterward only if execution was explicitly requested.

## Completion checklist
State files touched, evidence checked, tests run and results, production/security impact, exact deployment target if any, and anything not verified. Never imply a write/deploy occurred unless actually executed and confirmed.
