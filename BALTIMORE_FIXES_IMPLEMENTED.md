# Baltimore Fixes Implemented (Diagnosis-Based)

## Exact files changed

| File | Change |
|------|--------|
| **`src/components/baltimore/BaltimorePortalDataView.tsx`** | (1) Plan Review comment rendering updated to use scraper shape and optional metadata. (2) DEV debug card removed from JSX. |

No other files were modified. Scraper, PortalDataViewer, layout, and generic Accela view are unchanged.

---

## Exact fix made

### 1. Plan Review mapping (confirmed bug)

- **Before:** Each comment was rendered as `(c as { text?: string }).text ?? ""`. Scraper provides `{ reviewer, department, comment, date }`, so `.text` was always undefined and the UI showed blank lines.
- **After:**
  - Comment text: use **`.comment`** with fallback to **`.text`** for backward compatibility (`item.comment ?? item.text ?? ""`).
  - Metadata: when present, render **reviewer**, **department**, and **date** on a single muted line above the comment text (joined by " · ").
  - Each comment is a list item with optional meta line + comment body; list spacing and a light border between items for readability.
- **Scope:** Only the Plan Review panel content; no change to header, record details, status, related records, attachments, inspections, or fees.

### 2. DEV debug card removed from page UI

- **Removed:** The entire `{import.meta.env.DEV && ( <Card>...[DEV] Baltimore portal-data binding...</Card> )}` block that rendered the debug card in the component tree.
- **Retained:** The existing `useEffect` that calls `console.log("[BaltimorePortalDataView] binding", { ... })` when `import.meta.env.DEV` is true. Debug information remains available in the console only; nothing is rendered in the page for it.

---

## Scraper-side stale-data behavior

- **Changed:** No. No edits were made to `scraper-service/accela-scraper.js` or any scraper logic.
- **Reported:** Hash-skip behavior was reviewed and documented in **BALTIMORE_PORTAL_DATA_DIAGNOSIS.md** (section 6). Summary: skipping the write when `portal_data_hash === newHash` is intentional; it only keeps existing data when the **new** scrape result is identical. Any change in scraper output or portal content produces a new hash and triggers a write. No minimal fix was proposed because the current behavior is correct and does not cause Baltimore-specific staleness.

---

## What remains a scraper data-completeness issue (not frontend)

- **Empty or sparse sections** (Record Details with only one field, Processing Status “link not found”, Related Records / Attachments / Inspections / Fees empty) are due to scraper extraction or panel availability (e.g. dropdown not opened, link not found, or no data on the portal). The frontend key paths for these sections already match the scraper; no further frontend change was made for them.
- **Stale portal_data** when the user does not re-run a scrape after a scraper fix is a product/flow expectation (user must run a new scrape to refresh). Hash-skip does not prevent the first write after a scraper change.

---

## Validation checklist

- **Baltimore embedded mode (/portal-data):** Still works; Baltimore view is shown when the selected project’s credential is Baltimore Accela; no changes to that logic.
- **Standalone /baltimore routes:** Unaffected; no edits to BaltimoreLayout, BaltimoreNav, or route components.
- **Plan Review comments:** When scraper data has `tabs.reports.pdfs[].comments` with `{ comment, reviewer, department, date }`, the panel now shows the comment text and, when present, reviewer/department/date above it. Backward compatibility with `.text` is preserved.
- **DEV card:** No longer rendered in the page UI during local development; console logging in DEV is still in place.
