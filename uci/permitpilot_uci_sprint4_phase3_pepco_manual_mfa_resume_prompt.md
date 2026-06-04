# PermitPilot UCI Sprint 4 — Phase 3: PEPCO Manual MFA Resume / Session Continuation

Phase 2 is verified:
- PEPCO credential resolves and decrypts.
- Playwright launches.
- PEPCO/Exelon login page opens.
- Username/password are filled.
- Submit works.
- MFA/email-code screen is detected.
- API returns `status: "human_required"`.
- `coordination_records.metadata.pepco_discovery_last_status = human_required`.

Now implement **Phase 3 only**.

## Goal

After Phase 2 returns `human_required`, keep the browser/page/session alive long enough for a human to complete MFA manually in the visible browser, then allow the backend to resume and confirm the PEPCO dashboard is reached.

Do **not** scrape dashboard cards yet.  
Do **not** scrape overview/status/documents yet.  
Do **not** download files yet.

---

## Required behavior

### Step 1 — Login check starts session

Existing endpoint:

```txt
POST /api/uci/coordination/:id/discovery/pepco
```

Current behavior returns:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code",
  "message": "PEPCO email verification code required."
}
```

Update it so when MFA is detected, it also returns a `session_id`:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code",
  "message": "PEPCO email verification code required. Complete MFA in the opened browser, then click Resume.",
  "session_id": "pepco_..."
}
```

The browser/context/page should stay alive in memory for this session.

---

### Step 2 — Human completes MFA manually

User enters PEPCO email code manually in the visible browser.

No mailbox automation yet.

---

### Step 3 — Resume endpoint confirms dashboard

Add endpoint:

```txt
POST /api/uci/coordination/:id/discovery/pepco/resume
```

Request body:

```json
{
  "session_id": "pepco_..."
}
```

Expected success response if dashboard reached:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_ready",
  "currentUrl": "https://secure.pepco.com/service-installation-upgrades-portal/dashboard"
}
```

If still on MFA screen:

```json
{
  "status": "human_required",
  "reason": "mfa_email_code",
  "message": "PEPCO MFA is still required. Complete the verification code in the browser, then resume again.",
  "session_id": "pepco_..."
}
```

If session expired/missing:

```json
{
  "status": "failed",
  "error_code": "SESSION_EXPIRED",
  "message": "PEPCO login session expired. Run login check again."
}
```

---

## Implementation requirements

### 1. Add in-memory PEPCO session registry

Create or extend a service file, for example:

```txt
scraper-service/app/services/uci/uci-pepco-session-store.js
```

Store:

```js
{
  sessionId,
  coordinationId,
  userId,
  browser,
  context,
  page,
  createdAt,
  updatedAt,
  status: "awaiting_mfa"
}
```

Requirements:
- Session IDs must be random/unguessable.
- Session must be tied to `coordinationId` and `userId`.
- Resume must verify the same authenticated user and same coordination record.
- Add TTL cleanup, e.g. 15 minutes.
- On completed/failed/expired, close browser/context safely.
- Never store passwords, tokens, MFA codes, cookies in DB/logs.

---

### 2. Update PEPCO discovery service

Modify:

```txt
scraper-service/app/services/uci/uci-pepco-discovery.service.js
```

When login flow returns `human_required`:
- Do not close browser immediately.
- Register browser/context/page in session store.
- Return `session_id`.

When login flow returns `completed` or `failed`:
- Close browser/context normally.
- Patch metadata as Phase 2 already does.

Metadata should include:

```json
{
  "pepco_discovery_last_status": "human_required",
  "pepco_discovery_last_attempt_at": "...",
  "pepco_discovery_session_status": "awaiting_mfa"
}
```

Do not store `session_id` in DB unless necessary. If stored, it must be treated as non-secret but still not exposed widely.

---

### 3. Add resume service

Add function like:

```js
resumePepcoDiscoveryAfterMfa({ supabase, user, coordinationId, sessionId })
```

Responsibilities:
- Verify coordination row exists.
- Verify user project access.
- Load PEPCO session from in-memory store.
- Confirm session belongs to same `userId` and `coordinationId`.
- Inspect current `page.url()` and visible text.
- Determine:
  - dashboard ready
  - still MFA
  - failed/unknown page

Dashboard-ready detection:
- URL contains:

```txt
/service-installation-upgrades-portal/dashboard
```

or page has PEPCO dashboard indicators from Phase 1 findings:
- `app-dashboard-application`
- `.applications`
- `.application-card`
- text like `service installation upgrades portal`

Still-MFA detection:
- verification code input visible
- text contains `verification code`
- text contains `verify`
- Azure B2C URL still present

Unknown state:
- save debug screenshot if `SCRAPER_DEBUG_ARTIFACTS=1`
- return failed with safe message

---

### 4. Update routes

Modify:

```txt
scraper-service/app/routes/uci.routes.js
```

Add:

```txt
POST /coordination/:id/discovery/pepco/resume
```

Behavior:
- Require Bearer auth.
- Use same UCI access/project checks pattern.
- Call resume service.
- Return HTTP 200 for normal outcome statuses:
  - `completed`
  - `human_required`
  - `failed`
- Use `sanitizeUciError` for auth/access/server/config errors.

Keep existing Phase 2 endpoint working.

---

### 5. Update frontend API

Modify:

```txt
src/lib/uciApi.ts
```

Add:

```ts
resumePepcoDiscovery(coordinationId: string, body: { session_id: string })
```

---

### 6. Update frontend types

Modify:

```txt
src/types/uci.ts
```

Ensure `UciDiscoveryResponse` supports `session_id`.

---

### 7. Update UCI UI

Modify:

```txt
src/pages/UciDashboard.tsx
```

Minimal UI only:
- When `Run PEPCO Login Check` returns `human_required` with `session_id`, store that session id in component state.
- Show message:
  - “PEPCO MFA required. Complete the email code in the opened browser, then click Resume.”
- Show button:
  - `Resume PEPCO Login`
- Resume button calls:

```txt
POST /api/uci/coordination/:id/discovery/pepco/resume
```

Behavior:
- If resume returns `completed`, show:
  - “PEPCO dashboard reached.”
- If resume returns `human_required`, keep Resume button visible.
- If resume returns `failed`, show failure message and allow running login check again.

No dashboard scraping UI yet.

---

## Safety constraints

Absolutely do not automate:
- Upload Document
- Submit
- Send Message
- Modify application
- Account settings
- Document downloads

Phase 3 only:
- Keep login browser alive.
- Let human complete MFA.
- Resume and confirm dashboard readiness.

---

## Testing checklist

Provide exact commands/checks for:

1. Backend starts.
2. Existing `/api/uci/providers` still works.
3. Phase 2 login endpoint returns `human_required` with `session_id`.
4. Browser stays open after MFA screen.
5. Human enters MFA code manually.
6. Resume endpoint returns:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_ready"
}
```

7. Resume endpoint returns clean `SESSION_EXPIRED` if invalid session id is used.
8. Session closes after completed/failed.
9. Metadata updates correctly:
   - `pepco_discovery_last_status`
   - `pepco_discovery_session_status`
10. No dashboard scraping was added.

---

## Output required

When done, report:
1. Files created.
2. Files modified.
3. Endpoint added.
4. Exact response examples.
5. How to test with curl.
6. Any blockers.
7. Confirmation that Phase 3 only handles manual MFA resume/session continuation.
