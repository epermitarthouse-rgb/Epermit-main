# Baltimore /portal-data — Strict Diagnosis Report

**Scope:** Why most visible fields are empty in the Baltimore embedded view and why the "[DEV] Baltimore portal-data binding" block appears in the UI. No fixes applied.

---

## 1. End-to-end data path

### 1.1 Where scraper output is generated

- **File:** `scraper-service/accela-scraper.js`
- **Function:** `scrapeAccelaRecord` (lines ~1908–2280)
- **Object built:** `portalData` (lines 1992–2178) is a single object built from:
  - `header` = `extractRecordHeader(page)` → `{ record_number, record_type, record_status, expiration_date }` (_diag deleted before return; see lines 883–884)
  - `details` = `extractRecordDetails(page)` → `{ tables, fields, screenshot }`
  - `processingStatus` = `extractProcessingStatus(page)` → `{ departments, screenshot }`
  - `planReview` = `extractPlanReview(page)` → `{ comments, text, screenshot }`
  - `relatedRecords`, `attachments`, `inspections`, `payments` from their extractors

- **Exact shape produced** (excerpt):

```js
// accela-scraper.js lines 1992–2178 (condensed)
const portalData = {
  portalType: "accela",
  name: header.record_number || permitNumber,
  projectNum: permitNumber,
  description: header.record_type || "",
  location: details.fields["Work Location"] || details.fields["Address"] || ...,
  dashboardStatus: header.record_status || "",
  tabs: {
    info: {
      tables: details.tables,           // [{ title: "Record Details", headers: ["Field","Value"], rows: [{ key, value }] }]
      fields: header,                   // { record_number, record_type, record_status, expiration_date }
      keyValues: [ ... ],
      screenshot: details.screenshot,
    },
    status: {
      departments: processingStatus.departments,  // [{ name, status, statusIcon, date, details }]
      tables: [ { title: "Processing Status", headers: [...], rows: processingStatus.departments } ],
      ...
    },
    reports: {
      pdfs: [
        ...,
        { fileName: "Plan Review - Review Comments", text: planReview.text, comments: planReview.comments, ... },
      ],
      ...
    },
    attachments: { tables: [{ title: "Attachments", headers: [...], rows: attachments.attachments }], ... },
    inspections: { tables: [ { title: "Upcoming/Completed/Inspections", rows: ... } ], ... },
    payments: { tables: [{ title: "Payments", headers: [...], rows: payments.payments }], ... },
    relatedRecords: { tables: [{ title: "Related Records", headers: [...], rows: relatedRecords.records }], ... },
  },
};
```

### 1.2 Where scraper output is persisted

- **File:** `scraper-service/accela-scraper.js` (same module)
- **Logic:** After building `portalData`, `scrapeAccelaRecord`:
  - Resolves `existingRow` by `supabaseProjectId` or by `permit_number` + `user_id` (lines 2188–2204).
  - If `existingRow.portal_data_hash === newHash`: only updates `last_checked_at`; **does not write new `portal_data`** (lines 2206–2213).
  - Else updates or inserts the project with `portal_data: portalData` (lines 2214–2259).
- **No server-side transform:** For Accela, `server.js` does not reshape `portal_data`; it is stored as returned by `scrapeAccelaRecord`. The merge/merge logic in `server.js` (e.g. around 1433–1472) is for the ProjectDox flow, not for Accela.

### 1.3 Where portal_data is fetched for the selected Baltimore project

- **File:** `src/pages/PortalDataViewer.tsx`
- **When:** `fetchData` (useCallback, lines 222–372) runs when `user` or `selectedProjectId` changes; also triggered by the effect that depends on `user`, `authLoading`, `navigate`, `fetchData` (lines 464–470).
- **Fetch:**

```ts
// PortalDataViewer.tsx lines 246–255
const { data, error } = await supabase
  .from("projects")
  .select("id, portal_data, portal_status, last_checked_at, permit_number, credential_id")
  .eq("id", selectedProjectId)
  .eq("user_id", user.id)
  .maybeSingle();
project = data as typeof project;
```

- **State:** `setPortalData(pd)` is called with `pd = (project.portal_data as PortalData) || null` (line 329) when there is no type mismatch. So the object in React state is the raw `project.portal_data` from Supabase (i.e. the same shape the scraper wrote, modulo JSON round-trip).

### 1.4 What exact object is passed into BaltimorePortalDataView

- **File:** `src/pages/PortalDataViewer.tsx` (lines 638–644)

```tsx
<BaltimorePortalDataView
  portalData={portalData as any}
  projectId={resolvedProjectId}
  permitNumber={portalData?.projectNum ?? portalData?.name ?? null}
  credentialLoginUrl={credentialForView?.login_url ?? null}
/>
```

- **Conclusion:** `portalData` is the same reference (or copy of) `project.portal_data` that was loaded for `selectedProjectId` and set into state. No intermediate normalization or mapping is applied.

### 1.5 What exact fields BaltimorePortalDataView reads

- **File:** `src/components/baltimore/BaltimorePortalDataView.tsx`

| Line(s) | Variable / UI | Key path read |
|--------|----------------|----------------|
| 52–56 | `header`, `recordNumber`, `recordType`, `recordStatus`, `expirationDate` | `portalData.tabs?.info?.fields` (then `.record_number`, `.record_type`, `.record_status`, `.expiration_date`); fallbacks `portalData.name`, `.projectNum`, `.description`, `.dashboardStatus` |
| 58–59 | `infoKeyValues`, `infoTables` | `portalData.tabs?.info?.keyValues`, `portalData.tabs?.info?.tables` |
| 60 | `departments` | `portalData.tabs?.status?.departments` |
| 61–62 | `relatedTables`, `relatedRows` | `portalData.tabs?.relatedRecords?.tables`, then `t.rows` |
| 63–64 | `attachmentTables`, `attachmentRows` | `portalData.tabs?.attachments?.tables`, then `t.rows` |
| 65–66 | `inspectionTables`, `inspectionRows` | `portalData.tabs?.inspections?.tables`, then `t.rows` |
| 67–68 | `paymentTables`, `paymentRows` | `portalData.tabs?.payments?.tables`, then `t.rows` |
| 69–71 | `planReviewPdfs`, `planReviewComments` | `portalData.tabs?.reports?.pdfs`, then `p.comments` |
| 73–76 | `recordDetailRows`, `recordDetailItems` | `infoTables.find(t => /record detail/i.test(t.title))?.rows ?? infoTables[0]?.rows`; row shape `r.key`/`r.value` or `r.Field`/`r.Value`; else `infoKeyValues` |
| 218–224 | Plan Review panel | Renders `planReviewComments`; each item as `(c as { text?: string }).text ?? ""` |

---

## 2. Runtime data shape vs expectations

- **Source of truth for “actual” shape:** The structure produced in `accela-scraper.js` (section 1.1) and stored in `projects.portal_data` for Accela. The frontend does not transform it; it only reads it.
- **Header / record number / type / status / expiration:** Scraper sets `tabs.info.fields = header` (after deleting `_diag`). So at runtime we have `portalData.tabs.info.fields.record_number`, `.record_type`, `.record_status`, `.expiration_date`. Same keys the frontend uses. **Match.**
- **Info / record details:** Scraper sets `tabs.info.tables = details.tables`; `details.tables` is either one table with `title: "Record Details"`, `rows: [{ key, value }]` or `[]`. Frontend uses `infoTables.find(t => /record detail/i.test(t.title))?.rows ?? infoTables[0]?.rows` and then `r.key`/`r.value`. **Match.**
- **Status / departments:** Scraper sets `tabs.status.departments` and `tabs.status.tables[].rows` to the same department objects `{ name, status, statusIcon, date, details }`. Frontend reads `portalData.tabs?.status?.departments`. **Match.**
- **Related records:** Scraper sets `tabs.relatedRecords.tables[].rows = relatedRecords.records`. Frontend uses `portalData.tabs?.relatedRecords?.tables` and flatMaps `t.rows`. **Match.**
- **Attachments / inspections / payments:** Same idea: scraper writes `tabs.attachments.tables[].rows`, `tabs.inspections.tables` (array of tables with `.rows`), `tabs.payments.tables[].rows`. Frontend flatMaps `tables` and uses `t.rows`. **Match.**
- **Reports / plan review:** Scraper pushes into `tabs.reports.pdfs` an entry `{ fileName: "Plan Review - Review Comments", text: planReview.text, comments: planReview.comments, ... }`. So at runtime each pdf entry has `.comments` = `planReview.comments`. In `extractPlanReview`, each comment is `{ reviewer, department, comment, date }` (accela-scraper.js lines 1216–1221). There is **no** `.text` on each comment object. The frontend does `planReviewComments.map(c => (c as { text?: string }).text ?? "")`, so it expects each comment to have a `.text` property. **Mismatch:** actual shape is `{ reviewer, department, comment, date }`; frontend expects `{ text }`. So even when plan review data exists, the UI will show empty strings for each comment line.

---

## 3. Expected vs actual (table)

| UI section | Expected key path (component) | Actual key path (scraper → DB) | Mismatch? |
|------------|--------------------------------|--------------------------------|------------|
| Record number (header) | `tabs.info.fields.record_number` or `name` or `projectNum` | `tabs.info.fields.record_number` (from header); top-level `name`, `projectNum` | **No** — keys align. Empty only if scraper did not populate header. |
| Record type | `tabs.info.fields.record_type` or `description` | Same | **No** |
| Record status | `tabs.info.fields.record_status` or `dashboardStatus` | Same | **No** |
| Expiration | `tabs.info.fields.expiration_date` | Same | **No** |
| Record Details (panel) | `tabs.info.tables` (title “Record Details”) → `.rows` with `.key`/`.value` or `.Field`/`.Value`; else `tabs.info.keyValues` | Same | **No** — structure matches. Empty if scraper returned `details.tables = []` or `details.fields = {}`. |
| Processing Status | `tabs.status.departments` | Same | **No** — empty if “Processing Status” link not found or panel empty. |
| Related Records | `tabs.relatedRecords.tables[].rows` | Same | **No** |
| Attachments | `tabs.attachments.tables[].rows` | Same | **No** |
| Inspections | `tabs.inspections.tables[].rows` | Same | **No** |
| Fees | `tabs.payments.tables[].rows` | Same | **No** |
| Plan Review | `tabs.reports.pdfs[].comments`; each item **`.text`** | `tabs.reports.pdfs[].comments`; each item **`.comment`** (and `.reviewer`, `.department`, `.date`) | **Yes** — frontend reads `.text`; scraper provides `.comment` (and other fields). Plan Review panel will show blank lines even when comments exist. |

- **Wrong project selected:** Unlikely if the user is on the same project they scraped. Data is loaded by `selectedProjectId`; the scraper updates the project identified by `projectId`/permit. If a different project is selected, that project’s `portal_data` would be shown (possibly empty or from an older scrape). That would be a product/flow issue, not a key-path bug.
- **Stale/cached portal_data:** Possible. If the last scrape run produced the same hash, the scraper skips writing `portal_data` and only updates `last_checked_at`. So the DB can hold an older payload (e.g. from a run where many panels were “link not found” or empty). That would explain “most fields empty” if the **first** successful scrape had sparse extraction.
- **Wrong prop passed down:** No. The same `portalData` from state (sourced from `project.portal_data`) is passed as `portalData={portalData}`.
- **Scraper output shape mismatch:** Only for Plan Review comments: scraper sends `{ reviewer, department, comment, date }`, frontend expects `{ text }`.
- **Frontend mapping mismatch:** Yes for Plan Review (`.text` vs `.comment`). All other sections use the same paths and shapes as the scraper.
- **Empty source data from scraper:** Very plausible. Logs like “Record Details: 1 field”, “Processing Status: link not found”, “Related Records: link not found”, etc., mean the persisted `portal_data` has empty arrays or minimal content for those sections. So “most visible fields are empty” can be due to **scraper extraction returning empty or missing data** for many panels, not only a frontend bug.

---

## 4. DEV block

- **What:** The visible “[DEV] Baltimore portal-data binding” block (projectId, permitNumber, credentialLoginUrl, Baltimore mode, portalData.name, projectNum, portalType, tabs.info.fields count, tabs.status.departments count, tabs.reports.pdfs count).
- **Where:** `src/components/baltimore/BaltimorePortalDataView.tsx`, lines 237–265.
- **Code path:** Inside the same `return` of `BaltimorePortalDataView`, after the main `<Card>` that contains the tab bar and panel content; rendered as a sibling inside the same `<div className="space-y-6">` that wraps the record card and the card with `BaltimoreRecordTabBar`.
- **Condition:** Wrapped in `{import.meta.env.DEV && ( ... )}`. So it only renders when the app is built/run with Vite’s dev mode (e.g. `npm run dev`), where `import.meta.env.DEV` is true. It is **not** gated by any other flag.
- **Part of component tree:** Yes. It is real JSX in the component’s return, so it appears in the actual page UI whenever the Baltimore portal-data view is shown and `import.meta.env.DEV` is true. In production builds, `import.meta.env.DEV` is false, so this block is not rendered.

---

## 5. Conclusion

- **Empty fields:** Largely explained by **empty or sparse scraper output** (many panels “link not found” or “panel empty”) and/or **stale portal_data** when the scraper skips the write due to hash match. Key paths and shapes for header, record details, status, related records, attachments, inspections, and payments **match** between scraper and frontend; there is no evidence of wrong project or wrong prop.
- **Plan Review:** There is a **frontend mapping issue**: the component expects each plan review comment to have `.text`, but the scraper provides `.comment` (and `.reviewer`, `.department`, `.date`). So even when plan review data exists, the UI shows blank lines.
- **DEV block:** It appears in the UI because it is rendered inside `BaltimorePortalDataView` when `import.meta.env.DEV` is true; it is part of the normal component tree, not a separate route or overlay.

**Single clear conclusion:** **Combination of (1) empty/sparse source data from scraper (and possibly stale cached portal_data) and (2) one frontend mapping issue (Plan Review comments: .text vs .comment).**

---

## 6. Hash-skip (stale portal_data) investigation

- **Location:** `scraper-service/accela-scraper.js` lines 2206–2213.
- **Behavior:** When `existingRow.portal_data_hash === newHash`, the scraper only updates `last_checked_at` and does **not** write `portal_data`. So the row keeps the previous `portal_data`.
- **When hash matches:** The hash is computed from the **current** scrape result (`portalData`). So the hash matches only when the new scrape output is **byte-identical** (or hash-identical) to what was last written. That happens when:
  - The scraper returns the same payload (e.g. same empty panels, same one field in Record Details), or
  - No change in extraction logic and the portal page content is unchanged.
- **When hash differs:** Any change in the scrape result (e.g. scraper fix that fills more panels, or portal data changed) produces a different hash, so the code takes the `else if (existingRow)` branch and **writes** the new `portal_data`. So the first successful run after a scraper fix will update the DB.
- **Baltimore-specific staleness:** The logic is the same for all Accela projects; there is no special case for Baltimore. Staleness only occurs when the **new** scrape result is identical to the **old** stored payload. If the user re-runs a scrape and the scraper now returns richer data, the hash will differ and the new data will be written.
- **Conclusion:** Hash-skip is intentional (avoid redundant writes). It does not by itself cause Baltimore records to stay stale after a scraper fix or portal change. No scraper-side change was made; this is reported only.
