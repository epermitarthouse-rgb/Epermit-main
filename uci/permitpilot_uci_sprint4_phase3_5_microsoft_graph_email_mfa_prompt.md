# PermitPilot UCI Sprint 4 — Phase 3.5: Microsoft Graph Email MFA Automation for PEPCO

Phase 2 and Phase 3 are verified:
- PEPCO login opens through Playwright.
- Username/password are filled successfully.
- MFA/email-code screen is detected.
- Phase 3 keeps the browser session alive and supports manual resume.
- UI/manual resume can confirm `dashboard_ready`.

Now implement **Phase 3.5 only**.

## Goal

Automate the PEPCO email verification-code step using Microsoft Graph for the client mailbox:

```txt
Permitting@commun-et.com
```

The automation should:
1. Open PEPCO login.
2. Fill username/password.
3. Select/click the email-code MFA option if needed.
4. Poll Microsoft Graph inbox for the latest PEPCO/Exelon verification email.
5. Extract the verification code.
6. Enter the code into the PEPCO MFA screen.
7. Submit/verify the code.
8. Confirm PEPCO dashboard is reached.
9. Fall back to the existing manual MFA resume flow if email automation fails.

Do **not** scrape dashboard cards yet.  
Do **not** scrape overview/status/documents yet.  
Do **not** download files yet.

---

## Microsoft Entra setup already completed

A Microsoft Entra app registration was created:

```txt
PermitPilot Mailbox Connector
```

Redirect URIs added:

```txt
Local:
http://localhost:3001/api/microsoft/oauth/callback

Production:
https://epermit-main-production.up.railway.app/api/microsoft/oauth/callback
```

Microsoft Graph delegated permissions added:

```txt
email
Mail.Read
offline_access
openid
profile
User.Read
```

Mailbox target:

```txt
Permitting@commun-et.com
```

---

## Required environment variables

Use these env vars:

```env
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
MS_GRAPH_TENANT_ID=
MS_GRAPH_REDIRECT_URI=http://localhost:3001/api/microsoft/oauth/callback
MS_GRAPH_TOKEN_ENCRYPTION_KEY=
```

Production Railway should use:

```env
MS_GRAPH_REDIRECT_URI=https://epermit-main-production.up.railway.app/api/microsoft/oauth/callback
```

Keep existing portal credential env:

```env
PORTAL_CREDENTIALS_ENCRYPTION_KEY=
```

Generate `MS_GRAPH_TOKEN_ENCRYPTION_KEY` locally if missing:

```bash
openssl rand -hex 32
```

Do not reuse `QB_TOKEN_ENCRYPTION_KEY`.  
Do not store Microsoft tokens unencrypted.

---

## Phase 3.5 scope

### In scope

- Microsoft Graph OAuth connect flow.
- Store encrypted Microsoft Graph refresh/access token data.
- Validate mailbox connection.
- Read recent inbox messages via Graph.
- Poll mailbox for PEPCO/Exelon MFA code.
- Extract numeric code from email body/subject.
- Auto-click PEPCO email-code option where possible.
- Auto-enter code into PEPCO MFA form.
- Submit verification.
- Confirm dashboard-ready state.
- Keep existing manual fallback.

### Out of scope

- PEPCO dashboard scraping.
- Project card scraping.
- Overview/status/documents scraping.
- Document downloads.
- Uploads/submissions/messages/account changes.
- Multi-mailbox admin UX beyond the single configured mailbox.

---

## Recommended database storage

Inspect current repo first. If no suitable table exists, add a small migration for Microsoft mailbox connection storage.

Recommended table:

```sql
create table if not exists microsoft_mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mailbox_email text not null,
  tenant_id text not null,
  client_id text not null,
  encrypted_token_json text not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected',
  last_connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Add RLS if the project convention requires it. If backend uses service-role only and existing patterns avoid RLS for scraper tables, follow existing repo convention.

Token JSON may include:
- refresh token
- access token
- expiry
- scope
- token type

It must be encrypted using `MS_GRAPH_TOKEN_ENCRYPTION_KEY`.

Never log token JSON.

---

## Backend files to add

### 1. Microsoft Graph crypto helper

Create if needed:

```txt
scraper-service/app/services/microsoft/microsoft-token-crypto.js
```

Responsibilities:
- Encrypt token JSON.
- Decrypt token JSON.
- Use `MS_GRAPH_TOKEN_ENCRYPTION_KEY`.
- Fail clearly if key is missing.

Follow existing portal credential crypto style if available.

---

### 2. Microsoft Graph OAuth service

Create:

```txt
scraper-service/app/services/microsoft/microsoft-graph-auth.service.js
```

Responsibilities:
- Build Microsoft OAuth authorization URL.
- Exchange auth code for tokens.
- Refresh access token using refresh token.
- Encrypt/store token JSON.
- Load/decrypt current token.
- Return valid access token, refreshing if expired/near expiry.

OAuth scopes:

```txt
openid profile offline_access User.Read Mail.Read email
```

Authorize URL base:

```txt
https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize
```

Token URL:

```txt
https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
```

Use authorization-code flow.

---

### 3. Microsoft Graph mailbox service

Create:

```txt
scraper-service/app/services/microsoft/microsoft-mailbox.service.js
```

Responsibilities:
- Use Graph access token.
- Fetch recent messages from signed-in mailbox.
- Search/filter likely PEPCO/Exelon MFA messages.
- Extract verification code.
- Poll for new code with timeout.

Graph endpoint examples:

```txt
GET https://graph.microsoft.com/v1.0/me/messages?$top=10&$orderby=receivedDateTime desc
```

Prefer recent emails only. Do not scan huge mailbox history.

Recommended polling:
- timeout: 60–90 seconds
- interval: 3–5 seconds
- filter by receivedDateTime after MFA request start time

Search signals:
- sender/from contains `exelon`, `pepco`, `microsoftonline`, `no-reply`, or similar
- subject/body contains:
  - `verification code`
  - `security code`
  - `code`
  - `PEPCO`
  - `Exelon`
  - `sign in`

Code extraction:
- Prefer 6-digit code
- Support 4–8 digit code as fallback
- Avoid picking dates/times/job IDs if possible
- Return confidence metadata internally, but do not expose email content in UI/logs

Return shape:

```js
{
  status: "found",
  code: "123456",
  messageId,
  receivedDateTime
}
```

or:

```js
{
  status: "not_found",
  reason: "timeout"
}
```

Never log email body or code by default. For debug, log only message id/date/subject prefix if necessary.

---

## Backend routes to add

Create a Microsoft routes file if not existing:

```txt
scraper-service/app/routes/microsoft.routes.js
```

Mount it from the same server/router registration pattern used by existing app routes.

### Route 1 — Start OAuth

```txt
GET /api/microsoft/oauth/start
```

Query/body optional:
- `mailbox_email=Permitting@commun-et.com`

Behavior:
- Build Microsoft authorize URL.
- Redirect browser to Microsoft login/consent.

### Route 2 — OAuth callback

```txt
GET /api/microsoft/oauth/callback
```

Behavior:
- Receive `code`.
- Exchange for tokens.
- Fetch `/me` from Graph to identify mailbox.
- Store encrypted tokens.
- Return a simple success page or redirect to settings.

Success response can be plain HTML:

```html
Microsoft mailbox connected. You can close this tab.
```

### Route 3 — Status

```txt
GET /api/microsoft/mailbox/status
```

Behavior:
- Require authenticated PermitPilot user if following frontend auth pattern, or use existing backend auth convention.
- Return:
```json
{
  "connected": true,
  "mailbox_email": "Permitting@commun-et.com",
  "last_connected_at": "...",
  "last_checked_at": "..."
}
```

### Route 4 — Test inbox read

```txt
POST /api/microsoft/mailbox/test-read
```

Behavior:
- Require auth.
- Fetch top 3 recent messages metadata only.
- Return safe metadata:
```json
{
  "status": "ok",
  "messages_checked": 3
}
```

Do not return full subject/body unless development-only and explicitly gated.

---

## PEPCO login flow changes

Modify:

```txt
scraper-service/scrapers/pepco/login-flow.js
```

Add optional mode:

```js
autoMfaEmailCode: true
```

or accept an injected callback:

```js
fetchEmailCode: async ({ requestedAt }) => "123456"
```

Recommended design:
- Keep PEPCO-specific browser logic in `login-flow.js`.
- Keep Microsoft Graph mailbox logic outside it.
- Inject `fetchEmailCode()` from the UCI PEPCO discovery service.

When MFA is reached:
1. Detect if an email-code option/button must be clicked.
2. Click “Email”, “Send code”, “Send verification code”, or similar option.
3. Record `requestedAt = new Date()`.
4. Call `fetchEmailCode({ requestedAt })`.
5. If code found:
   - Fill code input.
   - Click Verify/Continue.
   - Wait for dashboard route.
   - Return:
```js
{
  status: "completed",
  checkpoint: "dashboard_ready",
  currentUrl
}
```
6. If code not found or fails:
   - Return existing:
```js
{
  status: "human_required",
  reason: "mfa_email_code",
  message: "Could not fetch PEPCO MFA code automatically. Complete MFA manually, then click Resume.",
  currentUrl
}
```

Important:
- Do not remove manual fallback.
- Do not hard-fail if email-code automation fails.
- Do not log the code.

---

## UCI PEPCO discovery service changes

Modify:

```txt
scraper-service/app/services/uci/uci-pepco-discovery.service.js
```

Add option:

```js
auto_email_mfa: true
```

Default behavior:
- For local/dev testing, allow request body:
```json
{
  "headed": true,
  "auto_email_mfa": true
}
```

For UI:
- Add checkbox/toggle or default enabled if Microsoft mailbox is connected:
```txt
Auto-fetch email MFA code
```

Flow:
- If `auto_email_mfa` true and Microsoft mailbox connected:
  - Pass `fetchEmailCode` callback into PEPCO login flow.
  - If completed, no manual session needed.
  - If not found, fall back to Phase 3 `human_required + session_id`.
- If mailbox not connected:
  - Return manual `human_required + session_id` as Phase 3 already does.

Metadata additions:
```json
{
  "pepco_mfa_mode": "email_auto" | "manual",
  "pepco_mfa_auto_status": "code_found" | "timeout" | "not_connected" | "failed",
  "pepco_discovery_last_status": "completed" | "human_required" | "failed"
}
```

No email content or code in metadata.

---

## Frontend changes

### Settings UI

Add minimal mailbox connector UI in settings or UCI page.

Recommended place:

```txt
src/components/settings/...
```

or current settings page where portal credentials are managed.

Show:
- Mailbox connection status.
- Button: `Connect Microsoft Mailbox`
- Button: `Test Mailbox Read`

Clicking connect opens:

```txt
/api/microsoft/oauth/start
```

### UCI UI

In:

```txt
src/pages/UciDashboard.tsx
```

For PEPCO login check:
- If mailbox connected, offer:
```txt
Auto-fetch email MFA code
```
- Default checked if connected.
- On Run PEPCO Login Check, send:
```json
{
  "headed": true,
  "auto_email_mfa": true
}
```

UI outcomes:
- If `completed`: show “PEPCO dashboard reached.”
- If `human_required`: show existing manual MFA instructions and Resume button.
- If `failed`: show safe failure message.

---

## Testing checklist

### Microsoft OAuth setup

1. Backend env has:
```env
MS_GRAPH_CLIENT_ID
MS_GRAPH_CLIENT_SECRET
MS_GRAPH_TENANT_ID
MS_GRAPH_REDIRECT_URI
MS_GRAPH_TOKEN_ENCRYPTION_KEY
```

2. Start backend:
```bash
cd scraper-service
export $(grep -v '^#' .env | xargs)
npm start
```

3. Open:
```txt
http://localhost:3001/api/microsoft/oauth/start
```

4. Sign in as:
```txt
Permitting@commun-et.com
```

5. Consent if prompted.

6. Callback returns:
```txt
Microsoft mailbox connected. You can close this tab.
```

7. Status endpoint returns connected.

### Mailbox test

```bash
curl -sS -X POST "$BASE/api/microsoft/mailbox/test-read" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected:
```json
{
  "status": "ok",
  "messages_checked": 3
}
```

### PEPCO auto MFA test

```bash
curl -sS -X POST "$BASE/api/uci/coordination/$COORD/discovery/pepco" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"headed":true,"auto_email_mfa":true}' | jq
```

Expected best case:
```json
{
  "status": "completed",
  "checkpoint": "dashboard_ready"
}
```

Fallback acceptable:
```json
{
  "status": "human_required",
  "reason": "mfa_email_code",
  "session_id": "pepco_..."
}
```

### Metadata check

```sql
select
  id,
  last_error,
  metadata ->> 'pepco_discovery_last_status' as last_status,
  metadata ->> 'pepco_discovery_session_status' as session_status,
  metadata ->> 'pepco_mfa_mode' as mfa_mode,
  metadata ->> 'pepco_mfa_auto_status' as mfa_auto_status
from coordination_records
where id = '<coordination_id>';
```

Expected if auto MFA succeeds:
```txt
last_status = completed
session_status = completed or idle
mfa_mode = email_auto
mfa_auto_status = code_found
last_error = null
```

---

## Safety and security constraints

- Do not log Microsoft access tokens.
- Do not log Microsoft refresh tokens.
- Do not log PEPCO password.
- Do not log MFA code by default.
- Do not store MFA code in DB.
- Do not store email body in DB.
- Do not expose mailbox email content to frontend.
- Encrypt all Microsoft token data using `MS_GRAPH_TOKEN_ENCRYPTION_KEY`.
- Keep manual fallback if automatic email fetch fails.
- Do not automate PEPCO write actions beyond login/MFA verification.

---

## Output required

When done, report:

1. Files created.
2. Files modified.
3. Migration added, if any.
4. Microsoft OAuth endpoints added.
5. Microsoft mailbox status/test endpoints added.
6. PEPCO discovery behavior changes.
7. Exact response examples.
8. How to test locally.
9. Railway env vars needed.
10. Any blockers.
11. Confirmation that no dashboard/project/document scraping was added.
