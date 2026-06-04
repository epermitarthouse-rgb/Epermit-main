# Arlington County Accela Implementation Prompts

Use these prompts in order. The goal is to add Arlington County support by reusing the existing Accela framework, not by creating a duplicate scraper.

---

## Prompt 1 — Fix Arlington portal config URL

```md
# Step 1 — Fix Arlington Portal Config URL

We are adding Arlington County support for the Accela portal.

Important discovery:
The correct production Arlington Accela tenant is:

https://aca-prod.accela.com/ARLINGTONCO

Not:

https://aca-prod.accela.com/ARLINGTON

## Task

Search the repo for all Arlington portal URL references:

- `ARLINGTON`
- `ARLINGTONCO`
- `aca-prod.accela.com/ARLINGTON`
- `aca-prod.accela.com/ARLINGTONCO`
- `arlington_county_va`

Known issue from audit:

- `StartFilingDialog.tsx` has a fallback/preset using `https://aca-prod.accela.com/ARLINGTON`
- `permitwizard-auth.js` already appears to use `ARLINGTONCO`
- `PortalCredentialsManager.tsx` may already use `ARLINGTONCO`

## Requirements

1. Replace wrong Arlington URL/path references with `ARLINGTONCO`.
2. Do not change unrelated counties.
3. Do not change scraper behavior yet.
4. Return a short report listing every file changed and every Arlington URL found.

## Success criteria

- No production Arlington config points to `/ARLINGTON`.
- Arlington portal config consistently points to `/ARLINGTONCO`.
- Existing Baltimore/Fairfax/other Accela configs remain unchanged.
```

---

## Prompt 2 — Add Arlington Accela profile, not a new scraper

```md
# Step 2 — Add Arlington Accela Profile Without Duplicating Scraper Framework

We are adding Arlington County support.

Confirmed portal:

- Base URL: `https://aca-prod.accela.com/ARLINGTONCO`
- Agency code: `ARLINGTONCO`
- Platform: Accela Citizen Access
- Dashboard path after login: `/ARLINGTONCO/Dashboard.aspx`
- My Records path: `/ARLINGTONCO/Cap/MyRecordsCap.aspx?TabName=Home&TabList=Home`

Important rule:
Do not create a new Arlington-only scraper framework. Use the existing Accela scraper architecture in `scraper-service/accela-scraper.js`.

## Task

Add Arlington as a small Accela tenant profile/config.

Preferred approach:
Use a tenant config/profile object if possible instead of adding scattered `if page._isArlington` branches everywhere.

Suggested Arlington config:

```js
{
  key: "arlington_county_va",
  agencyCode: "ARLINGTONCO",
  baseUrl: "https://aca-prod.accela.com/ARLINGTONCO",
  myRecordsPath: "/ARLINGTONCO/Cap/MyRecordsCap.aspx?TabName=Home&TabList=Home",
  recordInfoLabels: ["Record Info", "Record Details", "Record Detail"],
  usesAttachmentIframe: true,
  attachmentIframeSelector: "#ctl00_PlaceHolderMain_attachmentEdit_iframeAttachmentList",
  attachmentGridId: "attachmentList_gdvAttachmentList",
  planReview: {
    enabled: true,
    topTabLabels: ["Plan Review"],
    expectedTabs: [
      "Plans & Documents",
      "Review Results & Mark-ups",
      "Approved Documents",
      "Project Information"
    ],
    allowUnusedMessage: true
  }
}
```

## Requirements

1. Add Arlington detection/profile in the existing Accela flow.
2. Do not create a full separate scraper implementation.
3. If a thin wrapper is needed for routing consistency, it must only call/re-export the shared Accela scraper.
4. Keep existing Baltimore/Fairfax behavior unchanged.
5. Add clear logs when Arlington profile is detected.

## Success criteria

- Arlington is recognized as an Accela tenant.
- Existing Accela scraper is still the core implementation.
- No duplicated login/list/detail/download logic is introduced.
```

---

## Prompt 3 — Reuse existing Accela login/session flow

```md
# Step 3 — Reuse Existing Accela Login Flow for Arlington

We need to validate Arlington login using the existing Accela login/session flow.

Confirmed expected login result:

- Portal: `https://aca-prod.accela.com/ARLINGTONCO`
- After login should land on or be able to reach: `/ARLINGTONCO/Dashboard.aspx`
- Page title: `Accela Citizen Access`

## Task

Smoke-test Arlington login through the existing Accela login function.

## Requirements

1. Use existing `accelaLogin` logic.
2. Do not introduce Arlington-specific login code unless login fails and diagnostics prove a real difference.
3. Add/verify logs for:
   - login URL reached
   - username field detected
   - password field detected
   - submit clicked
   - post-login URL
   - dashboard/auth landmark detected
4. Preserve existing waits and recovery behavior. Do not remove waits as an optimization.

## Success criteria

- Arlington login succeeds using the shared Accela login flow.
- Session reaches authenticated dashboard or authenticated My Records page.
- No changes break Baltimore/Fairfax login.

## If login fails

Return diagnostics only:

- current URL
- visible form fields
- frame list
- login button selectors found
- error text from page
- screenshot path if available

Do not guess or rewrite login flow blindly.
```

---

## Prompt 4 — Record list extraction from My Records

```md
# Step 4 — Arlington My Records List Extraction

Live discovery confirmed Arlington records are available from:

`/ARLINGTONCO/Cap/MyRecordsCap.aspx?TabName=Home&TabList=Home`

Main record grids discovered:

- `ctl00_PlaceHolderMain_CapList2_gdvPermitList`
- `ctl00_PlaceHolderMain_CapList4_gdvPermitList`

The page has Accela-style pagination, including Building records showing `1–10 of 78` with pages `1 2 3 4 5 6 7 8 Next >`.

## Task

Reuse the existing Accela record-list extraction logic for Arlington.

## Extract per record

- Record Number
- Record Type
- Date
- Expiration Date
- Status
- Action text
- Address
- hidden RecordId if available
- direct `CapDetail.aspx` URL
- module/category if inferable, such as Building/Zoning

## Requirements

1. Navigate directly to the Arlington My Records path after login.
2. Parse both Arlington grids listed above.
3. Reuse existing Accela pagination logic.
4. Skip or classify incomplete `Resume Application` rows safely.
5. Do not fail if one grid is absent on some accounts.
6. Add logs for:
   - grid found/missing
   - rows parsed per grid
   - pagination pages visited
   - record detail links found

## Success criteria

- At least Building records are parsed.
- Zoning records are parsed if present.
- Pagination reaches all available pages without duplicate rows.
- Output includes direct `CapDetail.aspx` links.
- Existing Baltimore/Fairfax list parsing is unchanged.
```

---

## Prompt 5 — Open record detail and extract Record Info

```md
# Step 5 — Arlington Record Detail and Record Info Extraction

Arlington record detail URLs use standard Accela `CapDetail.aspx` shape, for example:

`/ARLINGTONCO/Cap/CapDetail.aspx?Module=Building&TabName=Building&capID1=...&capID2=...&capID3=...&agencyCode=ARLINGTONCO`

Top tabs discovered on record detail:

- Record Info
- Payments
- Plan Review

Important difference:
Existing code may expect `Record Details` or `Record Detail`; Arlington uses `Record Info`.

## Task

Reuse existing Accela detail extraction, but add `Record Info` as a valid tab/nav label.

## Extract

- record header
- application/project information
- ASI/custom fields
- address
- status
- record metadata
- visible Record Info fields

## Requirements

1. Open direct `CapDetail.aspx` links from record list.
2. Wait for record detail load using existing strong detail detection.
3. Add safe support for `Record Info` label wherever existing detail extraction expects `Record Details`.
4. Preserve existing behavior for Baltimore/Fairfax/generic Accela.
5. Add logs:
   - record detail URL opened
   - record number detected
   - detail frame/page detected
   - Record Info tab/section found
   - field count extracted

## Success criteria

- Arlington record detail opens correctly.
- Record Info fields are extracted.
- Missing optional fields do not fail the scrape.
- No regression for existing Accela jurisdictions.
```

---

## Prompt 6 — Record Info attachments via iframe

```md
# Step 6 — Arlington Record Info Attachments via Accela Attachment Iframe

Live discovery confirmed Arlington attachments are inside an iframe, not directly in the parent `CapDetail.aspx` page.

Confirmed iframe:

`#ctl00_PlaceHolderMain_attachmentEdit_iframeAttachmentList`

Confirmed iframe URL pattern:

`/FileUpload/AttachmentsList.aspx?iframeid=ctl00_PlaceHolderMain_attachmentEdit&module=Building&...&agencyCode=ARLINGTONCO...`

Confirmed iframe title:

`Attachment list`

Confirmed attachment grid:

`attachmentList_gdvAttachmentList`

Attachment filename links trigger WebForms postback, for example:

`javascript:__doPostBack('attachmentList$gdvAttachmentList$ctl02$lnkFileName','')`

## Task

Route Arlington attachment extraction through the existing iframe/WebForms attachment handling path, similar to Baltimore/Fairfax where appropriate.

## Extract per attachment

- file name
- document type/category if visible
- uploaded date if visible
- status if visible
- row index
- filename link selector/id
- available row actions such as Actions, View Details, Delete if visible

## Download behavior

For each downloadable filename link inside the iframe:

1. Locate iframe frame.
2. Locate file-name link.
3. Wrap click with `page.waitForEvent("download")`.
4. Save file using existing storage/download pipeline.
5. Validate file is non-empty and has expected extension/content type when possible.

## Requirements

1. Do not use raw URL guessing for downloads.
2. Use Playwright download event around the iframe click.
3. Handle attachment iframe pagination.
4. Continue if one attachment fails; collect error per file.
5. Add logs:
   - iframe found/missing
   - attachment grid found/missing
   - rows found
   - attachment pages visited
   - downloads attempted/succeeded/failed

## Success criteria

- Arlington attachments are listed from iframe grid.
- Attachment PDFs/documents download successfully.
- Attachment pagination is handled.
- Existing Baltimore/Fairfax attachment behavior remains unchanged.
```

---

## Prompt 7 — Plan Review extraction

```md
# Step 7 — Arlington Plan Review Extraction

Arlington record detail has a top-level `Plan Review` tab.

Client wants Plan Review included.

Known behavior from discovery:
Some records may show:

`This record does not use plan review.`

This must be handled as a non-fatal status.

Expected Plan Review tabs when available:

- Plans & Documents
- Review Results & Mark-ups
- Approved Documents
- Project Information

## Task

Add Arlington Plan Review extraction using the existing Accela extraction framework where possible.

## Flow

1. Open record detail page.
2. Click/open `Plan Review` tab.
3. Detect whether the record uses Plan Review.
4. If unused, store a clean `planReview.used = false` result and continue.
5. If available, extract the expected sub-tabs.

## Extract from each Plan Review tab

### Plans & Documents
- document names
- status/version if visible
- uploaded/submitted dates if visible
- download/view links if available

### Review Results & Mark-ups
- review discipline/name if visible
- review result/status
- comments/markup document names
- dates
- download/view links if available

### Approved Documents
- approved file names
- approval dates/statuses
- download/view links if available

### Project Information
- visible project info fields
- key/value tables
- project metadata

## Download behavior

Use click + `page.waitForEvent("download")` for downloadable files. Do not guess raw URLs.

## Requirements

1. Plan Review must be included in output.
2. Do not fail the whole scraper if a record does not use Plan Review.
3. Do not skip Record Info attachments because Plan Review exists.
4. Add logs:
   - Plan Review tab found/missing
   - unused message detected
   - each sub-tab found/missing
   - rows/documents extracted
   - downloads attempted/succeeded/failed
5. Preserve existing Baltimore/Fairfax behavior, especially if they intentionally skip Plan Review in minimal-tab mode.

## Suggested output shape

```js
planReview: {
  used: true | false,
  message: string | null,
  tabs: {
    plansAndDocuments: [],
    reviewResultsAndMarkups: [],
    approvedDocuments: [],
    projectInformation: {}
  },
  errors: []
}
```

## Success criteria

- Plan Review is checked for every Arlington record.
- If unused, scraper saves non-fatal status.
- If used, scraper extracts visible tab data and downloads available files.
```

---

## Prompt 8 — Optional existing Accela sections: payments, inspections, processing

```md
# Step 8 — Reuse Optional Existing Accela Sections

Arlington record detail includes top-level tabs such as:

- Record Info
- Payments
- Plan Review

The primary required scope is:

- Record Info details
- Record Info attachments
- Plan Review

Optional existing Accela extractors may already support:

- payments
- inspections
- processing/status history

## Task

Reuse existing optional Accela extractors for Arlington if they already work safely.

## Requirements

1. Do not make optional tabs blockers.
2. Do not build large new logic for payments/inspections unless already supported generically.
3. If an optional section is missing or empty, store an empty result or status and continue.
4. Keep client-confirmed scope focused on Record Info, Attachments, and Plan Review.
5. Add logs only where helpful.

## Success criteria

- Existing optional extractors run safely if applicable.
- Missing optional sections do not fail Arlington scrape.
- Core Arlington output is still produced even if payments/inspections are empty.
```

---

## Prompt 9 — Normalize Arlington output into existing portal_data shape

```md
# Step 9 — Normalize Arlington Output Into Existing Accela portal_data Shape

Arlington should save into the existing Accela output structure. Do not create a new DB schema unless the existing structure cannot represent Plan Review.

## Expected output sections

Use existing naming where already established:

- `portalType: "accela"`
- `tabs.info`
- `attachments`
- `planReview`
- `reports` or `documents` if the existing model uses those
- `payments` / `inspections` only if existing extractors populate them

## Task

Ensure Arlington output is normalized consistently with Baltimore/Fairfax/generic Accela output.

## Requirements

1. Preserve existing `portal_data` shape used by the frontend.
2. Add `planReview` without breaking existing viewers.
3. Include attachment metadata and storage/download references.
4. Include scrape diagnostics:
   - records parsed
   - attachments found/downloaded
   - Plan Review used/unused
   - errors/warnings
5. Avoid schema changes unless absolutely necessary.

## Success criteria

- Arlington scrape result can be displayed by existing PortalDataViewer/Accela viewer.
- Attachments appear in the expected files/documents area.
- Plan Review result is available in `portal_data`.
- Existing Accela jurisdictions still produce the same output shape as before.
```

---

## Prompt 10 — Smoke test and QA

```md
# Step 10 — Arlington Smoke Test and QA

Now test Arlington end-to-end.

Known test record from discovery:

`CTBO26-01812`

Known portal:

`https://aca-prod.accela.com/ARLINGTONCO`

## Test 1 — Known record with Record Info attachments

Run Arlington scrape for:

`CTBO26-01812`

Expected flow:

1. Login succeeds.
2. Dashboard or authenticated page reached.
3. My Records opens:
   `/ARLINGTONCO/Cap/MyRecordsCap.aspx?TabName=Home&TabList=Home`
4. Record list grids are parsed:
   - `ctl00_PlaceHolderMain_CapList2_gdvPermitList`
   - `ctl00_PlaceHolderMain_CapList4_gdvPermitList`
5. Record `CTBO26-01812` is found.
6. `CapDetail.aspx` opens.
7. Record Info is extracted.
8. Attachment iframe is found:
   `#ctl00_PlaceHolderMain_attachmentEdit_iframeAttachmentList`
9. Attachment grid is parsed:
   `attachmentList_gdvAttachmentList`
10. Attachment files download through iframe filename click + `page.waitForEvent("download")`.
11. Plan Review is checked.
12. If page says `This record does not use plan review`, save non-fatal status.

## Test 2 — Record with active Plan Review

Find or request a sample Arlington record that actually uses Plan Review.

Expected:

1. Plan Review tab opens.
2. These tabs are detected/extracted if present:
   - Plans & Documents
   - Review Results & Mark-ups
   - Approved Documents
   - Project Information
3. Available files/downloads are captured.

If no active Plan Review record is visible, output:

`Plan Review extraction implemented and unused-state verified. Active Plan Review tab extraction requires client-provided sample record.`

## QA checks

Compare Arlington output against existing Accela output shape.

Check:

- no duplicate scraper framework created
- no Baltimore/Fairfax regressions
- URL uses `ARLINGTONCO`, not `ARLINGTON`
- record list pagination works
- record detail opens
- Record Info extracted
- attachments iframe parsed
- files downloaded
- Plan Review included and non-blocking
- frontend can display result without custom rebuild

## Required final report

Return a concise QA report:

| Check | Result | Evidence / Log |
|---|---|---|
| Login | Pass/Fail | URL/log |
| My Records | Pass/Fail | grid IDs |
| Record found | Pass/Fail | record number |
| Detail opened | Pass/Fail | CapDetail URL |
| Record Info | Pass/Fail | field count |
| Attachments listed | Pass/Fail | row count |
| Attachments downloaded | Pass/Fail | file count |
| Plan Review checked | Pass/Fail | used/unused/tabs |
| Supabase/output saved | Pass/Fail | project/run ID |
| Frontend display | Pass/Fail | screenshot/log |
```
