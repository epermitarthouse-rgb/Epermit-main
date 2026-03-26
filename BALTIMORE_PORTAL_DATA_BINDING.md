# Baltimore Portal Data Binding — Report

## A. Files updated

| File | Change |
|------|--------|
| **`src/components/baltimore/BaltimoreNav.tsx`** | Added `showSearchApplicationsLink?: boolean` (default `true`). When `false`, the "Search Applications" link and its separator are not rendered. |
| **`src/components/baltimore/BaltimoreLayout.tsx`** | Added `showSearchApplicationsLink?: boolean`, passed through to `BaltimoreNav`. |
| **`src/components/baltimore/BaltimorePortalDataView.tsx`** | (1) New optional props: `projectId`, `permitNumber`, `credentialLoginUrl`; when `projectId` is set, treated as embedded in /portal-data. (2) Uses `BaltimoreLayout` with `showSearchApplicationsLink={!isEmbeddedInPortalData}` so no Search Applications CTA when embedded. (3) All displayed values come from `portalData` only; record number shows "—" when missing. (4) DEV-only debug card at bottom: projectId, permitNumber, credentialLoginUrl, Baltimore mode, key portalData fields. (5) DEV-only `console.log` of same binding summary. |
| **`src/pages/PortalDataViewer.tsx`** | When rendering `BaltimorePortalDataView`, passes `projectId={resolvedProjectId}`, `permitNumber={portalData?.projectNum ?? portalData?.name ?? null}`, `credentialLoginUrl={credentialForView?.login_url ?? null}`. |

---

## B. What fake/placeholder behavior was removed

- **Search Applications CTA:** The Baltimore view inside /portal-data no longer shows the "Search Applications" nav link. That link sent users to `/baltimore/records` (demo records list). In portal-data context the user is already viewing the **selected** record; there is no CTA to browse other records.
- **Layout mode:** When used from /portal-data we pass `projectId`, so `showSearchApplicationsLink` is false and the nav is simplified (Permits and Inspections only, no Search Applications).
- **No mock data:** The component already used only `portalData`; no hardcoded mock values were present. Confirmed: all header and section values are from `portalData.tabs.*` or `portalData.*`. Empty sections show explicit empty states ("No record details available.", "No processing status data.", etc.) instead of placeholder content.
- **Record number empty state:** When `recordNumber` is missing, the UI now shows "—" instead of a blank line.

---

## C. How selected record context is now used

- **Single source of truth:** The record shown is the one for the **selected project** in the sidebar. `PortalDataViewer` loads `portal_data` for `selectedProjectId`; that same `portal_data` is passed to `BaltimorePortalDataView`. No separate record selection exists on the page.
- **Context passed down:** For the embedded (portal-data) case we pass:
  - **projectId** = `resolvedProjectId` (the project whose portal data is displayed)
  - **permitNumber** = `portalData.projectNum ?? portalData.name` (the scraped permit/record identifier)
  - **credentialLoginUrl** = credential’s `login_url` (so dev debug can show which credential is used)
- **Embedded vs standalone:** If `projectId` is provided, the view is "embedded" (portal-data): Search Applications is hidden and the dev block shows "embedded (portal-data)". Standalone use (e.g. `/baltimore/records/:id` with mock data) does not pass `projectId`, so the full nav including Search Applications remains available there.

---

## D. Which fields are now truly bound from scraped portalData

| Section / UI | Source in portalData | Notes |
|--------------|----------------------|--------|
| Record number (header) | `tabs.info.fields.record_number` or `name` or `projectNum` | Fallback chain within portalData only; shows "—" if all missing. |
| Record type | `tabs.info.fields.record_type` or `description` | |
| Record status | `tabs.info.fields.record_status` or `dashboardStatus` | |
| Expiration date | `tabs.info.fields.expiration_date` | |
| Location | `portalData.location` | |
| Record Details (panel) | `tabs.info.tables` (title "Record Details" or first table) or `tabs.info.keyValues` | Rows as key/value; empty state if none. |
| Processing Status | `tabs.status.departments` | name, status, date; empty state if none. |
| Related Records | `tabs.relatedRecords.tables[].rows` | record_number, record_type, status; empty state if none. |
| Attachments | `tabs.attachments.tables[].rows` | name, type, size; empty state if none. |
| Inspections | `tabs.inspections.tables[].rows` | type, status, date; empty state if none. |
| Fees | `tabs.payments.tables[].rows` | description, amount, status; empty state if none. |
| Plan Review | `tabs.reports.pdfs[].comments` | Comment text; empty state if none. |

All of the above are read-only from the `portalData` prop; no mock or invented values are used.

---

## E. Which sections still depend on missing scraper extraction

- **Record Details:** If the scraper does not populate `tabs.info.tables` or `tabs.info.keyValues` (or the table title is not "Record Details"), the panel will show "No record details available." Extraction of all key/value fields from the Record Details panel is required for this to be populated.
- **Processing Status:** Depends on `tabs.status.departments`. If the scraper does not fill this (e.g. Processing Status link/panel not opened or parsed), the panel shows "No processing status data."
- **Related Records / Attachments / Inspections / Fees:** Same idea: each depends on the corresponding `tabs.*` structure. Empty scraper output → empty state message.
- **Plan Review:** Uses `tabs.reports.pdfs[].comments`. If the scraper does not attach comments to the Plan Review pdf entry, the panel shows "No plan review comments."

So any section that still shows an empty state is either not yet extracted by the scraper or not present for that record in the portal.

---

## F. What should be fixed next on scraper side to enrich this view

1. **Record Details:** Ensure the Accela Record Details panel is opened and all label/value pairs (and tables) are written into `portal_data.tabs.info.tables` and/or `portal_data.tabs.info.keyValues` so the Record Details panel in the Baltimore view is populated.
2. **Processing Status:** Ensure Processing Status is opened (Record Info → Processing Status) and workflow/department tasks are written to `portal_data.tabs.status.departments` (name, status, date, details).
3. **Related Records / Attachments / Inspections / Fees:** Ensure each of these panels is opened and the corresponding tables/rows are written to `portal_data.tabs.relatedRecords`, `tabs.attachments`, `tabs.inspections`, `tabs.payments` so the Baltimore sections show data when it exists.
4. **Plan Review:** Ensure Plan Review comments are written into `portal_data.tabs.reports.pdfs[]` with a `comments` array (e.g. `{ text: "..." }`) so the Plan Review panel shows comments when present.
5. **Header fields:** Ensure `portal_data.tabs.info.fields` (or equivalent) includes `record_number`, `record_type`, `record_status`, `expiration_date` so the Baltimore header card is fully populated from one source.

Once the scraper fills these structures, the Baltimore view will show the same data without any frontend changes.
