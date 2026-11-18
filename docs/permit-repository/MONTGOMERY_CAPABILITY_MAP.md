# Montgomery County MD (ProjectDox) — Capability Map

Evidence, 2026-11-18:
- **(B)** Browser inspection in the user's own authenticated Chrome session. Background control was used, popups were avoided, and nothing was clicked that changes state.
- **(C)** One supervised, read-only Playwright capture (`scripts/permit-repo/montgomery/phase0-capture.js`, approved by the user). It covered:
  - three projects: 195963 Decision Issued, 200100 Approved, 146267 PreApproval Corrections;
  - GET/HEAD only after login, with deny patterns active;
  - route names, status codes and JSON shapes only;
  - no downloads, no database writes, nothing queued.
- Output is in `exports.local/montgomery-phase0-2026-11-18T10-03-55-948Z/`, which is git-ignored and holds raw payloads, so it must not be committed.
- Result: 147 requests. 2 were refused (a blob-hosted logo, refused by the guard). None were dropped, and none were state-changing.

Product: Avolve ProjectDox 9.4.0.0, the same product as DC.

## Hosts

| Role | Montgomery | DC equivalent |
|---|---|---|
| Portal (login, Home) | `montgomeryco-md-us.avolvecloud.com` | `planreview.dob.dc.gov` (B2C/Okta login) |
| Project pages (WebUI) | `montgomeryco-md-us-projectdoxwebui.avolvecloud.com` | `session.planreview.dob.dc.gov` |
| JSON Web API (`Globals.ApiUrl`) | `montgomeryco-md-us-projectdoxwebapi.avolvecloud.com` | `washington-dc-us-projectdoxwebapi.avolvecloud.com` |
| Portal API (login, keepalive) | `montgomeryco-md-us-portalwebapi.avolvecloud.com` | `washington-dc-us-portalwebapi.avolvecloud.com` |

The WebUI page `Globals` keys are the same as on DC: `Session`, `ApiUrl`, `UiUrl`, `PortalWebAPIURL`, `PortalWebUiUrl`, `IsAzureSSO`, `SessionTimeout`, and others.

## Login and session (C)
1. `/ProjectDox/index.html` redirects (301/302) through `/Login/SessionEnded` to the form at `/Login/Index/MontgomeryDPS-Prod`.
2. The form posts to `portalwebapi /User/Login` with an anti-forgery token. Cookies set: `PortalJurisdiction`, `SessionIDPortal`, `ARRAffinity*` (`SessionIDPD` is not set).
3. The session lands on `/Home/Index`. **No MFA or CAPTCHA was asked** on either of the two logins.
4. WebUI hop: the portal link "View All Projects" (or any project link) goes to `/login/sso`. It then form-POSTs to `projectdoxwebui /webforms/index.aspx`, through `ViewProjects.aspx`, and lands on `/User/Index`, where `Globals.Session.SessionID` is present.
   - This POST is the session handoff, not a record change. It must run under the login policy, the same way DC's launchRemote SSO hop does.
   - The first capture attempt dropped this POST. That ended the WebUI session, and every later page went to `WebForms/SessionEnded.aspx`.
5. Keepalive: `GET /User/GetSessionTimeout` on both the Web API and the portal API.
6. Logout is `WebForms/SessionEnded.aspx` (denied; the worker never clicks it).

Difference from DC: DC has no form login (B2C/Okta through the Avolve middleware), and on DC the Web API session comes from a launchRemote popup.

## Discovery and pagination
- Portal Home "My Projects" table **(B)**: 10 rows, showing 10 of the 20 projects. Each row links to `launchRemote('Frame.aspx?tab=projectStatusTab&ProjectID=N')`. "Open" is `launchEForm(...ApprovedPlans...)`, which is denied, and so is "Download Files". Tasks (0).
- WebUI projects grid **(B, C)**: "1 - 9 of 20 records". The data call is `GET webapi /Project/GetPagedActiveProjects?pageIndex&pageSize`.
  - With `pageSize=50`, one call returned all 20 projects as `{Items[], TotalRowsCount}`.
  - Each item has ProjectID, Name (the permit number), Status, StatusInfo, ProjectTemplateID/Name, Address1/City/State/PostalCode, Owner, CreateDate and WorkflowStatuses.
- **Gap in the existing scraper:** `scrapers/montgomery/dashboard-discovery.js` reads only the portal Home table. It found 10 of the 20 projects.
- The 20 projects (ProjectID, permit, status, template):

| ProjectID | Permit | Status | Template |
|---|---|---|---|
| 200100 | SIGN-1159714 | Approved | 38 |
| 195963 | COMBUILD-1154415 | Decision Issued | 44 |
| 185325 | COMBUILD-1140088 | Decision Issued | 44 |
| 160555 | COMBUILD-1088704 | Decision Issued | 44 |
| 153292 | COMBUILD-1073768 | Decision Issued | 44 |
| 151479 | COMBUILD-1069846 | Decision Issued | 44 |
| 148908 | COMBUILD-1064409 | Decision Issued | 44 |
| 147354 | COMBUILD-1060903 | Approved | 44 |
| 147323 | COMBUILD-1060799 | Approved | 17 |
| 146267 | COMBUILD-1058162 | PreApproval Corrections | 44 |
| 146052 | COMBUILD-1057683 | Approved | 17 |
| 138241 | COMBUILD-1042765 | Approved | 17 |
| 134541 | COMBUILD-1035844 | Pending Upload | 17 |
| 130256 | COMBUILD-1028229 | Approved | 17 |
| 130253 | COMBUILD-1028228 | Approved | 17 |
| 115894 | COMBUILD-1005391 | Approved | 17 |
| 95400 | COMBUILD-969297 | Approved | 17 |
| 93853 | COMBUILD-966584 | Approved | 17 |
| 93607 | COMBUILD-966134 | Approved | 17 |
| 71971 | COMBUILD-864448 | Approved | 17 |

## Statuses
Portal statuses: Pending Upload, PreApproval Corrections, Approved, Decision Issued. DC uses Upload / In Review / Resubmit / Approved.

They are mapped to the canonical set: `upload`, `resubmit`, `approved`, and `other` for Decision Issued. The raw text is always kept in `status_raw`.

## Workflows, tasks, review cycles (C)

| Route | Result |
|---|---|
| `WorkflowAggregate/GetWorkflowInstancesList` | `{Records[], TotalRecordCount, ...}`, same shape as DC. 195963 and 200100 have one workflow each ("BIC DPR / Rejection Path", "BIC Building / Rejection Track"). **146267 (PreApproval Corrections) has 0 workflow instances.** `WFlowInstanceStateName` is empty. |
| `WorkflowInstance/GetWorkflowInstanceStatusData` | `ProjectStatus`, `ReviewType`, `TotalNumberOfFiles`, `TimeElapsed`, `UncompleteTaskCount`. `SubWorkflows` was null, so there is no unresolved-comment counter to check parity against. |
| `WorkflowAggregate/GetActiveWorkflowTaskList` | `{Tasks[], PagedTasks[], RecordCount}`. Empty for this account, which matches portal Tasks (0). |
| Tasks tab DOM | Columns: Action, Task, Group, Assignment type, Status, Due Date, ... The account has nothing assigned, so accept/process controls exist but were never touched (denied). |

## Files, folders, versions, permissions (C)
- `Folder/GetProjectFolders` is an array of folders. Seen: Drawings, Zoning Drawings, Documents, Supporting Documentation, Approved, Rejected, Revisions, Inspection Reports.
  - Each folder carries `FilesCount`, `SubFolderCount` and `FolderPermissions {ViewFolder, DownloadFile, DeleteFile, ...}`.
- **DownloadFile is set per folder and is mixed.** For example, on 195963 Drawings is false and Approved/Rejected/Inspection Reports are true. DC reports false for the whole account.
- `File/GetFolderFiles?listMode=3&pageSize=500` returns `{Items[], TotalRowsCount}` with FileID, Version, FileName, FileSize, FileStatus, HasMarkups, UploadDate, PublishDate, PageCount, SheetSize, ReviewCycle and WFlowReviews.
  - Paging was complete everywhere: 77, 74 and 25 files in the largest folders.
- **Folder IDs repeat across projects that share a template** (195963 and 146267 both have 1244443 and up). File identity is therefore always (permit, FileID), which the repository already does.
- Download mechanism: `File/RetrieveFile` / the viewer, as on DC. It was not exercised (no bodies fetched). It is allowed only in deep mode, and only where `download_permitted` is true.

## Reviews and comments (C) — main difference from DC
- `GetProjectCorrectionsByCycleInstance` answers on Montgomery, but `Corrections`, `ReviewGroups` and `ReviewCycles` are **empty**, even for permits whose report lists comments.
- The comments live in the SSRS report **"Plan Review - Review Comments", ReportID 133**, path `/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments`. The ReportViewer GET rendered it:
  - 195963: 18 comment rows on the first page, 8 pages;
  - 200100: 8 rows, 8 pages.
- Disciplines and responses are inside the report rows (department, reviewer, discussion).
- Consequences:
  - The JSON-only pass gets reviews only when the report has one page.
  - The full comment set needs the report's Excel export, which is deep mode only, and is parsed by the existing deterministic parser (`lib/reviewCommentsExcelStructuredRows.js`, then `correctionRowsFromReportExcel`, D-103).
- Discussions tab: topics with category FYI / ProjectFlow / Request for Information (`Topic/ListTopics`). It has a create-topic form, which is never used.

## Reports (C)
`Report/GetReportList` lists these reports, each with `ReportPath`, `ReportDataSourceName` (DataSource1) and `ReportParamQueryString` (ProjectID, WFlowInstanceID, Timezone):

| ReportID | Report |
|---|---|
| 132 | Discussion Board Plan Review |
| 133 | Review Comments |
| 134 | Review Details |
| 135 | Workflow Routing Slip |
| 139 | Quick Review – Details (200100 only) |

They match `MONTGOMERY_REPORT_SPECS` in the existing scraper. PDF/Excel export uses the SSRS export (`OpType=Export`), which is denied in JSON mode and allowed only in deep mode.

## Info (C)
The `Project/ProjectInfo` partial has standard labels: Project name, Description, Location, Contact, Contact's Email, Phone, Cell Phone, Priority, Project Owner, Owner's Email, Status, Status info, Project Start/End.

These are the same labels the DC extractor allowlists. Emails and phones are never read. The partial needs the project's own `ProjectTemplateID` (17, 38 or 44); DC uses a fixed 5.

## Network summary (C)
Every data call is a GET with the `Sessionid` header, made by the WebUI page.

| Host | Paths |
|---|---|
| WebUI | `Project/Index`, `Project/ProjectList`, `Project/ProjectFiles`, `Project/ProjectStatus`, `Project/ProjectEdit`, `Project/ProjectInfo`, `Admin/Report/ReportList`, `Topic/ListTopics`, `User/Workflow/WorkflowTaskList`, `WebForms/ReportViewer.aspx` |
| Web API | `Project/GetPagedActiveProjects`, `WorkflowAggregate/*`, `WorkflowInstance/*`, `Folder/GetProjectFolders`, `File/GetFolderFiles`, `Report/GetReportList`, `User/GetSessionTimeout` |
| Portal | `User/Login` (POST, login only), `User/GetSessionTimeout` |

## Differences from DC that matter to the code

| Area | DC | Montgomery | Handled in |
|---|---|---|---|
| Login | B2C/Okta through the Avolve middleware | Portal form + anti-forgery token, no MFA seen | `performMontgomeryPortalLogin` (reused), injected into the transport |
| API session | launchRemote popup to Project/Index | "View All Projects" popup to WebUI /User/Index | `montgomery-projectdox/live-transport.js` |
| Discovery | Dashboard table, pager clicks | Projects grid JSON, one call | `paged_active_projects` route |
| Reviews | Corrections JSON (report for inactive workflows) | Report only (JSON empty) | Adapter report path; deep Excel export in `deep/montgomery-driver.js` (G-1, not live-verified) |
| Download permission | Account-wide false | Per folder, mixed | Shared `fileItems` (folder flag wins) |
| Info template | 5 | Per project (17, 38, 44) | Transport remembers it from discovery |
| Report identity | ReportID 14, `/WashingtonDCProd/...` | ReportID 133, `/MontgomeryCountyProd/...` | Tenant config |
