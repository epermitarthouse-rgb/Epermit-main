# PermitPilot UCI Sprint 4 — Phase 4.5: PEPCO Code Input Modal + Continue Discovery

We need to improve the manual MFA fallback UX.

Current issue:
- Phase 4 dashboard discovery can reach PEPCO MFA.
- Manual fallback currently expects the user to interact directly with the Playwright browser or use resume flow.
- This is confusing.

New desired flow:

```txt
User clicks Discover PEPCO Dashboard
→ backend opens PEPCO
→ backend fills username/password
→ backend selects/clicks Send Code by Email
→ PermitPilot UI shows modal/input asking user to enter PEPCO verification code
→ user enters code in PermitPilot
→ backend fills code into PEPCO browser
→ backend verifies/submits code
→ backend continues dashboard discovery
→ dashboard cards/application IDs are returned to UI
```

Implement **Phase 4.5 only**.

Do not add overview/status/documents scraping.  
Do not add document downloads.  
Do not automate PEPCO upload, submit, messages, account settings, or portal write actions beyond login/MFA verification.

---

## Goal

Add a code-input flow where the user enters the PEPCO MFA code inside PermitPilot, and backend submits it into the existing Playwright PEPCO browser session.

This should work even if Microsoft Graph auto-email MFA is not approved yet.

---

## Required backend behavior

### Existing discovery endpoint

Current endpoint:

```txt
POST /api/uci/coordination/:id/discovery/pepco/dashboard
```

When PEPCO reaches MFA and auto-email MFA is unavailable/fails:

Instead of asking user to complete MFA inside PEPCO browser, return:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code_input_required",
  "message": "Enter the PEPCO verification code sent to the mailbox.",
  "session_id": "pepco_...",
  "continue_action": "discover_dashboard",
  "capture_application_ids": true
}
```

Important:
- Browser/context/page must stay alive in the in-memory PEPCO session store.
- Session should remember the intended continuation action:
  - `continue_action: "discover_dashboard"`
  - `capture_application_ids: true | false`
- Do not close the browser while waiting for code input.

---

## New endpoint

Add:

```txt
POST /api/uci/coordination/:id/discovery/pepco/submit-code
```

Request body:

```json
{
  "session_id": "pepco_...",
  "code": "073099",
  "continue_action": "discover_dashboard",
  "capture_application_ids": true
}
```

Behavior:
1. Require Bearer auth.
2. Verify coordination row exists.
3. Verify same authenticated user and same coordination ID owns the session.
4. Validate code:
   - required
   - digits only
   - preferably 6 digits
   - allow 4–8 digits if PEPCO changes format
5. Fill the code into the PEPCO MFA form in the existing Playwright page.
6. Click Verify/Continue/Submit.
7. Wait for dashboard readiness.
8. If `continue_action === "discover_dashboard"`:
   - run Phase 4A dashboard card extraction
   - if `capture_application_ids === true`, run Phase 4B application ID capture
   - persist Phase 4C metadata
   - close browser/session after completion
9. Return dashboard discovery response.

Success response:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_application_ids_captured",
  "currentUrl": "https://secure.pepco.com/service-installation-upgrades-portal/dashboard",
  "cards_found": 3,
  "application_ids_found": 3,
  "cards": []
}
```

If code is wrong or PEPCO rejects it:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code_input_required",
  "message": "The PEPCO verification code was not accepted. Please check the latest code and try again.",
  "session_id": "pepco_..."
}
```

If session expired:

```json
{
  "status": "failed",
  "error_code": "SESSION_EXPIRED",
  "message": "PEPCO login session expired. Run discovery again."
}
```

---

## PEPCO login-flow changes

Modify:

```txt
scraper-service/scrapers/pepco/login-flow.js
```

Add/export helper:

```js
async function submitPepcoMfaCode(page, code, { logger } = {})
```

Responsibilities:
- Locate MFA/code input.
- Fill code.
- Click Verify/Continue/Submit.
- Wait for dashboard or error.
- Return:
  - `completed` if dashboard reached
  - `human_required` if still MFA/code rejected
  - `failed` if unknown state

Selector ideas:
- code input:
  - `input[type="text"]`
  - `input[name*="code" i]`
  - `input[id*="code" i]`
  - `input[autocomplete="one-time-code"]`
- submit:
  - button text `Verify`
  - button text `Continue`
  - button text `Submit`
  - input/button type submit

Do not log the code.

Also update MFA detection flow so when email-code option exists, the backend clicks:
- `Email`
- `Send Code`
- `Send verification code`
- similar text

Then returns `mfa_email_code_input_required`.

---

## Session store changes

Modify:

```txt
scraper-service/app/services/uci/uci-pepco-session-store.js
```

Add support for storing continuation metadata:

```js
{
  sessionId,
  coordinationId,
  userId,
  browser,
  context,
  page,
  status: "awaiting_code_input",
  continueAction: "discover_dashboard",
  captureApplicationIds: true,
  createdAt,
  updatedAt
}
```

Add/update helpers as needed:
- create/update session with continuation context
- get session by id
- validate ownership
- close session safely

Keep TTL.

---

## Dashboard discovery service changes

Modify:

```txt
scraper-service/app/services/uci/uci-pepco-dashboard-discovery.service.js
```

When dashboard discovery login returns MFA:
- Return `human_required` with:
  - `reason: "mfa_email_code_input_required"`
  - `session_id`
  - `continue_action: "discover_dashboard"`
  - `capture_application_ids`

Add service function:

```js
submitPepcoCodeAndContinueDashboardDiscovery({
  supabase,
  user,
  coordinationId,
  sessionId,
  code,
  captureApplicationIds
})
```

This function should:
- validate session
- submit code via `submitPepcoMfaCode`
- if dashboard ready, run dashboard extraction/capture
- persist results
- close session on completed/failed
- keep session open if code rejected and user can retry

---

## Routes

Modify:

```txt
scraper-service/app/routes/uci.routes.js
```

Add:

```txt
POST /coordination/:id/discovery/pepco/submit-code
```

Return HTTP 200 for normal flow statuses:
- `completed`
- `human_required`
- `failed`

Use existing `sanitizeUciError` for auth/access/server errors.

---

## Frontend API

Modify:

```txt
src/lib/uciApi.ts
```

Add:

```ts
submitPepcoMfaCode(
  coordinationId: string,
  body: {
    session_id: string;
    code: string;
    continue_action?: "discover_dashboard";
    capture_application_ids?: boolean;
  }
)
```

---

## Frontend types

Modify:

```txt
src/types/uci.ts
```

Extend discovery response to support:

```ts
{
  status: "human_required";
  reason: "mfa_email_code_input_required";
  message: string;
  session_id: string;
  continue_action?: "discover_dashboard";
  capture_application_ids?: boolean;
}
```

---

## UCI UI changes

Modify:

```txt
src/pages/UciDashboard.tsx
```

When Discover PEPCO Dashboard returns:

```txt
status = human_required
reason = mfa_email_code_input_required
session_id exists
```

Show modal/dialog:

Title:

```txt
Enter PEPCO verification code
```

Description:

```txt
A verification code was sent to the PEPCO mailbox. Paste it here and PermitPilot will continue the dashboard discovery.
```

Input:
- code
- numeric
- max length 8
- do not persist
- clear after submit

Buttons:
- Submit Code & Continue
- Cancel

On submit:
- call `/submit-code`
- send session_id, code, continue_action, capture_application_ids
- show loading

If response completed:
- close modal
- show discovered dashboard cards/table
- update summary

If response human_required:
- keep modal open
- show error/message
- allow retry

If response failed:
- close modal or show failure
- allow rerun discovery

Important:
- Do not show/log code elsewhere.
- Do not store code in component state longer than needed.
- Clear code after submit/failure.

---

## UX flow after this patch

For manual fallback:

```txt
Discover PEPCO Dashboard
→ PEPCO login starts
→ backend clicks email code option
→ PermitPilot modal asks for code
→ user enters code
→ backend fills code into PEPCO
→ dashboard discovery continues
→ cards appear
```

This is the intended flow.

---

## Testing checklist

### Backend curl

Start discovery:

```bash
curl -sS -X POST "$BASE/api/uci/coordination/$COORD/discovery/pepco/dashboard" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"headed":true,"auto_email_mfa":false,"capture_application_ids":true}' | jq
```

Expected:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code_input_required",
  "session_id": "pepco_...",
  "continue_action": "discover_dashboard",
  "capture_application_ids": true
}
```

Submit code:

```bash
curl -sS -X POST "$BASE/api/uci/coordination/$COORD/discovery/pepco/submit-code" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"pepco_...","code":"073099","continue_action":"discover_dashboard","capture_application_ids":true}' | jq
```

Expected:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_application_ids_captured",
  "cards_found": 3,
  "application_ids_found": 3
}
```

Wrong code expected:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code_input_required",
  "session_id": "pepco_..."
}
```

### UI

1. Go to `/uci`.
2. Open PEPCO coordination.
3. Click `Discover + Capture Application IDs`.
4. Wait for MFA code modal.
5. Check mailbox for PEPCO code.
6. Paste code into PermitPilot modal.
7. Click `Submit Code & Continue`.
8. Expected:
   - modal closes
   - dashboard cards appear
   - app IDs appear if capture enabled

---

## Security constraints

- Do not log code.
- Do not store code in DB.
- Do not store code in metadata.
- Do not expose code in frontend logs.
- Do not store email body.
- Keep session TTL.
- Close browser after completed/failed.
- Keep browser open only while awaiting code input.

---

## Output required

When done, report:
1. Files created.
2. Files modified.
3. Endpoint added.
4. Exact response examples.
5. UI flow added.
6. How to test.
7. Known caveats.
8. Confirmation that no overview/status/documents/download/upload/submit/message automation was added.
