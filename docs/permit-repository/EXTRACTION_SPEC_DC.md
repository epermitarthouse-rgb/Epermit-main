# DC extraction specification

Status: **Phase 0 live verification complete (2026-11-05).** Acceptance review in `PHASE0_REPORT.md`. Deep-extraction requirements (Reviews, Info, Status, Tasks, Files, Reports): `DC_DEEP_EXTRACTION_REQUIREMENTS.md`.  
Account observed: Commun-ET LLC on `planreview.dob.dc.gov`, using the user's existing logged-in Chrome session (no new login).  
No task was accepted, processed, uploaded, responded to, or saved. No file was opened in the viewer or downloaded. No report was exported. Grid settings were not saved.

Levels: **Observed** (seen in the logged-in browser, including DevTools Network) · **Code-supported** (in our scraper or a saved frame, not re-checked live) · **Unverified**.

Personal names, emails and phone numbers seen on the portal are deliberately **not** recorded here. Reviewers are referred to by role ("reviewer", "applicant").

## Auth and navigation

| Fact | Level |
|---|---|
| Dashboard `https://planreview.dob.dc.gov/` stays logged in and lists "My Projects" | Observed |
| Project numbers call `launchRemote('Project/Index?tab=projectStatusTab&ProjectID=N')`. This goes through `planreview.dob.dc.gov/login/sso?url=Project/Index?...` and opens a **new tab** on `session.planreview.dob.dc.gov` | Observed (9187, 28933, 11105, 11854) |
| Typing `session.planreview.dob.dc.gov/Project/Index?...` directly, without `launchRemote`, returns `WebForms/SessionEnded.aspx` | Observed |
| Once a ProjectDox tab exists, switching its project tabs (`tab=`) and opening other projects via `launchRemote` keeps working | Observed |
| `IsAzureSSO: true`, `SessionTimeout: 360`, `ShowLoginDialogOnSessionEnd: true` | Observed in page source |
| `Session.SessionID` is a JWT in the page source and is the JSON API credential. Never log or store it | Observed, value not recorded |
| MFA / CAPTCHA | Unverified (not challenged on the already-logged-in session) |
| Session lifetime under automated API use | Unverified |

## Hosts

| Setting | Value | Level |
|---|---|---|
| `ApiUrl` | `https://washington-dc-us-projectdoxwebapi.avolvecloud.com` | Observed |
| `UiUrl` | `https://session.planreview.dob.dc.gov` | Observed |
| `PortalWebUiUrl` | `https://planreview.dob.dc.gov` | Observed |
| `PortalWebAPIURL` | `https://washington-dc-us-portalwebapi.avolvecloud.com` | Observed |
| `TempFolderURL` | `https://washington-dc-us-projectdoxwebui.avolvecloud.com/Temp` | Observed |
| ProjectDox version | 9.5.9.3 (script `?v=` suffix) | Observed |

## Data routes (all observed in DevTools from the portal's own requests)

### JSON on `ApiUrl`

jQuery 3.4.1 `GET` XHRs from `https://session.planreview.dob.dc.gov`, each preceded by a CORS preflight. Auth is the custom header `Sessionid: <Session.SessionID JWT>` with `X-Requested-With: XMLHttpRequest`. Responses carry `Access-Control-Allow-Credentials: true` and `Access-Control-Allow-Origin: https://session.planreview.dob.dc.gov`. **Observed.**

| Route (GET) | Query observed | Returns | Observed on |
|---|---|---|---|
| `/Folder/GetProjectFolders` | `folderID=&projectID=N` | Folder array (fields below) | In Review 28933, Approved 11105 |
| `/File/GetFolderFiles` | `folderID=F&listMode=3&projectID=N&pageIndex=0&pageSize=500&pk=FileID&_=<ts>` | `{Items[], TotalRowsCount}` | 28933, 11105 |
| `/WorkflowAggregate/GetActiveWorkflowTaskList` | `wflowActivityID=&projectID=N&onlyActiveTaskStatus=true&showTasksForAllUsers=false&pk=WFlowTaskID&_=<ts>` | Current user's active tasks | 28933 |
| `/WorkflowAggregate/GetWorkflowInstancesList` | `WFlowStateName=&entityID=N&entityTypeID=1&checkForRevCoordPerm=true&pageNumber=0&rowCount=6&pk=WFlowInstanceID&_=<ts>` | `{Records[], TotalRecordCount, AllowRestart, EntityID, EntityTypeID}` | 28933 |
| `/WorkflowInstance/GetWorkflowInstanceStatusData` | `wflowInstanceID=W` | Status tab data (fields below) | Resubmit 11854 (W=11975) |
| `/WorkflowAggregate/GetProjectCorrectionsByCycleInstance` | `wflowInstanceID=W&wflowTaskID=&wflowActivityID=&groupID=&wflowReviewCycleID=&retrieveFilterOptions=true` | `{Corrections[], ReviewCycles[], CorrectionStatusTypes[], ReviewGroups[], WorkflowInstance, ...}`; the data behind the Reviews tab | 11854, 28933, 9187 (2026-11-06) |
| `/Report/GetReportList` | `assignedToProjectOnly=true&projectId=N&reportTypes=1&reportTypes=10&reportTypes=11` | Report array (`QueryReportID`, `QueryReportTitle`, `ReportType`, `ReportPath`, `ReportParamQueryString`, ...) | 11854 (2026-11-06) |

`GetActiveWorkflowTaskList` returns an object `{Tasks[], PagedTasks[], RecordCount, ...}`, not an array (Observed 2026-11-06). The session id for the `Sessionid` header is `Globals.Session.SessionID`; `window.Session` is undefined.

The guessed routes used before Phase 0 (`/Workflow/GetWorkflowInstances`, `/WorkflowAggregate/GetWorkflowTaskList`, `/Project/GetProjectCorrectionTasks`, `/Folder/GetFolders`) return ASP.NET "no action" errors. They are removed from the safety allowlist.

### HTML on `UiUrl` (cookie session)

| Route (GET) | Query observed | Used by | Level |
|---|---|---|---|
| `/Project/Index` | `tab=<tabId>&projectid=N` | Project shell | Observed |
| `/Project/ProjectCorrections` | `projectID=N&wflowInstanceID=&timeStamp=<ms>` | **Reviews** tab shell (`tab=correctionsTab`), ~190 kB HTML. Holds row templates only; rows come from `GetProjectCorrectionsByCycleInstance`. Not read by the adapter | Observed (11854, 28933) |
| `/Project/ProjectInfo` | `ProjectID=N&ProjectTemplateID=5` | Info tab; server-rendered field table | Observed (11854) |
| `/Project/ProjectEdit` | `projectID=N` | Also fired by the Info tab. Not needed; **not allowlisted** | Observed |
| `/User/Workflow/WorkflowTaskList` | `wflowTaskStatusTypeIDList=3&...&projectID=N` | Tasks grid | Observed |
| `/WebForms/ReportViewer.aspx` | `ReportID=14&ReportPath=/WashingtonDCProd/ProjectDox/Plan Review - Review Comments&DataSourceName=DataSource1&ProjectID=N&WFlowInstanceID=W&Timezone=` | Review Comments report (SSRS 14.0), opens as a popup window; a plain GET returns page 1 inline | Observed (28933 / 29184, 11854 / 11975) |

### Folder fields (`GetProjectFolders[]`)

`FolderID`, `ProjectID`, `Name`, `FolderType`, `Depth`, `ParentFolderID`, `DerivedFromFolderID`, `FilesCount`, `NewFilesCount`, `FilesWithMarkupsCount`, `FriendlyPath` (`<permit>\\<folder>`), `PublishPath`, `SourcePath`, `FolderPermissions{...}` / `permissions{DownloadFile, DeleteFile, UploadFile, ViewMarkups, CreateMarkups, ManageFolders}`, `PDFSubmissionPolicy`, `PolicyCheck*`. `DateUpdated` is the sentinel `0001-01-01T00:00:00` and must **not** be used for change detection. **Observed.**

### File item fields (`GetFolderFiles.Items[]`)

`FileID` (new id per version), `Version`, `FileName`, `OriginalFileName`, `FileStatus` (for example "New V2"), `FileSize`, `FileSizeKB`, `FileSizeMB`, `FileTypeID`, `FolderID`, `HasMarkups`, `IsNew`, `IsViewed`, `IsViewedDesc`, `CanViewMarkups`, `CanCreateMarkups`, `CheckedOutBy`, `CopiedFromFileID`, `AuthorID`, `OrigAuthor`, `LastModDate`, `PublishDate`, `PublishPath`, `PublishURL`, `SourceFile`, `SourcePath`, `SheetSize`, `PageCount`, `ReviewCycle`, `Thumbnail` (signed blob URL, do not persist), `UploadDate`, `UploadBatchID`, `TopicCount`, `WFlowReviews`. **Observed.**

### Workflow instance fields (`GetWorkflowInstancesList.Records[]`)

`WFlowInstanceID`, `WFlowID`, `VersionNum`, `VersionTitle`, `InstanceName`, `WFlowSubtypeName` ("BIC Building"), `WFlowInstanceStateID` / `WFlowInstanceStateName` ("Active", "Completed"), `CurrentActivity` ("Department Review"), `CoordinatorGroup` ("QA Review"), `AdminGroup`, `DateStarted`, `DateUpdated`, `DateCompleted`, `EntityID`, `EntityName` (permit number), `ProjectID`, `OwnerUserID`, `StartedByID`, `IntegrationModeName` ("Production"), `TerminatedReason`. **Observed.** `DateUpdated` is the cheap change-detection signal.

### Status data fields (`GetWorkflowInstanceStatusData`)

Top level: `ReviewType`, `CalendarType` ("Business Days"), `ProjectStatus`, `TotalNumberOfFiles`, `UncompleteTaskCount`, `TimeElapsed{Days, Hours, FormattedText}`, `PrescreenStatus[]{SubWorkflow, CompletionDuration{...}, ...}`, `SubWorkflows[]`.  
`SubWorkflows[]`: `ActivityGroupingInstanceID`, `SubWorkflow`, `StatusName`, `ApplicationDuration{}`, `JurisdictionDuration{}`, `TotalDuration{}`, `UnresolvedComments`, `UnresolvedByGroup[]{GroupName, UnresolvedComments}`, `UncompletedTasks[]{WFlowTaskID, GroupName ("Applicant"), ...}`. **Observed.** This JSON is the authoritative source for status, unresolved counts per department, and open applicant tasks.

### Reviews (corrections) row structure (rendered Reviews tab)

What the user sees after the page script fills the grid from `GetProjectCorrectionsByCycleInstance`. JSON field mapping: requirement document §3.1.

Filters: Dept, Status, Response, Type, Cycle, Time, keyword Search, Refresh. Each row:

- `Ref.# N`
- department (for example "DOEE AQ", "DOEE EV")
- reviewer name → store as role `reviewer`
- date and time
- `Cycle N`
- status badge: **Resolved**, **Info Only**, **Unresolved**
- type ("Comment")
- comment text
- prior applicant response thread ("Responded by: <name> - <date>" → role `applicant`)
- right-hand response column: "No response required." or an editable **"Type your response here."** textarea. **Never focus or type in it.**

**Observed** (11854: 3 rows; Ref #4 Resolved, Ref #5 Info Only, Ref #3 Unresolved, which matches Status "Review Comments (Unresolved): 1").

### Review Comments report (SSRS, popup)

Columns: REF #, CYCLE, REVIEWED BY (department, reviewer, date), TYPE (Comment + text), FILENAME, DISCUSSION (threaded applicant / reviewer responses with dates), STATUS (Info Only / Resolved / Unresolved). Viewer has a Workflow parameter, View Report, paging, and an export menu. Export is **denied**. **Observed** (28933, 11854). Parsed by `dom-extract.extractReviewCommentsReport` as the fallback Reviews source; the corrections JSON is primary and also covers projects without a Reviews tab (28933: 38 corrections). Structure and the two observed time differences: `DC_DEEP_EXTRACTION_REQUIREMENTS.md` §3.6.

## Discovery (dashboard "My Projects")

`1 - 10 of 28 records`, 10 per page, pager links (`1`, `2`, `3`, Next, Last, First, Prev) are `javascript:void(0)` and change rows client-side without a URL change. Header "TASKS (6)". **Observed.**

| Page | Permit (ProjectID) and status |
|---|---|
| 1 | B2508295 (9187) Upload · B2508799 (9961) Upload · F2500851 (10763) Upload · B2605178 Upload · B2606359 Upload · B2608606 Resubmit · B2608414 (28933) In Review · B2608367 (28729) In Review · B2606635 (27492) In Review · FD2600015 (26186) In Review |
| 2 | B2606607 (25920) Approved · D2600336 (24788) Approved · B2604437 (22318) Approved · D2600240 (22101) Approved · B2603379 (20896) Approved · B2601103 (16306) Approved · EX2600003 (15093) Approved · B2600602 (15026) Approved · TL2600008 (14966) Upload · F2500890 Approved |
| 3 | B2509550 (12107) Approved · D2500488 (11854) Resubmit · B2407514 (11105) Approved · B2508776 (9763) Resubmit · B2508416 (9321) Approved · BCIV2500152 (6364) Approved · TL2500067 (6307) Approved · B2505268 (3168) Approved |

Totals: **28** = Approved 15 + Upload 6 + In Review 4 + Resubmit 3. Reconciled with the "of 28 records" label. **Observed.** ProjectIDs not written down for 4 rows (B2605178, B2606359, B2608606, F2500890); the adapter reads every ID from the `launchRemote` href, so this is not a gap in the data source.

Row action column:

- Upload rows on page 1 and B2608606 carry a red **Open** (`launchEForm(.../Eform.aspx?...autoAssignTask=true...)`) or "Respond and Resubmit" control. **Denied.**
- Approved rows carry a green **Open** (`launchEForm('.../Project/ApprovedPlans?projectID=N&showApprovedPlans=true&RemoteInvoke=true')`) and **Download Files**. Both **denied.**
- In Review rows, TL2600008, and the page 3 Resubmit rows show no action. **Observed.**

## Tabs by status

| Status | Tabs | Evidence |
|---|---|---|
| Upload | Tasks, Files, Status, Info, Reports | B2508295, Observed |
| In Review | Tasks, Files, Status, Info, Reports (**no Reviews**) | B2608414, Observed |
| Resubmit | Tasks, Files, Status, Info, Reports, **Reviews** | D2500488, Observed |
| Approved | Tasks, Files, Status, Info, Reports | B2407514, B2606607, Observed |

Tab ids: `tasksTab`, `filesTab`, `projectStatusTab`, `projectInfoTab&projectTab=TabProjectInfo`, `reportsTab`, `correctionsTab`. A missing tab means "section not offered", not "empty".

## Per-tab content

- **Status:** Review Type, Owner, Total Number of Files, Days Calculated as, Time Elapsed, Completed Submission (Prescreen), Prescreen Review Comments (Unresolved), Time with Jurisdiction / Applicant, Status, status duration, Review Comments (Unresolved), per-department unresolved counts, Current Non-Completed Tasks with the task line (for example "Waiting Respond and Resubmit (Reassigned from <org>): <duration> [Accepted]"). Approved projects need "Workflow: [Select One]" and show completed-task totals only. Source: `GetWorkflowInstanceStatusData`. **Observed.**
- **Files:** In Review B2608414 Drawings 114 / Supporting 49. Approved B2407514 Drawings 44 / Supporting Documents 2 / **Approved Drawings 44 / Approved Supporting Documents 2**. Account permission `DownloadFile: false`. **Observed.** Downloads are unavailable to this account; store metadata only.
- **Tasks:** user task grid (`WorkflowTaskList` partial plus `GetActiveWorkflowTaskList`) and a Workflows list. Approved B2407514: 0 tasks, workflow instances in state Completed with start and completion dates, integration mode Production, version "Accela Integration (Version 1)". **Observed.**
- **Info:** Project name, Description, Location, Contact, Contact's Email, Phone, Cell Phone, Job Class, Project Owner, Owner's Email, Status, Review Cycle, Project Start / End, Latitude, Longitude. Source `/Project/ProjectInfo`. **Observed.** Contact email, phone and cell are personal data: do not persist them; keep the organisation name only.
- **Reports (5):** Current Project - All Uploaded Files with Sheet Sizes; Plan Review - Department Review Status; Plan Review - Review Comments; Plan Review - Review Details; Plan Review - Workflow Routing Slip. Each opens a ReportViewer popup. **Observed.**
- **Reviews (Resubmit only):** see the row structure above. **Observed.**

## What an adapter may do

- Enter ProjectDox only through the dashboard `launchRemote` link. Read `Globals.Session.SessionID` in memory and call the JSON GET routes with the `Sessionid` header. Fetch the HTML partials over the same session.
- Comments: use `GetProjectCorrectionsByCycleInstance` for the active workflow instance; if that read fails, use the Review Comments ReportViewer (`ReportID=14`) keyed by `ProjectID` + `WFlowInstanceID`. Cross-check unresolved counts against `GetWorkflowInstanceStatusData`.
- Reports: list from `GetReportList`; only the Review Comments body is parsed.
- Refuse Open (both kinds), Download Files, Upload and Submit, Respond and Resubmit, AcceptTask, ProcessTask, Eform, ToggleViewed, viewFile, saveUserSettingsOfGrid, report export, Log Out, and any non-GET. Enforced by `scraper-service/permit-sync/core/safety.js`.
- Treat `SessionEnded.aspx` or a 401 from the API as an auth failure, not an empty project.
- Do not download files for this account (`DownloadFile: false`).

## Remaining unverified items (recorded as blockers, not assumed)

1. MFA / CAPTCHA behaviour on a fresh login. Requires a new login, which is out of scope without approval.
2. Session lifetime under automated API use. Requires an approved live run (A-series approvals).
3. Closed 2026-11-06: Reviews JSON mapping, Info partial, ReportViewer body and report list are verified (U-1, U-2, U-5, U-7 in the requirement document).
4. Closed 2026-11-06: offset-less times are America/New_York wall clock (same clock in JSON, report and Reviews tab; EST observed, EDT inferred from the zone). Requirement document §3.9.
5. Closed 2026-11-06 for mapped fields: `Tasks[]` items carry `TaskName`, `GroupName`, `TaskStatus`, `DateAccepted`, `DateDue`, `DateCompleted`. Assignment to the current account and the unaccepted state were not observed (requirement document §3.4).
6. ProjectIDs for B2605178, B2606359, B2608606 and F2500890 were not written down in Phase 0. Tests use `test-<permit>` placeholders; the adapter reads the real id from the dashboard `launchRemote` link.
