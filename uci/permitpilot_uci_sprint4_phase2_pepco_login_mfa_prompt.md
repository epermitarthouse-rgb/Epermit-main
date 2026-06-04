# PermitPilot UCI Sprint 4 — Phase 2: PEPCO Login + MFA Detection Only

We completed Phase 1 repo alignment. Now implement **Phase 2 only**.

## Goal

Create the PEPCO discovery foundation that can:

1. Resolve the correct PEPCO portal credential for the current user.
2. Launch Playwright.
3. Navigate to the PEPCO/Exelon SIUP login URL.
4. Fill email/password.
5. Detect the MFA/email verification code screen.
6. Return a structured `human_required` response.
7. Stop safely.

Do **not** scrape dashboard cards yet.  
Do **not** scrape overview/status/documents yet.  
Do **not** download files yet.

---

## Phase 1 findings to follow

PEPCO should use a dedicated UCI discovery endpoint, not the existing `/api/login`, because current `detectPortalType()` does not recognize PEPCO and would return `unknown`.

Recommended endpoint:

```txt
POST /api/uci/coordination/:id/discovery/pepco
```

Recommended MFA response:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code",
  "message": "PEPCO email verification code required."
}
```

Use UCI route/service patterns already present in:

- `scraper-service/app/routes/uci.routes.js`
- `scraper-service/app/services/uci/*.service.js`
- `scraper-service/app/services/uci/uci-access.service.js`
- `scraper-service/app/routes/portal-credentials.routes.js`
- `scraper-service/app/services/portal-credentials/portal-credentials-crypto.js`

Reuse Playwright launch/session patterns from:

- `scraper-service/app/register-execution-routes.js`

Specifically reuse/align with:

- `launchChromiumForScraper`
- `browser.newContext({ acceptDownloads: true })`
- credential lookup/decrypt pattern from existing `/api/login`
- UCI auth/access checks using Bearer JWT and project access

---

## Files to add

### 1. Add PEPCO login flow module

Create:

```txt
scraper-service/scrapers/pepco/login-flow.js
```

Purpose:

- Export a function like `runPepcoLoginFlow({ loginUrl, username, password, headed, logger })`
- Launch/navigate logic may be handled outside if better aligned with existing code, but keep PEPCO-specific selector logic here.
- Detect:
  - login page
  - username/email field
  - password field
  - submit/sign-in button
  - MFA/email-code screen
  - dashboard-ready URL if login somehow completes without MFA

Expected return shapes:

```js
{
  status: "human_required",
  reason: "mfa_email_code",
  message: "PEPCO email verification code required.",
  currentUrl
}
```

```js
{
  status: "completed",
  checkpoint: "dashboard_ready",
  currentUrl
}
```

```js
{
  status: "failed",
  error_code: "LOGIN_FAILED",
  message,
  currentUrl
}
```

Use robust selector attempts, for example:

- `input[type="email"]`
- `input[name="signInName"]`
- `input[name="loginfmt"]`
- `input[type="password"]`
- buttons containing `Sign in`, `Continue`, `Next`, `Verify`, etc.

MFA detection should look for common signals:

- visible input for verification code
- text like `verification code`
- `code`
- `email`
- `send code`
- `verify`
- Azure B2C-style URLs/forms

Keep selectors defensive. Do not hard-fail immediately if one selector is missing; take screenshot/log stage if possible.

---

### 2. Add UCI PEPCO portal session service

Create:

```txt
scraper-service/app/services/uci/uci-pepco-discovery.service.js
```

Purpose:

- Given `{ supabase, user, coordinationId, credentialId }`
- Load coordination record
- Verify project access using existing UCI access pattern
- Resolve PEPCO credential
- Decrypt password
- Validate login URL
- Launch Playwright/browser/context/page
- Call PEPCO login flow
- Normalize response
- Patch `coordination_records.metadata` with last attempt status/timestamp
- Patch `coordination_records.last_error` on failed result only
- Never store password/code/secrets in metadata/logs

Credential resolution rules:

- If `credential_id` is provided in request body, use that credential after verifying it belongs to the authenticated user.
- If not provided, find a credential for the user with PEPCO mapping.
- Accept likely labels:
  - `PEPCO`
  - `Pepco`
  - `pepco`
  - possibly provider slug `pepco`
- If multiple matching credentials exist, return a clean 400 asking for `credential_id`.
- If none exist, return a clean 400 saying PEPCO credentials are missing.

Do not add migrations.

Use `coordination_records.metadata` for lightweight status:

```json
{
  "pepco_discovery_last_attempt_at": "...",
  "pepco_discovery_last_status": "human_required"
}
```

---

## Files to modify

### 3. Modify UCI routes

Modify:

```txt
scraper-service/app/routes/uci.routes.js
```

Add:

```txt
POST /coordination/:id/discovery/pepco
```

Behavior:

- Require authenticated user.
- Load coordination/project access same way existing coordination detail/transition endpoints do.
- Call `runPepcoDiscoveryLoginOnly(...)` or equivalent from the new service.
- Return HTTP 200 for normal outcome statuses:
  - `human_required`
  - `completed`
  - `failed`
- Use `sanitizeUciError` only for auth/access/config/server errors.

Do not break existing six UCI endpoints.

---

### 4. Extend frontend UCI API helper

Modify:

```txt
src/lib/uciApi.ts
```

Add function:

```ts
postPepcoDiscovery(coordinationId: string, body?: { credential_id?: string })
```

Return typed JSON.

---

### 5. Extend UCI types

Modify:

```txt
src/types/uci.ts
```

Add a discriminated union for:

```ts
type UciDiscoveryResponse =
  | { status: "human_required"; reason: string; message: string; currentUrl?: string; session_id?: string }
  | { status: "completed"; checkpoint?: string; currentUrl?: string; session_id?: string }
  | { status: "failed"; error_code?: string; message: string; currentUrl?: string };
```

---

### 6. Add minimal UI trigger

Modify:

```txt
src/pages/UciDashboard.tsx
```

Add a minimal PEPCO discovery action, preferably in the coordination detail drawer or row actions.

Behavior:

- Button label: `Run PEPCO Login Check`
- Disabled/loading while request is running.
- On `human_required`, show message clearly:
  - “PEPCO email verification code required. Complete MFA manually, then resume in the next phase.”
- On `completed`, show dashboard-ready checkpoint.
- On `failed`, show failure message.
- Keep UI minimal. No new dashboard scraping display yet.

---

## Safety constraints

Absolutely do not click or automate:

- Upload Document
- Submit
- Send Message
- Modify application
- Account settings
- Any destructive or write action inside PEPCO portal

This phase only logs in and stops at MFA/dashboard checkpoint.

---

## Testing checklist

After implementation, provide exact commands/checks for:

1. Backend starts successfully.
2. Frontend typecheck/build passes.
3. Existing `/api/uci/providers` still works.
4. New endpoint rejects unauthenticated request.
5. New endpoint returns clean error when PEPCO credential is missing.
6. New endpoint reaches PEPCO login and returns:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code"
}
```

7. `coordination_records.metadata` updates with last attempt status.
8. No secrets are logged or stored.

---

## Output required

When done, report:

1. Files created.
2. Files modified.
3. Exact endpoint added.
4. Exact response shapes.
5. How to test with curl.
6. Any blockers found.
7. Confirmation that no dashboard/document scraping was added in this phase.
