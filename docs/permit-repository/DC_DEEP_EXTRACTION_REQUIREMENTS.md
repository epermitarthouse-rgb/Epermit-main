# Washington DC deep extraction: requirements

Status: **DC deep-extraction milestone complete offline (2026-11-06).** Every section has a verified source and a tested parser. One item (U-6, MFA and session lifetime under automation) needs the A-3 live run and stays open.
Companion to `EXTRACTION_SPEC_DC.md` (endpoints and field lists) and `PHASE0_REPORT.md`.

Scope: every section a ProjectDox project exposes (Reviews, Info, Status, Tasks, Files, Reports), plus the Review Comments report as a second Reviews source. Phase 4 (second jurisdiction) stays blocked until this milestone is reviewed.

## 1. Evidence base

| Source | What was captured | Level |
|---|---|---|
| Project 11854 (D2500488), Resubmit, user's Chrome session, read-only, 2026-11-05 | Reviews tab DOM (5 comments, 3 with discussion), Info tab, Status tab, Tasks tab (0 rows), Files tab (32 rows), Reports tab (5 reports) | Observed |
| Same session, 2026-11-06, supervised read-only in-page GETs (console `fetch`, no clicks on portal actions) | `GetProjectCorrectionsByCycleInstance` (11854, 28933, 9187), `GetReportList` (11854), `GetActiveWorkflowTaskList` (9187, 11854, 28933), `GetWorkflowInstancesList` (11854, 28933, 9187), raw `ProjectCorrections` and `ProjectInfo` partials, `ReportViewer.aspx` for 11854 and 28933 | Observed |
| Review Comments report viewer, 11854 / workflow 11975 | Opened once from the Reports tab under screen control; page structure captured and redacted. Export was never touched | Observed |
| Project 28933 (B2608414, In Review) and 11105 (Approved) | Tab sets, folder and workflow JSON | Observed in Phase 0 |

Redaction was applied before anything was saved in the repo: personal names, emails, phone numbers and the reviewer identity were removed. JSON captures were reduced to an allowlist of non-personal fields inside the page before they were copied. Script blocks, view state and inline images were stripped from HTML. A residual scan of every saved copy found no emails, phone numbers, session tokens, or the names observed on the account. The unredacted scratch copies were deleted.

## 2. Account and safety constraints (non-negotiable)

- Account `DownloadFile: false`. No file is downloaded, viewed (`viewFile`), or previewed. Store metadata only.
- No Open, Download Files, Upload, Submit, Respond and Resubmit, Accept/Process task, EForm, ToggleViewed, grid settings save, report export, Log Out, or any non-GET request.
- Reviews response boxes ("Type your response here.") are never focused or typed in.
- Routes are read-only GETs on the `DC_READ_ALLOW` allowlist and must pass `core/safety.evaluateRequest`. Report export (`OpType=Export`, `rs:Format=`) stays on the deny list.
- `AddUpdateEntityMetadata` is issued by the portal itself when a tab opens. The adapter must never call it.
- Live sessions stay gated behind `PERMIT_SYNC_LIVE_PORTAL_APPROVED=A-3`. This milestone adds parsers and transport methods that are tested offline; it does not run a live sync.

## 3. Section requirements

Status values: `ok`, `partial` (incomplete or parity mismatch), `failed` (could not read), `absent` (the portal does not offer the section). A missing tab means "not offered", never "empty".

### 3.1 Reviews (comments and discussions)

**Primary source (every project with a workflow instance):** `GET ApiUrl/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?wflowInstanceID=W&wflowTaskID=&wflowActivityID=&groupID=&wflowReviewCycleID=&retrieveFilterOptions=true` (JSON, `Sessionid` header). Route `project_corrections_json`.

**Fallback:** the Review Comments report (3.6) when the JSON read fails. The section records `json_failed:<code>` in its error and `source_kind = report`. If both fail the section is `failed` and stored comments are kept.

**Not used:** the `/Project/ProjectCorrections` HTML partial. Fetched raw, it contains only two script templates (`correctionid="${...}"`, 16 template ids, 0 data rows) for both 11854 and 28933. The page fills the grid from the JSON above (`populateCorrectionsGrid(corrections.Corrections)`). `dom-extract.extractCorrectionRows` remains for parity checks against rendered captures only.

Response shape (observed): top-level `WorkflowInstance`, `Corrections[]`, `ReviewCycles[]`, `CorrectionStatusTypes[]`, `ReviewGroups[]`, permission flags. Mapping, verified field by field against the rendered Reviews tab for all five 11854 comments:

| JSON field | Maps to | Evidence |
|---|---|---|
| `ReferenceNumber` | `ref_number` (key `ref:N`) | 1–5 match REF # |
| `Department` | `department` | PRC, DOEE EV, DOEE AQ match |
| `ReviewerName` | presence only → `reviewer_role = reviewer`. **The name is never read** | non-null on all five |
| `DateCreated` | `reviewed_at` | 2025-09-15T08:37:14 = tab "9/15/25 8:37 AM" (Ref 4); same minute for all five |
| `ReviewCycle` | `cycle` | null on Ref 1 and 2 (blank on the tab and report), 1, 1, 2 |
| `StatusName` | `status` | Resolved, Unresolved, Info Only match; `CorrectionStatusTypes` also lists Question |
| `CorrectionType` | `comment_type` | Comment |
| `CommentText` | `body` | may be HTML (Ref 3); reduced to visible text, emails → `[email]` |
| `FileName` | `file_name` | the literal `"None"` when no sheet; stored as null. Real sheet names observed on 28933 |
| `RequireApplicantResponse` | response column | true on Ref 3 only (the editable box) |
| `Discussions[].ResponseType` | `responder_role` | `Applicant` → applicant, `Reviewer` → reviewer |
| `Discussions[].DateUpdated` | `responded_at` | matches the tab minute on all five entries. `DateCreated` is the placeholder `0001-01-01` |
| `Discussions[].Description` | response `body` | verbatim |
| `Discussions[]` order | newest-first in JSON; stored oldest-first | Ref 3 |

Not mapped: `ReviewerName`, `CreatedByUserID`, `UserFullName`, `UserFirstName`, `UserLastName`, `UserCompany`, `UpdatedBy`, `MarkupName`, `TaskName`, `InstanceName` (personal or not needed).

Response column rule: `RequireApplicantResponse = true` → "Type your response here."; else `StatusName = "Info Only"` → "No response required."; else none. Observed on 11854 (Ref 3 and Ref 5).

Acceptance:
- Every comment has a REF #, department, status and cycle (or explicit null).
- The number of `Unresolved` comments equals the `GetWorkflowInstanceStatusData` unresolved total. A mismatch sets `partial` (`unresolved_parity`).
- Responses keep their order and role. No reviewer or responder name is stored.
- No workflow instance → `absent`. A failed JSON read never produces an empty `ok`.

### 3.2 Info

**Source:** `GET /Project/ProjectInfo?ProjectID=N&ProjectTemplateID=5` (HTML partial).

The raw partial is server-rendered (checked 2026-11-06 with an in-page GET): `#projectInfoContainer`, 15 `table.project-fields` rows, all labels below, two `span.start-date`, no template markers. The extractor therefore works on what the transport fetches.

| Label on the portal | Target | Rule |
|---|---|---|
| Description | `description` | visible text |
| Location | `address` | visible text |
| Contact | `contact_org` | organisation name only (observed as an organisation) |
| Project Owner | `owner_org` | visible text (observed "Building Permits") |
| Job Class | `job_class` | visible text |
| Status | `status_raw` | cross-check against Status JSON; not authoritative |
| Review Cycle | `review_cycle` | integer |
| Project Start/End | `project_start_date`, `project_end_date` | date only, `M/D/YYYY` → `YYYY-MM-DD` |
| Latitude, Longitude | `latitude`, `longitude` | numbers when present (blank observed) |
| Project name | not mapped to title | equals the permit number on this portal (D2500488) |
| Contact's Email, Owner's Email, Phone, Cell Phone | **never read** | personal data |

### 3.3 Status (JSON)

**Source:** `GET /WorkflowInstance/GetWorkflowInstanceStatusData?wflowInstanceID=W`. Unchanged; implemented in `normalize.statusFields`. Authority for `status`, unresolved totals per group and `UncompleteTaskCount`.

### 3.4 Tasks

**Source:** `GET ApiUrl/WorkflowAggregate/GetActiveWorkflowTaskList?projectID=N&wflowActivityID=&onlyActiveTaskStatus=true&showTasksForAllUsers=false&pk=WFlowTaskID`.

The response is an **object**, not an array: `Tasks[]`, `PagedTasks[]`, `RecordCount`, `WFlowInstanceID`, `UserID`, permission flags and lookups. The adapter previously read `Items`/`Records` and would have stored no tasks; it now reads `Tasks`.

Observed task item (9187, one accepted "Upload and Submit" task):

| JSON field | Maps to | Note |
|---|---|---|
| `WFlowTaskID` | key | |
| `WFlowInstanceID` | `workflow_portal_id` | |
| `TaskName` | `name` | |
| `GroupName` | `group_name` | "Applicant" |
| `TaskStatus` | `status` | "Accepted" |
| `DateAccepted` | `accepted = true` when present | an unaccepted task was not observed, so absence maps to null, not false |
| `DateDue` | `due_at` | |
| `DateCompleted` | `completed_at` | null on active tasks |
| `DateCreated` | not mapped | task creation is not a start date; left for a product decision |
| `User`, `UserName`, `TaskUserFullName`, `UserEmail`, `UserID`, `ReassignedFromUserID`, `IncludedAllInGroupUsers` | **never read** | personal |
| `WorkflowTaskURL` | **never read** | an EForm link with `autoAssignTask=true` (deny-listed) |

11854 and 28933 had `RecordCount 0`. `assigned_to_current_account` stays null: the list is scoped with `showTasksForAllUsers=false`, but that scoping was not confirmed against a task assigned to someone else.

### 3.5 Files and folders

**Sources:** `GET /Folder/GetProjectFolders?projectID=N&folderID=` and `GET /File/GetFolderFiles?folderID=F&projectID=N&listMode=3&pageIndex=0&pageSize=500&pk=FileID` (JSON). Unchanged.

Rules: metadata only; `download_permitted` from folder permissions, falling back to the account flag (`false`); `Thumbnail`, `viewFile`, `viewInfo` and download links are never stored or followed; author names are not stored; paging mismatch → `partial`; markup files recorded as flags only.

### 3.6 Reports

**List:** `GET ApiUrl/Report/GetReportList?assignedToProjectOnly=true&projectId=N&reportTypes=1&reportTypes=10&reportTypes=11` (JSON array). Route `report_list`. This is the call the Reports grid (`#grdReports`, Infragistics `igGrid`) is filled from; the same array is also inlined in the tab HTML.

| JSON field | Maps to |
|---|---|
| `QueryReportID` | key and `portal_report_id` |
| `QueryReportTitle` | `name` |
| `ReportType` (`Project` / `ProjectFlow`) | `category` |
| `ReportPath`, `ReportDataSourceName`, `ReportParamQueryString` | used to build the viewer URL; not stored |

Observed on 11854: IDs 4 (Project), 12, 14, 15, 16 (ProjectFlow). `ReportParamQueryString` is `&ProjectID=11854&WFlowInstanceID=11975&Timezone=` for ProjectFlow reports.

**Review Comments report body:** `GET /WebForms/ReportViewer.aspx?ReportID=14&ReportPath=/WashingtonDCProd/ProjectDox/Plan Review - Review Comments&DataSourceName=DataSource1&ProjectID=N&WFlowInstanceID=W&Timezone=`. This is the URL the grid's launcher builds (`Globals.UiUrl + '/WebForms/ReportViewer.aspx?ReportID=…'`). A plain GET with the session cookies returns the rendered first page inline (SSRS ReportViewer 14.0); no postback is needed. Observed: 11854 (5 rows) and 28933 (In Review, `TotalPages 1`, content present).

Structure (generated class names change per render, so nothing anchors on classes):

| Element | Rule |
|---|---|
| Header | `Project Name:` value, `Workflow Started: M/D/YYYY h:mm:ss AM`, `Report Generated: MM/DD/YYYY h:mm AM` |
| Table | the `tr` whose cells read REF #, CYCLE, REVIEWED BY, TYPE, FILENAME, DISCUSSION, STATUS (same header classification as `lib/reviewCommentsExcelStructuredRows.js`); data rows are its following siblings with a numeric REF # |
| REVIEWED BY | `DEPT<br>NAME<br>M/D/YY h:mm AM`: department and date read, **name line skipped** |
| TYPE | `Comment<br>text…`: first line is the type, the rest is the body |
| CYCLE, FILENAME | `&nbsp;` when blank → null |
| DISCUSSION | entries start `Responded by: NAME - date` (applicant) or `Reviewer Response: NAME - date` (reviewer), separated by a dashed line; newest-first; **name skipped** |
| Pager | `[id$="_TotalPages"]`. Anything other than 1 is refused (`PortalChangedError`), because only page 1 is in the GET response |

Cross-check against the JSON (11854): REF, department, cycle, status, type, body and response text and roles match for all five rows. Two response times differ: the report prints Ref 1 at 12:27 PM and Ref 4 at 4:41 PM, while the JSON `DateUpdated` and the Reviews tab show 12:29 PM and 4:43 PM. The report reads a different timestamp. This is why the JSON is primary and the report is the fallback.

Other reports (4, 12, 15, 16) are listed only; their bodies are not parsed.

### 3.7 Redaction and storage rules

- Personal names, emails and phone numbers never enter the repo, fixtures, logs, or the database. Reviewer and applicant are roles. Emails inside free text become `[email]` (D-029).
- Organisation names (for example HOWARD UNIVERSITY, DOEE AQ) are allowed.
- The `Sessionid` JWT (`Globals.Session.SessionID`) is never logged or stored.
- Redacted fixtures keep placeholders `[REVIEWER]`, `[EMAIL]`, `[PHONE]`, `[redacted]`.

### 3.8 Failure and status semantics

| Condition | Section status |
|---|---|
| No workflow instance (Reviews) | `absent` |
| Corrections JSON fails, report succeeds | `ok` with `source_kind = report` and `json_failed:<code>` |
| Both fail | `failed`; stored rows kept |
| Route returned login or `SessionEnded` | auth failure for the whole run |
| HTML lacks the expected container or table | `failed`, `PortalChangedError` |
| Report has more than one page | `failed`, `PortalChangedError` |
| Unresolved count mismatch | `partial` |
| Files paging incomplete | `partial` |

### 3.9 Time zone (U-4)

Evidence, 2026-11-06:
- JSON `WorkflowInstance.DateStarted` `2025-08-28T14:56:11.223` and the report header `Workflow Started: 8/28/2025 2:56:11 PM` are the same wall-clock value. JSON and report share one server clock.
- The report printed `Report Generated: 11/05/2026 11:19 AM` (and 11:25 AM on a second report) at 16:19 / 16:25 UTC. That server clock is UTC−5, which is America/New_York (EST) on that date.
- The Reviews tab displays the JSON digits unchanged (`Globals.DateTimeFormat = "M/d/yy h:mm tt"`) even though the browser was at UTC+8. The page does not convert to browser time. `Globals.CurrentUser` has no time-zone field.

Conclusion: offset-less JSON and Reviews times are America/New_York wall clock. Verified for the current EST offset. Summer values (EDT) follow the IANA rule. That part is inferred from the zone and was not separately observed, because no summer event with a known UTC time was available. The normalizer converts with `zonedToUtcIso` (D-017).

## 4. Unverified items

| # | Item | Result (2026-11-06) | Status |
|---|---|---|---|
| U-1 | Review Comments report body and launcher | Launcher URL read from the grid JS; viewer opened once; plain GET returns the report; structure captured, redacted and parsed (3.6) | **Closed** |
| U-2 | Reports list source | `GetReportList` JSON (3.6); tab HTML holds the same array | **Closed** |
| U-3 | Active task JSON field names | Object with `Tasks[]`; fields in 3.4 from one live task. `assigned_to_current_account` and the unaccepted state not observed | **Closed for mapped fields**; two fields stay null by design |
| U-4 | Time zone of offset-less dates | Same clock in JSON, report and tab; server clock = America/New_York (EST observed) | **Closed** (EDT inferred from zone, 3.9) |
| U-5 | Reviews partial per status | The partial is a template shell for every status. JSON returns data for Resubmit (11854: 5) and In Review (28933: 38); 9187 (Upload): 0 | **Closed**; the source changed to JSON |
| U-6 | MFA / CAPTCHA on a fresh login, session lifetime under automation | Needs the A-3 live run | **Open** |
| U-7 | Partials and report over the session cookies, without opening the tab | In-page GETs with cookies returned `ProjectInfo` (server-rendered) and `ReportViewer.aspx` (report inline). The transport uses Playwright `context.request`, which shares the browser context's cookies; that exact client was not run live | **Closed for the data path**; client confirmed at A-3 |

Live findings that changed code:
- The session id is at `Globals.Session.SessionID`; `window.Session` is undefined. `ensureApiSession` read the wrong object and would have failed at the first API call.
- `GetActiveWorkflowTaskList` returns `{ Tasks: [...] }`; the adapter read `Items`/`Records`.
- The Reviews HTML partial has no data; Reviews moved to the JSON.

## 4a. Implementation status (2026-11-06)

| Item | Status |
|---|---|
| Reviews from corrections JSON (`normalize.correctionRowsFromJson`, route `project_corrections_json`) | Implemented; tested against the live-captured 11854 JSON and the rendered Reviews tab |
| Review Comments report parser (`dom-extract.extractReviewCommentsReport`) | Implemented; tested in Chromium against the redacted 11854 report and cross-checked with the JSON |
| Reports list (`normalize.reportListItems`, route `report_list`) | Implemented; tested against the live-captured list |
| Tasks (`Tasks[]`, verified fields) | Implemented; tested against the live-captured 9187 task |
| Info extractor | Implemented; tested; raw partial confirmed server-rendered |
| Transport (`getCorrectionsRows`, `getReviewCommentsReport`, `listReports`, `Globals.Session`) | Implemented; not run through Playwright against the portal (A-3) |
| Adapter (JSON primary, report fallback, `absent` without workflow) | Implemented; tested with the fixture transport and worker |
| Deployed / production-verified | No / No |

## 5. Acceptance criteria for the DC milestone

1. Offline: Reviews JSON mapper output matches the rendered Reviews tab for 11854. Report parser output matches the JSON (with the two documented time differences). Info parser matches the Info values. Chromium DOM for the HTML parsers. **Met.**
2. Offline: `npm run test:permit-sync` passes, including parity, partial, fallback and failed states. **Met.**
3. Transport reads go through the read-only guard; HTML is parsed in the page with `DOMParser` (no scripts run). Live sessions refuse without A-3. **Met.**
4. No personal data in fixtures, tests, or logs (scan). **Met.**
5. Nothing deployed, no migration applied, no live worker run. **Met.**

## 6. Out of scope for this milestone

- Live worker runs (A-3), enabling schedules, deploying the worker.
- Downloading or viewing any file content; report export.
- Bodies of reports other than Review Comments.
- Markup (Bluebeam) extraction.
- Jurisdictions other than DC (Phase 4 waits for review of this milestone).
