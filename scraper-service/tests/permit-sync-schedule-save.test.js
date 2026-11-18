"use strict";

/**
 * D-125/D-126: the Management Admin schedule save, replayed as PostgREST runs it (named arguments, the exact
 * body the UI sends; 3f942f1 and 8a09947 send the same one). On the chain before 20261118140000 (production's
 * function bodies, md5-checked in permit-repo-chain.test.js) and after it. Reproduces the two production saves of
 * de8592f9: 2026-11-17 09:50 (switch off) and 2026-11-18 06:19 (switch on, max attempts 5).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { replay } = require("./helpers/replay-migrations");

const READBACK = "20261118140000_permit_sync_schedule_readback.sql";
const ADMIN = "60000000-0000-4000-8000-000000000001";
const OWNER = "60000000-0000-4000-8000-000000000002";
const CRED = "60000000-0000-4000-8000-0000000000c1";
const DUP = "60000000-0000-4000-8000-0000000000c2";
const ENVELOPE = '{"pc_v":"1","iv":"aXY=","at":"YXQ=","ct":"Y3Q="}';
const SCHEDULE = { frequency: "daily", time: "04:00", timezone: "America/New_York" };

async function setup(exclude) {
  const { db } = await replay({ exclude });
  for (const id of [ADMIN, OWNER]) await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, `${id.slice(-1)}@test.invalid`]);
  await db.query(`INSERT INTO public.profiles (user_id) VALUES ($1), ($2) ON CONFLICT (user_id) DO NOTHING`, [ADMIN, OWNER]);
  await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  // As on 2026-11-17 09:50: the duplicate 0610eaa5 (same login, paused, automation off) still existed.
  await db.query(`INSERT INTO public.portal_credentials (id, user_id, jurisdiction, portal_username, portal_password, permit_number) VALUES ($1, $3, 'Washington DC - ProjectDox', 'Acct@Example.test', $4, 'B1'), ($2, $3, 'Washington DC - ProjectDox', 'acct@example.test ', $4, 'B2')`, [CRED, DUP, OWNER, ENVELOPE]);
  const admin = (sql, params = []) => db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
    await tx.exec(`SET LOCAL ROLE authenticated`);
    return (await tx.query(sql, params)).rows;
  });
  for (const c of [CRED, DUP]) await admin(`SELECT admin_set_permit_sync_source($1, 'dc-projectdox', false, '{}'::jsonb)`, [c]);
  await db.query(`UPDATE public.permit_sync_sources SET status = 'paused' WHERE credential_id = $1`, [DUP]);
  await db.query(`DELETE FROM public.platform_audit_events`);
  // The PostgREST call for supabase.rpc('admin_set_permit_sync_schedule', body) with the UI's body (centralPermits.ts).
  const save = async (body) => (await admin(
    `SELECT public.admin_set_permit_sync_schedule(p_credential_id => $1, p_enabled => $2, p_schedule => $3::jsonb, p_deep_defaults => $4::jsonb, p_max_attempts => $5) AS r`,
    [body.p_credential_id, body.p_enabled, JSON.stringify(body.p_schedule), body.p_deep_defaults === null ? null : JSON.stringify(body.p_deep_defaults), body.p_max_attempts],
  ))[0].r;
  const stored = async () => (await db.query(`SELECT automation_enabled, status, schedule_enabled_at, settings FROM public.permit_sync_sources WHERE credential_id = $1`, [CRED])).rows[0];
  const audit = async () => (await db.query(`SELECT action, (after_json ->> 'automation_enabled')::boolean AS enabled FROM public.platform_audit_events ORDER BY action`)).rows;
  return { db, save, stored, audit };
}

const uiBody = (enabled, maxAttempts = null) => ({ p_credential_id: CRED, p_enabled: enabled, p_schedule: SCHEDULE, p_deep_defaults: null, p_max_attempts: maxAttempts });

for (const [label, exclude] of [["before the read-back (production today)", [READBACK]], ["after the read-back", []]]) {
  test(`${label}: one overload, p_enabled has no default; the saves store exactly what the switch sent`, async () => {
    const { db, save, stored, audit } = await setup(exclude);
    const procs = (await db.query(`SELECT p.proname, pg_get_function_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('admin_set_permit_sync_schedule', 'admin_set_permit_sync_source') ORDER BY 1`)).rows;
    assert.deepEqual(procs.map((p) => p.proname), ["admin_set_permit_sync_schedule", "admin_set_permit_sync_source"], "no second overload PostgREST could pick");
    assert.match(procs[0].args, /^p_credential_id uuid, p_enabled boolean, p_schedule jsonb DEFAULT/, "p_enabled is required and named as the UI sends it");

    // 2026-11-17 09:50:10 UTC, switch off.
    const off = await save(uiBody(false));
    assert.equal(off.automation_enabled, false, "the UI toast for this result is 'Schedule saved (disabled)'");
    assert.equal(off.next_run_at, null);
    let s = await stored();
    assert.deepEqual([s.automation_enabled, s.status, s.schedule_enabled_at], [false, "inactive", null]);
    assert.deepEqual(s.settings.schedule, SCHEDULE);
    assert.deepEqual(await audit(), [{ action: "permit_sync_source.schedule", enabled: false }, { action: "permit_sync_source.set", enabled: false }], "the two production audit rows");

    // 2026-11-18 06:19:31 UTC, switch on; the paused duplicate on the same login does not block it.
    const on = await save(uiBody(true, 5));
    assert.equal(on.automation_enabled, true);
    s = await stored();
    assert.deepEqual([s.automation_enabled, s.status, s.settings.max_attempts], [true, "active", 5]);
    assert.ok(s.schedule_enabled_at);
    assert.equal(on.automation_enabled, s.automation_enabled, "the toast state equals the stored state");
    const next = new Date(on.next_run_at);
    assert.ok(next > new Date() && next - new Date() <= 25 * 3600 * 1000, "next 04:00 America/New_York");
    assert.equal(new Date(next).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }), "04:00");
    assert.equal((await audit()).filter((a) => a.enabled).length, 2);
  });
}

test("before the read-back the RPC echoes p_enabled, so a stored downgrade would still be reported as enabled", async () => {
  const { db, save, stored } = await setup([READBACK]);
  await db.exec(`CREATE FUNCTION public._test_force_off() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.automation_enabled := false; NEW.status := 'inactive'; RETURN NEW; END $$;
    CREATE TRIGGER _test_force_off BEFORE UPDATE ON public.permit_sync_sources FOR EACH ROW EXECUTE FUNCTION public._test_force_off();`);
  const r = await save(uiBody(true));
  assert.equal(r.automation_enabled, true, "echo of the request");
  assert.equal((await stored()).automation_enabled, false, "while the row says disabled");
});

test("after the read-back the RPC returns the stored row and refuses a save that is not stored as requested", async () => {
  const { db, save, stored, audit } = await setup([]);
  const on = await save(uiBody(true));
  const s = await stored();
  assert.deepEqual([on.automation_enabled, on.status, on.schedule], [true, "active", SCHEDULE]);
  assert.equal(new Date(on.schedule_enabled_at).getTime(), new Date(s.schedule_enabled_at).getTime());
  const off = await save(uiBody(false));
  assert.deepEqual([off.automation_enabled, off.status, off.schedule_enabled_at, off.next_run_at], [false, "inactive", null, null]);

  await db.query(`DELETE FROM public.platform_audit_events`);
  await db.exec(`CREATE FUNCTION public._test_force_off() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.automation_enabled := false; NEW.status := 'inactive'; RETURN NEW; END $$;
    CREATE TRIGGER _test_force_off BEFORE UPDATE ON public.permit_sync_sources FOR EACH ROW EXECUTE FUNCTION public._test_force_off();`);
  await assert.rejects(save(uiBody(true)), /schedule not saved: requested enabled=true, stored enabled=false status=inactive/);
  assert.deepEqual(await audit(), [], "rolled back: no audit row");
  await db.exec(`DROP TRIGGER _test_force_off ON public.permit_sync_sources`);
  await db.exec(`CREATE FUNCTION public._test_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.status := 'paused'; RETURN NEW; END $$;
    CREATE TRIGGER _test_status BEFORE UPDATE ON public.permit_sync_sources FOR EACH ROW EXECUTE FUNCTION public._test_status();`);
  await assert.rejects(save(uiBody(true)), /stored enabled=true status=paused/, "enabled but not 'active' would never be enqueued");
  await assert.rejects(save({ ...uiBody(true), p_enabled: null }), /p_enabled is required/);
});
