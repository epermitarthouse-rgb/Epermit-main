#!/usr/bin/env node
"use strict";

/**
 * Verify project document upload RLS for owner vs tenant member.
 * Usage: node scraper-service/scripts/verify-project-document-upload-rls.js
 *
 * Requires scraper-service/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * and root .env (VITE_SUPABASE_ANON_KEY).
 */

require("dotenv").config();
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const { createClient } = require("@supabase/supabase-js");

const PROJECT_ID = process.env.VERIFY_PROJECT_ID || "13dbc43e-860f-435d-a8af-27dfe34f2322";
const OWNER_ID = process.env.VERIFY_OWNER_ID || "f1f84c83-36f6-4664-b34b-614b2881f09d";
const MEMBER_ID = process.env.VERIFY_MEMBER_ID || "3d2b4632-e3a3-4417-8a84-549cedbb6739";

async function sessionForUser(admin, anon, userId) {
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr) throw userErr;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (linkErr) throw linkErr;

  const bootstrap = createClient(process.env.SUPABASE_URL, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verifyData, error: verifyErr } = await bootstrap.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyErr) throw verifyErr;

  return createClient(process.env.SUPABASE_URL, anon, {
    global: { headers: { Authorization: `Bearer ${verifyData.session.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function attemptUpload(admin, client, userId, label) {
  const testPath = `${userId}/${PROJECT_ID}/rls-verify-${Date.now()}.pdf`;
  const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

  const { error: storageErr } = await client.storage.from("project-documents").upload(testPath, pdfBytes, {
    contentType: "application/pdf",
    upsert: false,
  });

  const { data: inserted, error: insertErr } = await client.from("project_documents").insert({
    project_id: PROJECT_ID,
    user_id: userId,
    file_name: "rls-verify.pdf",
    file_path: testPath,
    file_size: pdfBytes.length,
    file_type: "application/pdf",
    document_type: "other",
    version: 1,
  }).select("id").single();

  const result = {
    label,
    can_view_project: null,
    storage_ok: !storageErr,
    storage_error: storageErr?.message || null,
    insert_ok: !insertErr,
    insert_error: insertErr?.message || null,
    document_id: inserted?.id || null,
  };

  const { data: proj } = await client.from("projects").select("id").eq("id", PROJECT_ID).maybeSingle();
  result.can_view_project = !!proj;

  if (inserted?.id) {
    await admin.from("project_documents").delete().eq("id", inserted.id);
  }
  if (!insertErr || !storageErr) {
    await admin.storage.from("project-documents").remove([testPath]);
  }

  const { count } = await admin
    .from("project_documents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", PROJECT_ID);

  result.project_document_count = count ?? 0;
  return result;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anon) {
    console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or VITE_SUPABASE_ANON_KEY");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ownerClient = await sessionForUser(admin, anon, OWNER_ID);
  const memberClient = await sessionForUser(admin, anon, MEMBER_ID);

  const owner = await attemptUpload(admin, ownerClient, OWNER_ID, "project_owner");
  const member = await attemptUpload(admin, memberClient, MEMBER_ID, "tenant_member");

  const ok =
    owner.insert_ok &&
    member.insert_ok &&
    owner.project_document_count === 0 &&
    member.project_document_count === 0;

  console.log(JSON.stringify({ ok, project_id: PROJECT_ID, owner, member }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
