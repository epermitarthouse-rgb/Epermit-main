# Baltimore Portal View Routing — Report

## Fix (latest): Why Baltimore was still showing generic UI

- **Cause:** The Baltimore decision was stored in a separate boolean (`isBaltimoreCredential`) set asynchronously. If that state was not yet set or was reset, the render path still saw generic Accela.
- **Change:** The viewer now stores the **credential** (`login_url`, `jurisdiction`) in state and **derives** Baltimore at render time with `isBaltimorePortal(credentialForView)`. No separate boolean; the decision is always based on current credential data.
- **Detection:** `isBaltimorePortal()` was made more robust: (1) URL match allows trailing slash (`/BALTIMORE/`); (2) fallback: if `jurisdiction` contains "Baltimore" and `login_url` contains "accela.com", treat as Baltimore.

---

## A. Where portal UI rendering was happening before

- **Route:** `/portal-data` (Portal Data / Portal Harvest).
- **Page:** `src/pages/PortalDataViewer.tsx`.
- **Flow:** User selects a project (sidebar/context) → navigates to Portal Data or clicks “View Portal Data” → `PortalDataViewer` loads the selected project’s `portal_data` and the project’s linked credential. It then chose the UI purely by **portal type** (Accela vs ProjectDox):
  - If `expectedPortalType === "accela"` or `portalData.portalType === "accela"` → it always rendered **`AccelaProjectView`** (generic Accela UI).
  - Otherwise → it rendered the **generic ProjectDox-style** UI (tabs, files, reports, etc.).
- **Baltimore UI** lived only on **separate routes**: `/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId`. Those routes were linked from the sidebar as “Baltimore Portal” and used **mock data** only. They were never used when the user was on `/portal-data` with a Baltimore credential.

So portal UI rendering was: **one place** (`PortalDataViewer`), with **no distinction** between Baltimore Accela and other Accela; all Accela used the same generic `AccelaProjectView`.

---

## B. Why Baltimore UI was not appearing

1. **No conditional mapping for Baltimore**  
   `PortalDataViewer` had no branch for “Baltimore Accela”. It only checked “Accela vs non-Accela” and always rendered `AccelaProjectView` for any Accela credential.

2. **Baltimore lived on a different route**  
   The Baltimore-specific UI was implemented only under `/baltimore/*`. The main portal flow (Dashboard → “View Portal Data” or “Portal Harvest” → `/portal-data`) never pointed at those routes, so users with a Baltimore credential still saw the generic Accela UI on `/portal-data`.

3. **No credential-level signal for Baltimore**  
   The app used `expectedPortalType` (from credential `login_url` via `detectPortalTypeFromUrl`), which returns `"accela"` for any Accela URL. There was no check for “Baltimore” (e.g. `aca-prod.accela.com/BALTIMORE`), so Baltimore could not be treated differently from other Accela portals.

4. **Generic component always mounted for Accela**  
   For any Accela data, `AccelaProjectView` was always mounted; `BaltimorePortalDataView` (and the Baltimore layout/tabs) were never mounted in the main portal flow.

**Exact reason:** Baltimore UI did not appear from the normal portal flow because **there was no conditional mapping** in `PortalDataViewer` that used a **Baltimore-specific signal** to render the Baltimore view instead of the generic Accela view when the **selected project’s credential** was Baltimore Accela.

---

## C. Signal used to detect Baltimore portal

- **Source:** The **linked portal credential** of the selected project (`portal_credentials` row referenced by `project.credential_id`).
- **Field used:** `login_url` (e.g. `https://aca-prod.accela.com/BALTIMORE` for Baltimore).
- **Logic:** `isBaltimorePortal(credential)` in `src/lib/portalView.ts` returns `true` when `credential.login_url` matches:
  - `aca-prod.accela.com/BALTIMORE`, or
  - `.accela.com/BALTIMORE`
  So only credentials that point at the Baltimore Accela tenant are treated as Baltimore; other Accela tenants (Howard, Arlington, etc.) stay generic.
- **Scraper metadata:** The scraper already sets `portalType: "accela"` in `portal_data`. That is used to decide “Accela vs ProjectDox”. Baltimore is distinguished **only** by the credential’s `login_url`, not by a separate `portalType` value, so we did not need to change scraper output.

---

## D. Files updated

| File | Change |
|------|--------|
| `src/lib/portalView.ts` | **New.** Helpers `isBaltimorePortal(credential)` and `resolvePortalView(credential, portalTypeFromData)` for Baltimore vs generic view resolution. |
| `src/components/baltimore/BaltimorePortalDataView.tsx` | **New.** Baltimore-specific portal data view: takes same Accela `portalData` shape as `AccelaProjectView`, renders with `BaltimoreLayout`, `BaltimoreRecordTabBar`, `BaltimoreDetailSection`, `BaltimoreInfoGrid`, `BaltimorePanelTable`. |
| `src/pages/PortalDataViewer.tsx` | **Updated.** Imports `isBaltimorePortal` and `BaltimorePortalDataView`; adds state `isBaltimoreCredential`; sets it when loading credential (in `fetchData` and `silentRefetch`); when `renderAccelaUI` is true, renders `BaltimorePortalDataView` if `isBaltimoreCredential === true`, otherwise `AccelaProjectView`. |

No changes to routes, scraper, or other portal types. Standalone Baltimore routes (`/baltimore/*`) are unchanged.

---

## E. How Baltimore-only conditional rendering now works

1. **Credential loading**  
   When `PortalDataViewer` loads or refetches the selected project, it loads the project’s credential (`login_url`, `jurisdiction`). It already computed `expectedPortalType` (e.g. `"accela"`); it now also sets `isBaltimoreCredential = isBaltimorePortal(cred)`.

2. **When to show Baltimore UI**  
   Only when **all** of the following are true:
   - The viewer is in “Accela” mode (`renderAccelaUI` is true, i.e. `expectedPortalType === "accela"` or `portalData.portalType === "accela"`), and  
   - `isBaltimoreCredential === true` (credential’s `login_url` is Baltimore Accela).

3. **What gets rendered**  
   - **Baltimore credential + Accela data** → `BaltimorePortalDataView` (Baltimore layout, tab bar, sections) with the same `portalData` used for the generic view.  
   - **Any other Accela credential** → `AccelaProjectView` (unchanged).  
   - **ProjectDox / other** → existing generic (non-Accela) portal UI, unchanged.

4. **User flow**  
   User selects a project whose linked credential is Baltimore Accela → goes to Portal Data → sees Baltimore-specific UI. User selects a project with a different credential → sees generic Accela or ProjectDox UI. No redirects; the same `/portal-data` route renders the correct view based on credential.

---

## F. What remains generic for all other portals

- **All non-Baltimore Accela portals** (e.g. Howard, Arlington, Fairfax, DC, Anne Arundel) still use **`AccelaProjectView`** on `/portal-data`. No change to their UI or behavior.
- **ProjectDox / avolvecloud** credentials still use the **existing generic portal UI** (tabs, project info, files, reports, etc.) in `PortalDataViewer`. No change.
- **Standalone Baltimore routes** (`/baltimore`, `/baltimore/permits`, `/baltimore/records`, `/baltimore/records/:recordId`) are **unchanged** and still use mock data and the existing Baltimore pages.
- **Scraper, API, and credential storage** are unchanged. Only the **frontend** uses `login_url` to decide Baltimore vs generic view.
- **Dashboard, Quick Scrape, sidebar, project/credential selection** are unchanged; only the **component chosen** when rendering Accela data on `/portal-data` is conditional on Baltimore.

---

**Summary:** Baltimore-specific UI now appears **only** when the selected project’s portal credential is Baltimore Accela (`login_url` contains `BALTIMORE`). It is shown in the **same place** users already use for portal data (`/portal-data`), using the same `portal_data` from the scraper. All other credentials keep the existing generic portal UI with no regression.
