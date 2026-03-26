/**
 * Test script for intake-pipeline-agent.
 * Requires: Node with fetch (Node 18+) or run in browser console when logged in.
 *
 * Usage (Node):
 *   node scripts/test-intake-pipeline.js <project_id>
 *
 * Or from browser console (when logged in on the app):
 *   Copy the invokeAndCheck() body and replace PROJECT_ID with a valid project UUID.
 */

const SUPABASE_URL = "https://eeqxyjrcldivtpikcpvk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlcXh5anJjbGRpdnRwaWtjcHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NzM3ODAsImV4cCI6MjA4NDE0OTc4MH0.yPtoSOuQGB5UU-fLbcy1Lp8dNF2IHOeQas9kushTrV0";

async function getSession(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Sign in failed: " + t);
  }
  const data = await res.json();
  return data.access_token;
}

async function invokePipeline(projectId, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/intake-pipeline-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ project_id: projectId }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function getParsedCommentsCount(projectId, accessToken) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/parsed_comments?project_id=eq.${projectId}&select=id`,
    {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.log("Usage: node scripts/test-intake-pipeline.js <project_id>");
    console.log("Or set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD to sign in and get a token.");
    process.exit(1);
  }

  const email = process.env.SUPABASE_TEST_EMAIL;
  const password = process.env.SUPABASE_TEST_PASSWORD;
  if (!email || !password) {
    console.log("Set SUPABASE_TEST_EMAIL and SUPABASE_TEST_PASSWORD to run this script.");
    console.log("Alternatively, run in browser console when logged in:");
    console.log(`
  const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", { body: { project_id: "YOUR_PROJECT_ID" } });
  console.log("Result:", data, error);
  const { data: rows } = await supabase.from("parsed_comments").select("id").eq("project_id", "YOUR_PROJECT_ID");
  console.log("parsed_comments count:", rows?.length ?? 0);
`);
    process.exit(1);
  }

  console.log("Signing in...");
  const token = await getSession(email, password);
  console.log("Invoking intake-pipeline-agent for project:", projectId);
  const result = await invokePipeline(projectId, token);
  console.log("Response status:", result.status);
  console.log("Response data:", JSON.stringify(result.data, null, 2));
  if (!result.ok) {
    console.error("Pipeline call failed.");
    process.exit(1);
  }
  const count = await getParsedCommentsCount(projectId, token);
  console.log("parsed_comments count for project:", count);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
