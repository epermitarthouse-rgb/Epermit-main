# Deploy and Verify Agent Pipeline Edge Functions

## 1. Install Supabase CLI (if needed)

```bash
# macOS / Homebrew
brew install supabase/tap/supabase

# Or npm
npm install -g supabase
```

Verify:

```bash
supabase --version
```

## 2. Link project (if not already linked)

From the project root:

```bash
cd /path/to/Epermit-main
supabase link --project-ref eeqxyjrcldivtpikcpvk
```

Use the project ref from `supabase/config.toml` (`project_id`). When prompted, enter your Supabase database password if required.

## 3. Deploy all three functions

```bash
supabase functions deploy intake-pipeline-agent
supabase functions deploy comment-parser-agent
supabase functions deploy discipline-classifier-agent
```

## 4. Verify functions exist

```bash
supabase functions list
```

Confirm `intake-pipeline-agent`, `comment-parser-agent`, and `discipline-classifier-agent` appear in the list. You can also check **Supabase Dashboard → Edge Functions**.

## 5. Set required secrets

Edge functions need these at runtime (some are set automatically by Supabase; add any that are missing):

```bash
# Required for comment-parser-agent and discipline-classifier-agent
supabase secrets set OPENAI_API_KEY=your_openai_api_key

# Usually set automatically; set only if your function logs show they're missing
supabase secrets set SUPABASE_URL=https://eeqxyjrcldivtpikcpvk.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

To list current secrets (names only):

```bash
supabase secrets list
```

## 6. Test intake-pipeline-agent

### Option A: Browser console (easiest when logged in)

1. Log in to the app.
2. Open DevTools → Console.
3. Get a project ID that has `portal_data` (e.g. from Settings → Portal Credentials, or from the sidebar project selector).
4. Run:

```javascript
const projectId = "YOUR_PROJECT_UUID_HERE";
const { data, error } = await supabase.functions.invoke("intake-pipeline-agent", {
  body: { project_id: projectId },
});
console.log("Pipeline result:", data, error);
const { data: rows, error: e2 } = await supabase.from("parsed_comments").select("id, original_text, discipline").eq("project_id", projectId);
console.log("parsed_comments count:", rows?.length ?? 0, e2);
```

### Option B: Node test script

```bash
export SUPABASE_TEST_EMAIL=your@email.com
export SUPABASE_TEST_PASSWORD=your_password
node scripts/test-intake-pipeline.js YOUR_PROJECT_UUID
```

## 7. Confirm success

- **Deployment:** `supabase functions list` shows all three functions.
- **Execution:** No error from `supabase.functions.invoke("intake-pipeline-agent", …)` and `data` contains `comment_parser` and `discipline_classifier`.
- **Data:** `parsed_comments` has rows for the given `project_id` (after a run that had report PDFs in `portal_data.tabs.reports.pdfs`).

## Logging

`intake-pipeline-agent` logs `Pipeline started for project: <id>`. View logs in Supabase Dashboard → Edge Functions → select the function → Logs, or run:

```bash
supabase functions logs intake-pipeline-agent
```
