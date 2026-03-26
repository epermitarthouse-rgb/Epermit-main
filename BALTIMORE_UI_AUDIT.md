# BALTIMORE UI AUDIT

**Date:** 2026-03-18  
**Scope:** Post-login dashboard → Permits and Inspections → records list → record detail → tabs/dropdowns. Audit only; no code changes, no scraping.  
**Target:** Baltimore Accela permit portal UI clone flow (from your screenshots).

---

## 1. Current routes/pages found

| Route | File | Purpose | Current status |
|-------|------|---------|----------------|
| `/auth` | `src/pages/Auth.tsx` | Login/signup | App auth; not Baltimore portal login |
| `/dashboard` | `src/pages/Dashboard.tsx` | Post-login app dashboard | App dashboard (Welcome, projects, agents, subscription, quick actions). **Not** a Baltimore/Accela portal home. |
| `/portal-data` | `src/pages/PortalDataViewer.tsx` | View scraped portal data for selected project | Single-project view: shows one record’s data when `portal_data` exists and type is Accela. No records list. |
| `/portal/:token` | `src/pages/ClientPortal.tsx` | Shared project portal by token | Unrelated (client share link). |
| `/projects` | `src/pages/Projects.tsx` | Project list / management | App projects; not “Permits and Inspections” records. |
| `/permit-wizard-filing` | `src/pages/PermitWizardFiling.tsx` | Multi-municipality filing (incl. Baltimore) | Filing flow; not portal clone UI. |

**There are no routes for:**
- Baltimore portal “home” or “dashboard” after sign-in.
- “Permits and Inspections” page.
- Records list (table of record numbers).
- Record detail by record ID (e.g. `/portal-data/record/:recordId` or `/baltimore/record/:id`).

---

## 2. Existing components found

| Component | File | Purpose | Reusable for Baltimore clone? |
|-----------|------|---------|-------------------------------|
| `AccelaProjectView` | `src/components/portal/AccelaProjectView.tsx` | Renders a **single** Accela record from `portalData` (tabs: Info, Files, Inspections, Links, Plan Review, Payments) | **Partially.** Tab structure and data sections can be adapted. It is **not** a list row nor a “record detail page” with its own route; it is embedded in PortalDataViewer for one project. |
| `PortalDataViewer` | `src/pages/PortalDataViewer.tsx` | Page that loads `project.portal_data` from Supabase and, when type is Accela, renders `AccelaProjectView`. Handles empty/no-permit states. | **Partially.** Logic (project-scoped, single record) does not match target (records list → click record → detail). Can be refactored or a new page can own “record detail” and reuse AccelaProjectView or a variant. |
| Dashboard quick actions / cards | `src/pages/Dashboard.tsx` | Links to Projects, Permit Intelligence, Demos. | **No.** No “Permits and Inspections” card or Baltimore portal entry. |
| App sidebar nav | `src/components/layout/AppSidebar.tsx` | “Portal Harvest” → `/portal-data`. | **No.** No “Permits and Inspections” item; label and flow differ from target. |
| DashboardLayout | `src/components/layout/DashboardLayout.tsx` | Wraps protected pages with sidebar + header. | **Yes.** Any new Baltimore pages can sit inside this layout or a dedicated layout. |

**No dedicated Baltimore components** exist. Baltimore is one of several jurisdictions (e.g. in `StartFilingDialog`, `PortalCredentialsManager`, `PermitWizardFiling`); there is no Baltimore-only UI shell, nav, or styling.

---

## 3. Current UI flow in code

1. **Login**  
   User signs in at `/auth` (Supabase). Redirect goes to app (e.g. `/dashboard`), not to a Baltimore portal home.

2. **Post-login “home”**  
   User lands on **app** Dashboard (`/dashboard`): Welcome message, profile, Agent Workflow Status, Project Health (if project selected), subscription card, Quick Action cards (Projects, Permit Intelligence, Interactive Demos). There is **no** Accela-style portal dashboard and **no** “Permits and Inspections” link.

3. **Reaching portal data**  
   User must open sidebar and click **“Portal Harvest”** → `/portal-data`. There is no in-app link labeled “Permits and Inspections.”

4. **Portal Data page**  
   - **No project selected:** “No project linked” with link to Settings.  
   - **Project selected but no `portal_data`:** “No Accela data yet” (or “No ProjectDox data yet”) and “Run a scrape” messaging.  
   - **Project selected and `portal_data` present and Accela:** Renders **one** record via `AccelaProjectView` (the scraped data for that project).  

   So the app never shows a **list of records**; it shows at most one record per selected project. There is no table of record numbers and no “click record number to open detail” step.

5. **Record-level view**  
   The only “record” view is `AccelaProjectView` inside `PortalDataViewer`: single record, tabbed (Info, Files, Inspections, Links, Plan Review, Payments). It is **project-scoped**, not record-ID-scoped. Related records in the “Links” tab show `record_number` as text (styled as blue) but **are not links** to another route; there is no record-detail-by-ID route.

6. **Data source**  
   All displayed data comes from `project.portal_data` (Supabase). There is no separate “records list” API or “record detail by ID” API in the frontend; scraping is out of scope for this audit.

---

## 4. Comparison against target Baltimore screenshots

| Screen | Target expectation | Current state | Verdict |
|--------|--------------------|----------------|---------|
| **Dashboard / home** | After sign-in, land on Baltimore portal dashboard/home. | App dashboard (projects, agents, subscription). No portal-style home, no Baltimore branding. | **Missing** |
| **Permits and Inspections** | Nav item or entry point that leads to permits/inspections. | No such nav item or page. Closest is “Portal Harvest” → `/portal-data`, which is project-scoped and does not list permits. | **Missing** |
| **Records listing** | Page showing a list/table of records with record number **links**. | No records list page. PortalDataViewer shows at most one record per project; no table of multiple record numbers, no links. | **Missing** |
| **Record detail** | Click a record number → open record detail page. | Single-record view exists only as `AccelaProjectView` embedded in `/portal-data` for the selected project. No route like `/record/:id`; no navigation from “list” to “detail.” | **Partial** (detail content exists; list→detail flow and routing missing) |
| **Detail tabs / dropdowns** | Record Info, Payments, Plan Review; under Record Info, multiple expandable/clickable sections and detailed blocks. | AccelaProjectView has tabs: **Info**, Files, **Inspections**, Links, **Plan Review**, **Payments**. “Record Info” ≈ “Info” (partial match). Payments and Plan Review exist. **Info tab** is a flat grid of key-value pairs, **not** expandable sections. No dropdown/accordion structure under Record Info. | **Partial** (tabs and some content; structure and Record Info sections wrong) |

---

## 5. Visual/design mismatch list

- **Page width / centered layout:** PortalDataViewer uses `max-w-5xl` and `py-6 px-4 sm:px-6`; no Baltimore/Accela-specific width or centering. Target may require different max-width or layout (assumption: confirm from screenshots).
- **Top utility nav:** No Accela-style top bar (e.g. user menu, help, jurisdiction switcher). App uses DashboardLayout (sidebar + main content), not a portal top nav.
- **Tab bar structure:** AccelaProjectView uses shadcn `Tabs` with a horizontal `TabsList` (`bg-[#0D1E38] border-[#1A3055]`). Tab order/labels differ from target (e.g. “Info” vs “Record Info”; “Files” and “Inspections” and “Links” may or may not match target). No Baltimore-specific tab styling or hierarchy.
- **Records table:** No records table exists; therefore no table layout, column widths, or row styling to compare.
- **Record detail hierarchy:** Single card for record header (record number, type, status, expiration); then departments sidebar + tabs. No Baltimore-specific hierarchy or section headers.
- **Section headers:** AccelaProjectView uses Card titles and inline labels; no dedicated “section header” component matching Accela/Baltimore.
- **Fonts, spacing, borders, colors:** Generic dark theme (`#091428`, `#0D1E38`, `#1A3055`, `#F0F6FF`, muted-foreground). No Baltimore or Accela branding; no verification of font family, spacing scale, or border radius against target.
- **Record number links:** In “Links” tab, related `record_number` values are plain text (blue styling); they are not `<Link>` and do not navigate. No record number links on any list page (no list page).

---

## 6. Structural/interaction mismatch list

- **No “Permits and Inspections” entry:** Target flow starts with clicking “Permits and Inspections”; app has no such link or page.
- **No records list page:** Target requires a list of records with clickable record numbers; app only shows one record per project on `/portal-data`.
- **No record-detail route:** Target requires “click record number → open record detail.” App has no route like `/record/:id` or `/baltimore/record/:id`; detail is only the current project’s scraped data on `/portal-data`.
- **Project-centric vs record-centric:** App is project-centric (choose project in sidebar → see that project’s portal data). Target is record-centric (list of records → choose record → detail).
- **Record Info not expandable:** Target specifies “multiple expandable/clickable sections and detailed information blocks” under Record Info. Current Info tab is a single grid of key-value pairs; no collapsible/accordion sections.
- **Tab set and order:** Target explicitly calls out Record Info, Payments, Plan Review. Current tabs are Info, Files, Inspections, Links, Plan Review, Payments. “Files” and “Inspections” and “Links” may need to be aligned with target (rename, reorder, or collapse into Record Info).
- **Related record numbers not clickable:** In AccelaProjectView “Links” tab, record numbers do not navigate; they should link to record detail in the target flow.
- **No Baltimore portal “home”:** After login, target expects a portal home/dashboard; app shows app dashboard only.

---

## 7. Recommended implementation approach

- **New route group for Baltimore clone:** Add routes under a Baltimore/portal-clone path (e.g. `/baltimore` or `/portal-clone`) so the target flow is explicit and does not overload existing `/portal-data` semantics:
  - e.g. `/baltimore` (or `/portal-clone`) → Baltimore portal “home”/dashboard.
  - e.g. `/baltimore/permits` or `/baltimore/permits-and-inspections` → records list page.
  - e.g. `/baltimore/record/:recordId` → record detail page (can reuse or adapt AccelaProjectView).
- **Reuse where it fits:**
  - **AccelaProjectView:** Reuse for the **record detail content** (tabs and data blocks). Adapt tab labels (e.g. “Info” → “Record Info”), and refactor Record Info into **expandable sections** (e.g. Collapsible/Accordion) with the same or enriched data.
  - **DashboardLayout (or same layout):** Keep using the same app layout for new Baltimore pages unless you intentionally want a full-width or different chrome for the clone.
- **Create new pages/components for:**
  - **Baltimore portal home/dashboard:** New page that looks like the target “after sign-in” portal home and offers “Permits and Inspections” (and any other target nav).
  - **Records list page:** New page that shows a table of records with record number **links** to `/baltimore/record/:recordId` (or equivalent). Data source to be defined (mock or from scraping later).
  - **Record detail page:** New page that reads `recordId` from the route, loads that record’s data, and renders AccelaProjectView (or a Baltimore-specific variant) with Record Info as expandable sections.
- **Navigation:** Add “Permits and Inspections” in the place the target shows it (e.g. from Baltimore home or from a dedicated nav). Optionally add a “Baltimore Portal” or “Portal Clone” entry in the app sidebar that goes to the new home route.
- **Styling:** Introduce Baltimore/Accela-specific styles (or a theme variant) for the clone: top bar, tab bar, table, section headers, and optionally fonts/colors to match screenshots, without changing the rest of the app.

**Summary:** Adapt **AccelaProjectView** for detail content and tab structure; add **new routes and pages** for Baltimore home, records list, and record detail; and add **Baltimore-specific layout/nav** and styling. Do not replace existing app dashboard or Portal Data flow for other use cases; keep them and add the clone as a separate flow.

---

## 8. Exact files to modify next (priority order)

1. **`src/App.tsx`**  
   Add routes for Baltimore portal clone (e.g. `/baltimore`, `/baltimore/permits`, `/baltimore/record/:recordId` or equivalent).

2. **New page: Baltimore portal home/dashboard**  
   e.g. `src/pages/baltimore/BaltimorePortalHome.tsx` (or `PortalCloneDashboard.tsx`) — post-login portal home with “Permits and Inspections” and any other target nav.

3. **New page: Records list**  
   e.g. `src/pages/baltimore/BaltimoreRecordsList.tsx` — table of records with record number links to detail route.

4. **New page: Record detail**  
   e.g. `src/pages/baltimore/BaltimoreRecordDetail.tsx` — reads `recordId` from route, loads record data, renders detail (reuse or wrap AccelaProjectView).

5. **`src/components/portal/AccelaProjectView.tsx`**  
   - Rename/label “Info” tab to “Record Info” (or support via prop).  
   - Refactor Info content into **expandable sections** (e.g. shadcn Collapsible or Accordion) instead of a single flat grid.  
   - Optionally accept `recordId` and “back to list” link for use on the new detail page.

6. **`src/components/layout/AppSidebar.tsx`** (or new Baltimore nav component)**  
   Add “Baltimore Portal” / “Permits and Inspections” (or portal clone) entry pointing to the new home or list route, if target flow is entered from main app.

7. **`src/pages/Dashboard.tsx`** (optional)**  
   If target requires “from app dashboard go to Baltimore portal,” add a card or link “Baltimore Portal” / “Permits and Inspections” that navigates to the new home or list route.

8. **New layout or wrapper (optional)**  
   If the clone should have a different chrome (e.g. top utility nav, different width): `src/components/layout/BaltimorePortalLayout.tsx` or similar, used only by the new Baltimore routes.

9. **Styling**  
   Add Baltimore/Accela-specific classes or a small CSS module for the clone (top nav, tab bar, table, section headers) as needed to match screenshots.

---

**Assumptions:**  
- Target “dashboard” is the first screen after portal sign-in (Baltimore Accela look).  
- “Permits and Inspections” is a single entry point that leads to the records list.  
- Record numbers in the list are links to a record detail page.  
- Record detail URL can be record-id-based (e.g. `/baltimore/record/:id`); data source for list and detail is to be defined (mock or scraping later).  
- No scraping or backend changes in this audit; UI-only.

**End of audit.**
