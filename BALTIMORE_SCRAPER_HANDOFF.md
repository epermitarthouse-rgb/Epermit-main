# Baltimore Scraper Handoff / Debug Package

**Date:** 2026-03-18  
**Scope:** Accela/Baltimore scraping path only. No new scraping steps; instrumentation and documentation only.  
**Constraint:** Baltimore uses the same Accela scraper as other Accela portals (e.g. DC, Fairfax); the only difference is the portal URL (`https://aca-prod.accela.com/BALTIMORE`).

---

## A. Current scraper files

| File path | Function / class name | Purpose | Baltimore-specific? |
|-----------|------------------------|---------|---------------------|
| `scraper-service/server.js` | (express app) | HTTP server; login and scrape API entry points | Shared |
| `scraper-service/server.js` | `detectPortalType(url)` | Returns `"accela"` when url includes `accela.com` | Shared |
| `scraper-service/server.js` | POST `/api/login` handler | Receives `username`, `password`, `portalUrl`; launches browser; for Accela calls `accelaScraperLogin(page, username, password, dashboardUrl)`; stores session; saves `debug_dashboard.png` | Shared (Baltimore = Accela with `portalUrl` = BALTIMORE base) |
| `scraper-service/server.js` | POST `/api/scrape` handler | For `session.portalType === "accela"` requires `permitNumber`; calls `scrapeAccelaRecord(session, permitNumber, ...)` | Shared |
| `scraper-service/accela-scraper.js` | `accelaLogin` (exported as `accelaScraperLogin` in server) | Navigates to `portalUrl/Login.aspx`, finds login frame or main page, fills username/password, submits, waits for auth landmarks | Shared (all Accela) |
| `scraper-service/accela-scraper.js` | `findFieldInFrames(page, selectors)` | Finds first visible element matching any selector on main page or child frames | Shared |
| `scraper-service/accela-scraper.js` | `waitForAccelaLoad(pageOrFrame, timeoutMs)` | Waits for load state and Accela loading masks to detach | Shared |
| `scraper-service/accela-scraper.js` | `clickAccelaLink(pageOrFrame, selectors, label)` | Tries each selector, clicks first visible, logs and calls `waitForAccelaLoad` | Shared |
| `scraper-service/accela-scraper.js` | `dumpPageDiagnostics(page, label)` | Logs URL, title, loginFormVisible, logoutVisible, welcomeVisible, frame list | Shared |
| `scraper-service/accela-scraper.js` | `dumpLoginFrameDiagnostics(frame, label)` | Logs LoginFrame URL, user/pass visibility, button state, error text | Shared |
| `scraper-service/accela-scraper.js` | `findAuthLandmark(page)` | Returns true if Logout/My Account/My Records/Welcome etc. found in any frame | Shared |
| `scraper-service/accela-scraper.js` | `findLoginFrame(page)` | Returns frame whose name or URL contains "login" | Shared |
| `scraper-service/accela-scraper.js` | `findFieldInContext(context, selectors)` | Finds first visible element in given context (page or frame) | Shared |
| `scraper-service/accela-scraper.js` | `searchPermit(page, portalUrl, permitNumber)` | Verifies auth; clicks Permits tab; waits for records grid; finds permit link by text; clicks; waits for record detail; sets `page._recordFrame` | Shared |
| `scraper-service/accela-scraper.js` | `waitForRecordDetailStrong(page, recordFrame, permitNumber)` | Waits up to 20s for record-detail selectors or permit number in body | Shared |
| `scraper-service/accela-scraper.js` | `getExtractionContext(page)` | Returns `page._recordFrame` or `page` | Shared |
| `scraper-service/accela-scraper.js` | `extractRecordHeader`, `extractRecordDetails`, `extractProcessingStatus`, `extractPlanReview`, `extractRelatedRecords`, `extractAttachments`, `extractInspections`, `extractPayments` | Extract data from record detail page | Shared |
| `scraper-service/accela-scraper.js` | `scrapeAccelaRecord(session, permitNumber, ...)` | Calls `searchPermit` then all extractors; builds `portalData`; syncs to Supabase | Shared |
| `scraper-service/accela-scraper.js` | `getAccelaDebugDir()`, `saveCheckpointScreenshot(page, label)` | Ensures `scraper-service/debug` exists; saves timestamped PNG (e.g. `2026-03-18T12-00-00_after_login.png`) | Shared (used for all Accela runs) |

**Baltimore-specific:** None. Baltimore is “Accela” with `portalUrl` = `https://aca-prod.accela.com/BALTIMORE` (or equivalent). All logic lives in `server.js` and `accela-scraper.js` and is shared across Accela portals.

---

## B. Current execution flow

| Step | Function | File | Selector / URL | Expected outcome | Status |
|------|----------|------|----------------|------------------|--------|
| 1 | Express POST `/api/login` | server.js | Body: `portalUrl`, `username`, `password` | Browser launch, page created | Working (assumption) |
| 2 | `accelaScraperLogin(page, username, password, dashboardUrl)` | server.js → accela-scraper.js | `dashboardUrl` = e.g. `https://aca-prod.accela.com/BALTIMORE` | Navigate to `{dashboardUrl}/Login.aspx` | Working (per user) |
| 3 | `accelaLogin` | accela-scraper.js | `loginUrl = cleanUrl + "/Login.aspx"` | Page loads login | Working (per user) |
| 4 | `findLoginFrame(page)` | accela-scraper.js | Frame name/URL contains "login" | LoginFrame or null | Working (assumption) |
| 5 | Find username field | accela-scraper.js | `#ctl00_PlaceHolderMain_LoginBox_txtUserId`, `input[name*="txtUserId"]`, … | Fill username | Working (per user) |
| 6 | Find password field | accela-scraper.js | `#ctl00_PlaceHolderMain_LoginBox_txtPassword`, `input[type="password"]`, … | Fill password | Working (per user) |
| 7 | Find login button / submit | accela-scraper.js | `#ctl00_PlaceHolderMain_LoginBox_btnLogin`, `button:has-text("SIGN IN")`, … or Enter | Submit login | Working (per user) |
| 8 | Wait for auth | accela-scraper.js | LoginFrame detached or auth landmark (`Logout`, `My Account`, etc.) | Login success | Working (per user) |
| 9 | Checkpoint | accela-scraper.js | — | Save `debug/YYYY-MM-DDTHH-mm-ss_after_login.png` | Added |
| 10 | Return to server | server.js | — | Screenshot `debug_dashboard.png`; store session; return `sessionId` | Working (per user) |
| 11 | POST `/api/scrape` with `sessionId`, `permitNumber` | server.js | — | Invoke `scrapeAccelaRecord` | Working (assumption) |
| 12 | `searchPermit(page, portalUrl, permitNumber)` | accela-scraper.js | — | Auth check, then Permits tab | Working (per user) |
| 13 | Find Permits tab | accela-scraper.js | `#Tab_Building`, `a:has-text("Permits and Inspections")`, … | Click Permits and Inspections | Working (per user) |
| 14 | Checkpoint | accela-scraper.js | — | Save `after_permits_page.png` | Added |
| 15 | Wait for records grid | accela-scraper.js | `table[id*="PermitList"] tr`, `table[id*="Record"] tr`, `.aca_grid_container tr td a`, `[id*="gview_List"] tr` (or in frame) | Grid visible or fallback to frame scan | Working (per user) |
| 16 | Checkpoint (grid found) | accela-scraper.js | — | Save `after_records_page.png` | Added |
| 17 | Find permit link | accela-scraper.js | `a:has-text("${permitNumber}")` or scan all links/frames | Link found | Uncertain until exercised |
| 18 | Click permit link | accela-scraper.js | — | Navigate to record detail | Uncertain |
| 19 | `waitForRecordDetailStrong` | accela-scraper.js | `[id*="lblPermitNumber"]`, `[id*="CapDetail"]`, … or body text contains permit number | Record detail loaded | Uncertain |
| 20 | Checkpoint | accela-scraper.js | — | Save `after_record_detail.png` | Added |
| 21 | Extract header, details, status, plan review, related, attachments, inspections, payments | accela-scraper.js | Various (see Selector inventory) | `portalData` built | Uncertain for Baltimore |
| 22 | Sync to Supabase | server.js / accela-scraper.js | — | Project row updated/created | Shared |

---

## C. Confirmed working boundary

- **Can it log in?** Yes (per your constraint: “scraper is already able to log in”).
- **Can it open Baltimore portal?** Yes (same as “enter the Baltimore portal”).
- **Can it navigate to Permits and Inspections?** Yes (per “reach the records area”).
- **Can it reach records list / search results?** Yes (per “reach the records area”).
- **Can it click a record number?** Not confirmed in handoff; code path exists (`searchPermit` finds link by `permitNumber` and clicks). Assumption: may work if a matching permit number exists in the list.
- **Can it open detail page?** Not confirmed; depends on click and URL navigation.
- **Can it extract any detail fields?** Not confirmed for Baltimore; extractors are generic Accela.
- **Exact last successful step:** Reaching the records area (after Permits tab and records grid).
- **First missing or failing step (if any):** Either “find permit link by number in list” or “click and load record detail” or “record detail selectors match Baltimore DOM.” Must be validated with a real run and checkpoint screenshots.

---

## D. First missing / failing step

- If **records list** shows a different layout (e.g. different table/grid selectors), the “wait for records grid” step may time out or the permit link search may not find the right element.
- If **record detail** is in an iframe or a different URL pattern, `waitForRecordDetailStrong` and `getExtractionContext` may target the wrong context.
- If **Baltimore** uses different IDs/classes for Record Info, Processing Status, etc., extractors may return empty or wrong data.

**Recommendation:** Run the scraper with a known Baltimore permit number, collect console logs and `scraper-service/debug/*.png` (and `debug_dashboard.png`, `login_failed.png`, `grid_not_found.png`, `record_not_loaded.png` if present). Use them to confirm the exact step where behavior diverges from expectations.

---

## E. Debug instrumentation status

| Feature | Present | Location | Notes |
|---------|--------|----------|--------|
| Step-by-step logs | Yes | accela-scraper.js | Console logs for login, Permits tab, grid, permit link, record detail, each extractor |
| Current URL logging | Yes | `dumpPageDiagnostics`, `[DIAG:POST_CLICK] urlBefore/urlAfter`, login confirmed URL |
| Screenshot captures | Yes | server.js: `debug_dashboard.png`; accela-scraper: `login_failed.png`, `grid_not_found.png`, `record_not_loaded.png`; checkpoint helper: `debug/<ts>_<label>.png` |
| HTML snapshot saving | No | — | Only in-memory evaluate(); no HTML dump to disk |
| Selector wait logs | Partial | clickAccelaLink logs “Clicking … via sel” or “link not found”; waitForSelector does not log selector used on timeout |
| Click logs | Yes | clickAccelaLink: “Clicking ‘…’ via …” |
| Error screenshots | Yes | login_failed, grid_not_found, record_not_loaded |
| Timeout diagnostics | Partial | dumpPageDiagnostics / dumpLoginFrameDiagnostics on NO_USER_FIELD, NO_PASS_FIELD, LOGIN_ERROR, LOGIN_TIMEOUT, SEARCH_AUTH_CHECK, NO_GRID, PERMIT_NOT_FOUND; waitForRecordDetailStrong logs “No strong record detail signals” and saves screenshot |
| Frame inspection logs | Yes | dumpPageDiagnostics logs frame list; searchPermit logs each frame preview and “Record detail frame identified” |
| Elapsed time logs | No | — | No per-step elapsed time (only 10-minute overall timeout in scrapeAccelaRecord) |
| Checkpoint screenshots (timestamped) | Yes (added) | accela-scraper.js | `getAccelaDebugDir()`, `saveCheckpointScreenshot(page, label)`; labels: `after_login`, `after_permits_page`, `after_records_page`, `after_record_detail` |

---

## F. Frame / context analysis

- **Frames:** Login often runs inside a frame whose name/URL contains “login” (`findLoginFrame`). Main page and all child frames are scanned for auth landmarks, Permits tab, grid, and permit link.
- **Record detail:** Code tries to identify a “record frame” by URL (e.g. `Cap/CapDetail`, `capDetail`, `Record`, `permit`) or by body text containing the permit number. Extraction uses `page._recordFrame` or main page.
- **Assumption:** Baltimore may use a single main frame for post-login content, or an iframe for the main content; the code does not assume main-frame-only.
- **Risk for record-detail scraping:** If Baltimore loads the record detail in a new tab or a different frame than the one detected, `getExtractionContext(page)` may point at the wrong context and extractors may see empty DOM. Checkpoint screenshot “after_record_detail” and frame logs will tell.

---

## G. Selector inventory

| Purpose | Selectors (in order tried) | Status |
|---------|----------------------------|--------|
| Username | `#ctl00_PlaceHolderMain_LoginBox_txtUserId`, `input[name*="txtUserId"]`, `input[name*="UserName"]`, … | Confirmed working (login works) |
| Password | `#ctl00_PlaceHolderMain_LoginBox_txtPassword`, `input[name*="txtPassword"]`, `input[type="password"]`, … | Confirmed working |
| Login submit | `#ctl00_PlaceHolderMain_LoginBox_btnLogin`, `input[name*="btnLogin"]`, `a[id*="btnLogin"]`, `button:has-text("SIGN IN")`, … | Confirmed working |
| Auth landmark | `a:has-text("Logout")`, `#ctl00_HeaderNavigation_lblWelcome`, `a:has-text("My Account")`, … | Confirmed working |
| Permits tab | `#Tab_Building`, `a:has-text("Permits and Inspections")`, `a:has-text("Permits & Inspections")`, `a[title*="Permits"]`, `#header_main_menu a:has-text("Permits")` | Confirmed working (per “reach records area”) |
| Records grid | `table[id*="PermitList"] tr`, `table[id*="Record"] tr`, `.aca_grid_container tr td a`, `[id*="gview_List"] tr`; fallback in frame: `table tr td a`, `.aca_grid_container` | Likely working |
| Permit link | `a:has-text("${permitNumber}")` then scan `page.$$("a")` and frame evaluate | Unknown until run with real permit number |
| Record detail signals | `[id*="lblPermitNumber"]`, `[id*="capNumber"]`, `[id*="PermitDetailList"]`, `[id*="CAPDetail"]`, `.aca_page_title`, … | Unknown for Baltimore |
| Record Info tab | `a:has-text("Record Info")`, `a[id*="RecordInfo"]`, `#ctl00_PlaceHolderMain_TabDataList a:has-text("Record")` | Unknown |
| Record Details sub | `a:has-text("Record Details")`, `a:has-text("Record Detail")`, `a[id*="RecordDetail"]` | Unknown |
| Processing Status | `a:has-text("Processing Status")`, `a[id*="ProcessingStatus"]`, `a:has-text("Workflow")` | Unknown |
| (Other extractors) | Various IDs/classes in evaluate() (e.g. `.rec-left`, `[id*="PlaceHolderMain"]`, workflow/attachments/inspections/payments tables) | Unknown for Baltimore |

---

## H. Env / config requirements

| Variable / config | Where used | Purpose |
|-------------------|------------|--------|
| `PORT` | server.js | Server listen port (default 3001) |
| `SUPABASE_URL` | server.js | Supabase client for project/portal_data sync |
| `SUPABASE_SERVICE_ROLE_KEY` | server.js | Supabase auth for scraper |
| `process.env.RAILWAY_ENVIRONMENT` | server.js | Optional; used for startup message |
| `portalUrl` (request body) | server.js POST `/api/login` | Must be Accela base URL for Baltimore, e.g. `https://aca-prod.accela.com/BALTIMORE` |
| `username` | server.js, accela-scraper.js | Login credential (not logged) |
| `password` | server.js, accela-scraper.js | Login credential (not logged) |
| `permitNumber` | server.js POST `/api/scrape`, accela-scraper.js | Required for Accela scrape; used to find link and validate detail page |

No Baltimore-specific env vars. Credentials and portal URL are passed in API requests (e.g. from frontend or Postman).

---

## I. Debug runbook

### How to run Baltimore scraper in debug mode

1. **Start the scraper server**
   - From repo root: `cd scraper-service && node server.js`
   - Or: `npm run start` (if script points at server.js).
   - Ensure `PORT` is free (default 3001) or set `PORT` in env.

2. **Required env (for Supabase sync)**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Optional: `PORT`

3. **Create a session (login)**
   - POST `http://localhost:3001/api/login` (or your `SCRAPER_URL`) with JSON:
     - `portalUrl`: `https://aca-prod.accela.com/BALTIMORE`
     - `username`: Baltimore portal username
     - `password`: Baltimore portal password
   - Response: `{ sessionId, ... }`. Use `sessionId` for the next step.

4. **Start a scrape**
   - POST `http://localhost:3001/api/scrape` with JSON:
     - `sessionId`: from step 3
     - `permitNumber`: a permit number that exists in the Baltimore records list (e.g. from the UI or a known test value).

5. **Where logs are written**
   - Stdout of the process running `node server.js`. No log file by default; redirect if needed, e.g. `node server.js 2>&1 | tee scraper.log`.

6. **Where screenshots / HTML are saved**
   - **scraper-service/debug/**  
     Timestamped checkpoints: `YYYY-MM-DDTHH-mm-ss_after_login.png`, `…_after_permits_page.png`, `…_after_records_page.png`, `…_after_record_detail.png`.
   - **scraper-service/**  
     - `debug_dashboard.png` — after Accela login (overwritten each login).
     - `login_failed.png` — on login error (overwritten).
     - `grid_not_found.png` — when permit link not found after grid wait.
     - `record_not_loaded.png` — when record detail signals not found within 20s.

7. **Success vs failure**
   - **Success:** Login returns 200 with `sessionId`. Scrape returns 200 and later session status becomes “done”; progress events (if polled) show completion.
   - **Failure:** Login may return 4xx/5xx or throw (check console). Scrape may return 400 (e.g. missing `permitNumber`) or 4xx/5xx; console shows Accela errors; check `login_failed.png`, `grid_not_found.png`, `record_not_loaded.png`, and `debug/*.png` for the last successful step.

---

## J. Recommended next implementation target

- **Do not** implement new scraping steps in this handoff; only document and add safe checkpoints.
- **Next target for implementation (after review):**  
  1. Run the scraper once with a real Baltimore permit number and collect all logs and artifacts from `scraper-service/` and `scraper-service/debug/`.  
  2. From the last checkpoint screenshot and logs, confirm:  
     - Whether the records list is in main frame or iframe.  
     - Whether the permit link is found and clicked.  
     - Whether the record detail page loads and in which frame.  
  3. If the record detail step fails, adjust selectors or frame targeting in `searchPermit` / `waitForRecordDetailStrong` / `getExtractionContext` for Baltimore (or add Baltimore-specific branches only if necessary).  
  4. If the record detail loads but extractors return empty data, compare Baltimore’s DOM with the selectors in `extractRecordHeader`, `extractRecordDetails`, etc., and add or relax selectors without breaking other Accela portals.

---

**End of handoff.**
