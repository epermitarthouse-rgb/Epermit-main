# PermitPilot UCI Sprint 4 — Phase 4: PEPCO Dashboard Discovery Foundation

Phase 4 starts after PEPCO login/MFA is working.

## Goal

After PEPCO reaches:

```txt
/service-installation-upgrades-portal/dashboard
```

discover PEPCO dashboard project/application cards and capture safe structured metadata.

Do **not** scrape overview/status/documents yet.  
Do **not** download documents yet.  
Do **not** automate upload, submit, messages, account settings, or any PEPCO write action.

---

# Phase 4A — Dashboard Cards Only

## Goal

Extract visible PEPCO dashboard application cards into structured JSON.

Do **not** click cards yet.

## Known selectors

```txt
app-dashboard-application
.applications
.application-card
.application-metadata
.application-details
.last-updated-container
.job-id-container
```

Clickable areas later:

```txt
.application-metadata
.application-details
```

Known dashboard fields:

```txt
Project title
Address
Status
Last Updated
Date Submitted
Job ID
```

Example Job IDs:

```txt
PEPCO-NB-0067752
PEPCO-NB-0064620
PEPCO-NB-0000347
```

## Backend file

Create:

```txt
scraper-service/scrapers/pepco/dashboard-discovery.js
```

Export:

```js
async function extractPepcoDashboardCards(page, { logger } = {})
```

Return:

```js
{
  status: "completed",
  checkpoint: "dashboard_cards_extracted",
  currentUrl,
  cardsFound: 3,
  cards: [
    {
      index: 0,
      title: "...",
      address: "...",
      status: "...",
      lastUpdated: "...",
      dateSubmitted: "...",
      jobId: "...",
      rawText: "..."
    }
  ]
}
```

## Extraction rules

Use DOM-first extraction:
- Wait for dashboard URL or dashboard selectors.
- Prefer `app-dashboard-application` or `.application-card`.
- Capture `innerText` for each card.
- Parse fields defensively.
- Preserve `rawText`.
- Do not fail whole run if one field is missing.

Suggested parsing:
- Job ID: `/PEPCO-[A-Z]+-\d+/i`
- Status: text near `Status`
- Last Updated: text near `Last Updated`
- Date Submitted: text near `Date Submitted`
- Title/address from `.application-metadata`

If uncertain:
- set field to `null`
- keep `rawText`

## Artifacts

If `SCRAPER_DEBUG_ARTIFACTS=1`:
- Save dashboard screenshot.
- Save dashboard HTML.
- Save extracted JSON locally.

Use existing artifact/debug conventions.

---

# Phase 4B — Application ID Capture

## Goal

Click dashboard cards safely to capture `applicationId`.

Still read-only:
- click card
- wait for `/application/{applicationId}/overview`
- extract application ID from URL
- return to dashboard
- do not scrape overview page content

## Known route after card click

```txt
/service-installation-upgrades-portal/application/{applicationId}/overview
```

## Backend function

Extend:

```txt
scraper-service/scrapers/pepco/dashboard-discovery.js
```

Add:

```js
async function capturePepcoApplicationIds(page, cards, { logger } = {})
```

or support option:

```json
{ "capture_application_ids": true }
```

## Behavior per card

1. Start from dashboard.
2. Click `.application-metadata` or `.application-details`.
3. Wait for URL matching `/application/{applicationId}/overview`.
4. Extract `applicationId`.
5. Attach to card:
   - `applicationId`
   - `overviewUrl`
6. Navigate back to dashboard route.
7. Wait for cards again.
8. Continue.

## Return shape

```json
{
  "status": "completed",
  "checkpoint": "dashboard_application_ids_captured",
  "cards_found": 3,
  "application_ids_found": 3,
  "cards": [
    {
      "index": 0,
      "title": "...",
      "jobId": "...",
      "applicationId": "05f5038f-0edd-4151-b575-60569a55e827",
      "overviewUrl": "https://secure.pepco.com/service-installation-upgrades-portal/application/05f5038f-0edd-4151-b575-60569a55e827/overview"
    }
  ]
}
```

If one click fails:
- add `applicationIdError` to that card
- continue if safe

---

# Phase 4C — Persist Discovery + UI Display

## Goal

Persist dashboard discovery results and show them in UCI UI.

## Storage recommendation

First inspect existing metadata/artifact patterns.

Preferred:
- Store compact summary in `coordination_records.metadata`.
- Store full extracted JSON as artifact if artifact storage already exists.
- Do not add a new table unless clearly necessary.

Suggested metadata:

```json
{
  "pepco_dashboard_discovery": {
    "last_discovered_at": "...",
    "status": "completed",
    "cards_found": 3,
    "application_ids_found": 3,
    "cards": [
      {
        "title": "...",
        "address": "...",
        "status": "...",
        "lastUpdated": "...",
        "dateSubmitted": "...",
        "jobId": "...",
        "applicationId": "...",
        "overviewUrl": "..."
      }
    ]
  }
}
```

Also patch simple top-level keys for quick filtering:

```json
{
  "pepco_dashboard_last_discovered_at": "...",
  "pepco_dashboard_discovery_status": "completed",
  "pepco_dashboard_cards_found": 3,
  "pepco_dashboard_application_ids_found": 3
}
```

Do not store raw HTML or screenshots in metadata.

## UI

In:

```txt
src/pages/UciDashboard.tsx
```

In PEPCO coordination detail:
- show dashboard discovery status
- show last discovered time
- show card count
- show table/list of cards:
  - Project title
  - Address
  - Status
  - Job ID
  - Application ID if captured
- add action:
  - `Discover PEPCO Dashboard`
- optional advanced action:
  - `Discover + Capture Application IDs`

No overview/status/documents buttons yet.

---

# Endpoint Design

Prefer dedicated endpoint for clarity:

```txt
POST /api/uci/coordination/:id/discovery/pepco/dashboard
```

Request body:

```json
{
  "headed": true,
  "auto_email_mfa": true,
  "capture_application_ids": true
}
```

Response:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_application_ids_captured",
  "cards_found": 3,
  "application_ids_found": 3,
  "cards": []
}
```

Keep existing endpoints working:
- `POST /api/uci/coordination/:id/discovery/pepco`
- `POST /api/uci/coordination/:id/discovery/pepco/resume`

If the existing endpoint is cleaner to extend, that is acceptable, but do not make it messy. Prefer a dedicated dashboard endpoint.

---

# Login/MFA behavior

Phase 4 should reuse existing login/MFA logic:
- Phase 2 login
- Phase 3 manual fallback
- Phase 3.5 Microsoft Graph auto MFA if available

If Microsoft admin consent is still pending:
- auto email MFA may fail or be unavailable
- manual fallback must still work

Acceptable fallback:
- returns `human_required + session_id`
- user completes MFA manually
- resume confirms dashboard
- dashboard discovery can be rerun after authenticated flow is available, or implemented to continue after resume if clean

Do not break manual fallback.

---

# Safety Constraints

Allowed:
- Login
- MFA verification
- Navigate dashboard
- Read dashboard card text
- Click dashboard cards only to capture application ID
- Navigate back to dashboard

Forbidden:
- Upload Document
- Submit
- Send Message
- Modify application
- Account settings
- Document downloads
- Overview/status/documents data scraping

---

# Testing Checklist

## Backend/API

Set variables:

```bash
BASE="http://localhost:3002"
COORD="<coordination_id>"
TOKEN="<supabase_jwt>"
```

Providers check:

```bash
curl -sS "$BASE/api/uci/providers" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Dashboard cards only:

```bash
curl -sS -X POST "$BASE/api/uci/coordination/$COORD/discovery/pepco/dashboard" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"headed":true,"auto_email_mfa":true,"capture_application_ids":false}' | jq
```

Expected:

```json
{
  "status": "completed",
  "checkpoint": "dashboard_cards_extracted",
  "cards_found": 3
}
```

With application ID capture:

```bash
curl -sS -X POST "$BASE/api/uci/coordination/$COORD/discovery/pepco/dashboard" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"headed":true,"auto_email_mfa":true,"capture_application_ids":true}' | jq
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

## DB Metadata

```sql
select
  id,
  metadata -> 'pepco_dashboard_discovery' as dashboard_discovery,
  metadata ->> 'pepco_dashboard_discovery_status' as dashboard_status,
  metadata ->> 'pepco_dashboard_cards_found' as cards_found,
  metadata ->> 'pepco_dashboard_application_ids_found' as application_ids_found
from coordination_records
where id = '<coordination_id>';
```

Expected:
- `dashboard_status = completed`
- `cards_found > 0`
- `application_ids_found > 0` if capture enabled

## UI

1. Go to `/uci`.
2. Select project.
3. Open PEPCO coordination.
4. Click `Discover PEPCO Dashboard`.
5. Expected:
   - login/MFA runs
   - cards display in UI
   - card count is shown
   - no overview/status/documents scraping

---

# Output Required After Implementation

Report:

1. Files created.
2. Files modified.
3. Endpoint added or existing endpoint extended.
4. Whether Phase 4A, 4B, and 4C were completed.
5. Exact response examples.
6. Where results are stored.
7. UI changes.
8. How to test with curl.
9. Any blockers:
   - Microsoft admin consent pending
   - auto MFA unavailable
   - dashboard selectors changed
   - card click did not produce applicationId
10. Confirmation that no overview/status/documents/download/upload/submit/message automation was added.
