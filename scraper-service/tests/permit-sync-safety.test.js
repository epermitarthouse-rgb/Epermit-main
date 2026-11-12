"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  DENY_PATTERNS,
  DC_READ_ALLOW,
  DC_PORTAL_HOSTS,
  DC_API_HOST,
  DC_OPEN_READ_HOSTS,
  evaluateRequest,
  evaluateClick,
  createRunGuard,
  redactUrl,
} = require("../permit-sync/core/safety");

const DC_BASE = "https://washington-dc-us-projectdoxwebapi.avolvecloud.com";
const SESSION = "https://session.planreview.dob.dc.gov";

describe("permit-sync safety: request policy (GET-only, allowlisted)", () => {
  it("allows the read-only DC requests observed in DevTools", () => {
    const urls = [
      `${DC_BASE}/Folder/GetProjectFolders?folderID=&projectID=28933`,
      `${DC_BASE}/File/GetFolderFiles?folderID=19&listMode=3&projectID=28933&pageIndex=0&pageSize=500&pk=FileID&_=1`,
      `${DC_BASE}/WorkflowAggregate/GetActiveWorkflowTaskList?wflowActivityID=&projectID=28933&onlyActiveTaskStatus=true&showTasksForAllUsers=false&pk=WFlowTaskID`,
      `${DC_BASE}/WorkflowAggregate/GetWorkflowInstancesList?WFlowStateName=&entityID=28933&entityTypeID=1&checkForRevCoordPerm=true&pageNumber=0&rowCount=6&pk=WFlowInstanceID`,
      `${DC_BASE}/WorkflowInstance/GetWorkflowInstanceStatusData?wflowInstanceID=11975`,
      `${SESSION}/Project/ProjectCorrections?projectID=11854&wflowInstanceID=&timeStamp=1`,
      `${SESSION}/Project/ProjectInfo?ProjectID=11854`,
      `${SESSION}/User/Workflow/WorkflowTaskList?wflowTaskStatusTypeIDList=3&projectID=28933`,
      `${SESSION}/WebForms/ReportViewer.aspx?ReportID=14&ReportPath=/WashingtonDCProd/ProjectDox/Plan%20Review%20-%20Review%20Comments&DataSourceName=DataSource1&ProjectID=28933&WFlowInstanceID=29184&Timezone=`,
    ];
    for (const url of urls) {
      const v = evaluateRequest({ method: "GET", url });
      assert.equal(v.allowed, true, `expected allowed: ${url} (${v.reason})`);
    }
  });

  it("still refuses unnamed GETs on the other Avolve hosts", () => {
    const hosts = [
      "washington-dc-us-projectdoxwebui.avolvecloud.com",
      "washington-dc-us-portalwebapi.avolvecloud.com",
    ];
    const paths = ["/Workflow/GetWorkflowInstances?projectID=29433", "/User/GetSessionTimeout", "/Admin/SomethingNew"];
    for (const host of hosts) {
      for (const path of paths) {
        assert.equal(evaluateRequest({ method: "GET", url: `https://${host}${path}` }).rule, "not_allowlisted", `${host}${path}`);
      }
    }
  });

  it("allows project tab page navigation over GET", () => {
    for (const tab of ["projectStatusTab", "filesTab", "tasksTab", "infoTab", "reportsTab", "correctionsTab"]) {
      const v = evaluateRequest({ method: "GET", url: `${SESSION}/Project/Index?ProjectID=29433&tab=${tab}` });
      assert.equal(v.allowed, true, `tab ${tab}: ${v.reason}`);
    }
  });

  it("denies every non-GET/HEAD method even on an allowlisted path", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const v = evaluateRequest({ method, url: `${DC_BASE}/Folder/GetProjectFolders?projectID=29433` });
      assert.equal(v.allowed, false, method);
      assert.equal(v.rule, "method");
    }
  });

  it("allows HEAD only for allowlisted paths", () => {
    assert.equal(evaluateRequest({ method: "HEAD", url: `${DC_BASE}/Folder/GetProjectFolders` }).allowed, true);
  });

  it("denies plain http and unknown hosts", () => {
    assert.equal(evaluateRequest({ method: "GET", url: "http://session.planreview.dob.dc.gov/Project/Index?ProjectID=1" }).rule, "scheme");
    assert.equal(evaluateRequest({ method: "GET", url: "https://example.com/Folder/GetFolders" }).rule, "host");
    assert.equal(evaluateRequest({ method: "GET", url: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com.evil.test/Folder/GetFolders" }).rule, "host");
  });

  it("denies unparseable URLs and non-allowlisted paths (default deny)", () => {
    assert.equal(evaluateRequest({ method: "GET", url: "not a url" }).rule, "url");
    assert.equal(evaluateRequest({ method: "GET", url: "https://washington-dc-us-projectdoxwebui.avolvecloud.com/Admin/SomethingNew" }).rule, "not_allowlisted");
  });

  it("file body endpoints require allowDownloads", () => {
    const url = `${DC_BASE}/File/RetrieveFile?inline=true&fileID=123`;
    assert.equal(evaluateRequest({ method: "GET", url }).rule, "downloads_disabled");
    const ok = evaluateRequest({ method: "GET", url, allowDownloads: true });
    assert.equal(ok.allowed, true);
    assert.equal(ok.body, true);
  });

  it("allows any GET or HEAD on the two DC web hosts, and still refuses writes, downloads and other hosts (D-048)", () => {
    assert.deepEqual([...DC_PORTAL_HOSTS].sort(), ["planreview.dob.dc.gov", "session.planreview.dob.dc.gov"]);
    const status = `${SESSION}/Project/ProjectStatus?projectID=9187&wflowInstanceID=&timeStamp=1`;
    assert.equal(evaluateRequest({ method: "GET", url: status }).rule, "portal_page_read");
    assert.equal(evaluateRequest({ method: "HEAD", url: status }).allowed, true);
    assert.equal(evaluateRequest({ method: "GET", url: "https://planreview.dob.dc.gov/Project/ProjectStatus?projectID=9187" }).rule, "portal_page_read");
    for (const url of [
      `${SESSION}/File/viewFile?fileID=1`,
      `${SESSION}/Project/Download%20Files?projectID=9187`,
      `${SESSION}/Reserved.ReportViewerWebControl.axd?OpType=Export`,
    ]) {
      const v = evaluateRequest({ method: "GET", url });
      assert.equal(v.allowed, false, url);
      assert.equal(v.rule, "deny_pattern", url);
    }
    assert.equal(evaluateRequest({ method: "GET", url: `${SESSION}/File/RetrieveFile?fileID=1` }).rule, "downloads_disabled");
    assert.equal(evaluateRequest({ method: "POST", url: status }).rule, "method");
    assert.equal(evaluateRequest({ method: "PUT", url: status }).rule, "method");
    assert.equal(evaluateRequest({ method: "GET", url: "https://example.com/Project/ProjectStatus?projectID=1" }).rule, "host");
    assert.equal(evaluateRequest({ method: "GET", url: "https://session.planreview.dob.dc.gov.evil.test/Project/ProjectStatus" }).rule, "host");
  });

  it("allows any GET or HEAD on the one ProjectDox API host, and still refuses writes, downloads and other Avolve hosts (D-049)", () => {
    assert.equal(DC_API_HOST, "washington-dc-us-projectdoxwebapi.avolvecloud.com");
    assert.deepEqual([...DC_OPEN_READ_HOSTS].sort(), [...DC_PORTAL_HOSTS, DC_API_HOST].sort());
    const keepalive = `https://${DC_API_HOST}/User/GetSessionTimeout`;
    assert.equal(evaluateRequest({ method: "GET", url: keepalive }).rule, "portal_page_read");
    assert.equal(evaluateRequest({ method: "HEAD", url: keepalive }).allowed, true);
    for (const url of [
      `https://${DC_API_HOST}/File/viewFile?fileID=1`,
      `https://${DC_API_HOST}/Project/Download%20Files?projectID=9187`,
      `https://${DC_API_HOST}/Reserved.ReportViewerWebControl.axd?OpType=Export`,
    ]) {
      const v = evaluateRequest({ method: "GET", url });
      assert.equal(v.allowed, false, url);
      assert.equal(v.rule, "deny_pattern", url);
    }
    assert.equal(evaluateRequest({ method: "GET", url: `https://${DC_API_HOST}/File/RetrieveFile?fileID=1` }).rule, "downloads_disabled");
    assert.equal(evaluateRequest({ method: "POST", url: keepalive }).rule, "method");
    for (const host of [
      "washington-dc-us-projectdoxwebui.avolvecloud.com",
      "washington-dc-us-portalwebapi.avolvecloud.com",
      "other-us-projectdoxwebapi.avolvecloud.com",
      `${DC_API_HOST}.evil.test`,
    ]) {
      const v = evaluateRequest({ method: "GET", url: `https://${host}/User/GetSessionTimeout` });
      assert.equal(v.allowed, false, host);
    }
  });

  it("denies the observed state-changing endpoints by name", () => {
    const denied = [
      `${DC_BASE}/File/ToggleViewed?fileID=1&viewed=true`, // "Mark as reviewed"
      `${DC_BASE}/WorkflowAggregate/AcceptTask?taskID=522941`,
      `${DC_BASE}/WorkflowAggregate/ProcessTask?taskID=522941`,
      `${SESSION}/Eform.aspx?autoAssignTask=true`,
      `${DC_BASE}/File/Upload`,
      `${DC_BASE}/File/Delete?fileID=1`,
      `${DC_BASE}/File/Move?fileID=1`,
      `${DC_BASE}/Project/SaveUserSettings`,
      `${DC_BASE}/Project/SaveCorrectionResponse`,
      `${DC_BASE}/Workflow/Advance?wflowInstanceID=1`,
      `${SESSION}/Project/ApprovedPlans?projectID=11105&showApprovedPlans=true&RemoteInvoke=true`,
      `${SESSION}/Reserved.ReportViewerWebControl.axd?OpType=Export&Format=PDF`,
      `${SESSION}/WebForms/ReportViewer.aspx?ReportID=14&rs:Format=PDF`,
      `${SESSION}/WebForms/SessionEnded.aspx`,
    ];
    for (const url of denied) {
      const v = evaluateRequest({ method: "GET", url, allowDownloads: true });
      assert.equal(v.allowed, false, `must deny ${url}`);
    }
  });

  it("deny patterns are checked before allowlist (no allowed path also matches a deny pattern)", () => {
    for (const rule of DC_READ_ALLOW) {
      const sample = `${DC_BASE}${samplePathFor(rule.name)}`;
      for (const p of DENY_PATTERNS) {
        assert.equal(p.test(sample), false, `allow rule ${rule.name} collides with deny ${p}`);
      }
    }
  });
});

describe("permit-sync safety: click policy", () => {
  it("denies the observed DC handler strings", () => {
    const handlers = [
      "AcceptTask(522941, 'Accept')",
      "ProcessTask(522941)",
      "launchEForm('Eform.aspx?autoAssignTask=true&x=1')",
      "ToggleViewed(12345, true)",
      "projectTree.deleteFiles()",
      "Upload file",
      "Mark as reviewed",
      "viewFile(123)",
      "GridPersistUtility.saveUserSettingsOfGrid('grid')",
      "launchEForm('Project/ApprovedPlans?projectID=11105&showApprovedPlans=true')",
      "Download Files",
      "Respond and Resubmit",
      "Log Out",
    ];
    for (const onclick of handlers) {
      const v = evaluateClick({ tag: "a", href: "javascript:void(0)", onclick, text: "x" });
      assert.equal(v.allowed, false, `must deny handler ${onclick}`);
    }
  });

  it("denies form fields, submit buttons and non-GET forms", () => {
    assert.equal(evaluateClick({ tag: "input", type: "text" }).allowed, false);
    assert.equal(evaluateClick({ tag: "textarea" }).allowed, false);
    assert.equal(evaluateClick({ tag: "button", type: "submit", text: "Save" }).allowed, false);
    assert.equal(evaluateClick({ tag: "button", formMethod: "POST", text: "Go" }).allowed, false);
  });

  it("allows only allowlisted read-only tab links", () => {
    const ok = evaluateClick({ tag: "a", href: `${SESSION}/Project/Index?ProjectID=29433&tab=filesTab` });
    assert.equal(ok.allowed, true);
    const bad = evaluateClick({ tag: "a", href: `${SESSION}/Project/Index?ProjectID=29433&tab=evilTab&x=AcceptTask` });
    assert.equal(bad.allowed, false);
  });

  it("allows dashboard pager links only for page-number/navigation text with no handler", () => {
    for (const text of ["1", "2", "28", "Next", "Prev", "Last", "»"]) {
      assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", text }).rule, "dashboard_pager", text);
    }
    assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", text: "Accept" }).allowed, false);
    assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", text: "Delete" }).allowed, false);
    assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", text: "2", onclick: "doSomething()" }).allowed, false);
    assert.equal(evaluateClick({ tag: "button", href: "javascript:void(0)", text: "2" }).allowed, false);
    assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", text: "Log Out" }).allowed, false);
  });

  it("allows launchRemote only for Project/Index with a numeric ProjectID", () => {
    const ok = [
      { tag: "a", href: "javascript:launchRemote('Project/Index?tab=projectStatusTab&ProjectID=28933')", text: "D2500488" },
      { tag: "a", href: "javascript:void(0)", onclick: "launchRemote('Project/Index?tab=filesTab&ProjectID=11105'); return false;", text: "B2400001" },
      { tag: "a", href: "#", onclick: 'launchRemote("Project/Index?tab=projectStatusTab&ProjectID=9187")', text: "x" },
    ];
    for (const el of ok) assert.equal(evaluateClick(el).rule, "launch_remote_project", JSON.stringify(el));
    const bad = [
      "launchRemote('Project/ApprovedPlans?projectID=11105')",
      "launchRemote('Project/Index?tab=filesTab&ProjectID=11105&x=1')",
      "launchRemote('Project/Index?tab=filesTab&ProjectID=11105'); AcceptTask(1)",
      "launchRemote('Project/Index?tab=filesTab&ProjectID=11105'); doOther()",
      "launchRemote('https://evil.example/Project/Index?tab=a&ProjectID=1')",
      "launchRemote('Project/Index?tab=a&ProjectID=abc')",
    ];
    for (const onclick of bad) {
      assert.equal(evaluateClick({ tag: "a", href: "javascript:void(0)", onclick, text: "x" }).allowed, false, onclick);
    }
    assert.equal(
      evaluateClick({ tag: "a", href: "javascript:doOther()", onclick: "launchRemote('Project/Index?tab=a&ProjectID=1')", text: "x" }).allowed,
      false,
    );
  });

  it("allows the dashboard root and the SSO hop only to Project/Index", () => {
    assert.equal(evaluateRequest({ url: "https://planreview.dob.dc.gov/" }).rule, "dashboard_home");
    assert.equal(evaluateRequest({ url: "https://planreview.dob.dc.gov/login/sso?url=Project/Index?tab=projectStatusTab&ProjectID=28933" }).rule, "sso_hop");
    assert.equal(evaluateRequest({ url: "https://planreview.dob.dc.gov/login/sso?url=Project/ApprovedPlans?projectID=1" }).allowed, false);
    assert.equal(evaluateRequest({ url: "https://planreview.dob.dc.gov/login/sso?url=Workflow/AcceptTask" }).allowed, false);
    assert.equal(evaluateRequest({ url: "https://planreview.dob.dc.gov/Dashboard/Other" }).rule, "portal_page_read");
    assert.equal(evaluateRequest({ method: "POST", url: "https://planreview.dob.dc.gov/" }).allowed, false);
  });

  it("default-denies unknown elements", () => {
    assert.equal(evaluateClick({ tag: "div", text: "Continue" }).allowed, false);
  });
});

describe("permit-sync safety: run guard", () => {
  it("records decisions and requests abort after any violation", () => {
    const guard = createRunGuard({ allowDownloads: false });
    guard.checkRequest("GET", `${DC_BASE}/Folder/GetProjectFolders?projectID=29433`);
    assert.equal(guard.shouldAbort(), false);
    guard.checkRequest("POST", `${DC_BASE}/Folder/GetProjectFolders`);
    assert.equal(guard.shouldAbort(), true);
    assert.equal(guard.violations().length, 1);
    assert.equal(guard.entries().length, 2);
  });

  it("records denied clicks as violations", () => {
    const guard = createRunGuard({});
    guard.checkClick({ tag: "a", href: "javascript:AcceptTask(522941)", text: "Accept" });
    assert.equal(guard.shouldAbort(), true);
  });
});

describe("permit-sync safety: log redaction", () => {
  it("keeps only whitelisted query params and masks the rest", () => {
    const out = redactUrl(`${SESSION}/Project/Index?ProjectID=29433&tab=filesTab&user=jane%40example.com&token=abc`);
    assert.equal(out, `${SESSION}/Project/Index?ProjectID=29433&tab=filesTab&user=*&token=*`);
    assert.equal(out.includes("jane"), false);
    assert.equal(out.includes("abc"), false);
  });
});

/** Representative path per allow rule, used only for collision testing. */
function samplePathFor(name) {
  const map = {
    dashboard_home: "/",
    sso_hop: "/login/sso?url=Project/Index?tab=projectStatusTab&ProjectID=1",
    project_folders: "/Folder/GetProjectFolders?folderID=&projectID=1",
    folder_files: "/File/GetFolderFiles?folderID=1&listMode=3&projectID=1",
    active_task_list: "/WorkflowAggregate/GetActiveWorkflowTaskList?projectID=1",
    workflow_instances_list: "/WorkflowAggregate/GetWorkflowInstancesList?entityID=1&entityTypeID=1",
    workflow_status: "/WorkflowInstance/GetWorkflowInstanceStatusData?wflowInstanceID=1",
    project_corrections_json: "/WorkflowAggregate/GetProjectCorrectionsByCycleInstance?wflowInstanceID=1&wflowTaskID=&wflowActivityID=&groupID=&wflowReviewCycleID=&retrieveFilterOptions=true",
    report_list: "/Report/GetReportList?assignedToProjectOnly=true&projectId=1&reportTypes=1&reportTypes=10&reportTypes=11",
    project_page: "/Project/Index?ProjectID=1&tab=filesTab",
    project_corrections: "/Project/ProjectCorrections?projectID=1&wflowInstanceID=&timeStamp=1",
    project_info: "/Project/ProjectInfo?ProjectID=1",
    task_list_partial: "/User/Workflow/WorkflowTaskList?projectID=1",
    review_comments_report: "/WebForms/ReportViewer.aspx?ReportID=14&ReportPath=/WashingtonDCProd/ProjectDox/Plan%20Review%20-%20Review%20Comments&ProjectID=1&WFlowInstanceID=1",
    file_retrieve: "/File/RetrieveFile?inline=true&fileID=1",
    markup_pdf: "/WorkflowChangemark/RetrieveMarkupPDF/1",
  };
  return map[name];
}

describe("D-079 report pre-check leaves the guard unchanged", () => {
  const safety = require("../permit-sync/core/safety");
  const { routeReadRequest } = require("../permit-sync/adapters/dc-projectdox/live-transport");
  const report4 = "https://session.planreview.dob.dc.gov/WebForms/ReportViewer.aspx?ReportID=4&ReportPath=/WashingtonDCProd/ProjectDox/Current%20Project%20-%20All%20Uploaded%20Files%20with%20Sheet%20Sizes&DataSourceName=DataSource1&ProjectID=6364&Timezone=";

  it("deep mode lifts exactly viewFile, OpType=Export and rs:Format=; /Upload/i stays", () => {
    const json = safety.MODES.json.deny.map(String);
    const deep = safety.MODES.deep.deny.map(String);
    assert.deepEqual(json.filter((p) => !deep.includes(p)).sort(), ["/OpType=Export/i", "/rs:Format=/i", "/viewFile/i"]);
    assert.ok(deep.includes("/Upload/i"));
    assert.equal(json.length, safety.DENY_PATTERNS.length);
  });

  it("json mode still refuses the report 4 viewer URL (the D-081 exemption is deep-only)", () => {
    const guard = safety.createRunGuard({ mode: "json" });
    const d = routeReadRequest({ method: "GET", url: report4, resourceType: "document" }, guard);
    assert.equal(d.action, "abort");
    assert.equal(d.violation, true);
    assert.equal(d.rule, "deny_pattern");
  });

  it("mutations still abort in deep mode", () => {
    const guard = safety.createRunGuard({ mode: "deep" });
    for (const url of [
      "https://session.planreview.dob.dc.gov/Workflow/AcceptTask?taskId=1",
      "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/Upload",
      "https://washington-dc-us-projectdoxwebapi.avolvecloud.com/File/ToggleViewed?fileId=1",
      "https://session.planreview.dob.dc.gov/Project/Resubmit?ProjectID=6364",
    ]) {
      const d = routeReadRequest({ method: "GET", url, resourceType: "xhr" }, guard);
      assert.equal(d.violation, true, url);
    }
    assert.equal(routeReadRequest({ method: "POST", url: "https://session.planreview.dob.dc.gov/Project/SaveSettings", resourceType: "xhr" }, guard).violation, true);
  });
});

describe("D-081 report-identity values are not deny-checked (deep mode)", () => {
  const safety = require("../permit-sync/core/safety");
  const { routeReadRequest } = require("../permit-sync/adapters/dc-projectdox/live-transport");
  const SESSION = "https://session.planreview.dob.dc.gov";
  const report4 = `${SESSION}/WebForms/ReportViewer.aspx?ReportID=4&ReportPath=/WashingtonDCProd/ProjectDox/Current%20Project%20-%20All%20Uploaded%20Files%20with%20Sheet%20Sizes&DataSourceName=DataSource1&ProjectID=6364&Timezone=`;
  const exportUrl = `${SESSION}/Reserved.ReportViewerWebControl.axd?ReportSession=abc&Culture=1033&CultureOverrides=True&UICulture=1033&UICultureOverrides=True&ReportStack=1&ControlID=ctl&OpType=Export&FileName=Current+Project+-+All+Uploaded+Files+with+Sheet+Sizes&ContentDisposition=OnlyHtmlInline&Format=PDF`;

  it("report 4's viewer URL and an export URL whose FileName says Uploaded pass", () => {
    const guard = safety.createRunGuard({ mode: "deep" });
    for (const url of [report4, exportUrl]) {
      const v = guard.checkRequest("GET", url);
      assert.equal(v.allowed, true, url);
      const d = routeReadRequest({ method: "GET", url, resourceType: "document" }, guard);
      assert.equal(d.action, "continue", url);
      assert.equal(d.violation, false, url);
    }
    assert.equal(guard.shouldAbort(), false);
    assert.equal(safety.evaluateRequest({ method: "GET", url: report4.replace("ReportPath=", "reportpath="), mode: "deep" }).allowed, true, "parameter names match case-insensitively");
  });

  it("an Upload path, a task or upload parameter on the same pages, and a POST mutation are still denied", () => {
    const denied = [
      ["GET", `${SESSION}/File/Upload?ProjectID=6364`],
      ["GET", `${SESSION}/WebForms/Upload/ReportViewer.aspx?ReportID=4`],
      ["GET", `${SESSION}/WebForms/ReportViewer.aspx?ReportID=4&ReportPath=x&action=AcceptTask`],
      ["GET", `${SESSION}/WebForms/ReportViewer.aspx?ReportID=4&ReportPath=x&next=%2FFile%2FUpload`],
      ["GET", `${SESSION}/Reserved.ReportViewerWebControl.axd?OpType=Export&FileName=x&target=Upload`],
      ["GET", `${SESSION}/Reserved.ReportViewerWebControl.axd?OpType=Export&FileName=x&cmd=Log+Out`],
      ["GET", `${SESSION}/Project/Index?ProjectID=6364&ReportPath=Uploaded`],
      ["GET", `https://washington-dc-us-projectdoxwebui.avolvecloud.com/WebForms/ReportViewer.aspx?ReportPath=Uploaded`],
      ["POST", report4],
      ["POST", `${SESSION}/Workflow/AcceptTask?taskId=1`],
    ];
    for (const [method, url] of denied) {
      const guard = safety.createRunGuard({ mode: "deep" });
      const d = routeReadRequest({ method, url, resourceType: "xhr" }, guard);
      assert.equal(d.action, "abort", `${method} ${url}`);
      assert.equal(d.violation, true, `${method} ${url}`);
      assert.equal(d.rule, "deny_pattern", `${method} ${url}`);
    }
  });

  it("HEAD gets the exemption, other methods never do", () => {
    assert.equal(safety.evaluateRequest({ method: "HEAD", url: report4, mode: "deep" }).allowed, true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(safety.evaluateRequest({ method: m, url: report4, mode: "deep" }).rule, "deny_pattern", m);
    }
  });
});

describe("D-092 one portalwebapi keepalive in deep mode", () => {
  const safety = require("../permit-sync/core/safety");
  const { routeReadRequest } = require("../permit-sync/adapters/dc-projectdox/live-transport");
  const HOST = "washington-dc-us-portalwebapi.avolvecloud.com";
  const url = `https://${HOST}/User/GetSessionTimeout`;

  it("allows GET and HEAD of that exact path in deep mode, and json mode still refuses it", () => {
    assert.equal(safety.DC_PORTALWEBAPI_HOST, HOST);
    assert.equal(safety.DC_SESSION_TIMEOUT_PATH, "/User/GetSessionTimeout");
    assert.equal(safety.DC_OPEN_READ_HOSTS.includes(HOST), false, "the host is not opened for every path");
    for (const method of ["GET", "HEAD"]) {
      const v = safety.evaluateRequest({ method, url, mode: "deep" });
      assert.equal(v.allowed, true, method);
      assert.equal(v.rule, "session_timeout_keepalive", method);
      assert.equal(v.body, false, method);
    }
    assert.equal(safety.evaluateRequest({ method: "GET", url: `${url}?_=1`, mode: "deep" }).rule, "session_timeout_keepalive", "a query does not change the path");
    assert.equal(safety.evaluateRequest({ method: "GET", url }).rule, "not_allowlisted");
    const guard = safety.createRunGuard({ mode: "deep" });
    const d = routeReadRequest({ method: "GET", url, resourceType: "xhr" }, guard);
    assert.equal(d.action, "continue");
    assert.equal(d.violation, false);
    assert.equal(d.rule, "session_timeout_keepalive");
    assert.equal(guard.shouldAbort(), false);
  });

  it("refuses another path, a POST, and a look-alike host, and still drops POST FileViewer", () => {
    const otherPath = safety.evaluateRequest({ method: "GET", url: `https://${HOST}/User/Profile`, mode: "deep" });
    assert.equal(otherPath.allowed, false);
    assert.equal(otherPath.rule, "not_allowlisted");
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://${HOST}/User/GetSessionTimeout/extra`, mode: "deep" }).rule, "not_allowlisted");
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://${HOST}/User/GetSessionTimeoutExtra`, mode: "deep" }).rule, "not_allowlisted");
    assert.equal(safety.evaluateRequest({ method: "GET", url: `${url}?next=/File/Upload`, mode: "deep" }).rule, "deny_pattern");
    assert.equal(safety.evaluateRequest({ method: "POST", url, mode: "deep" }).rule, "method");
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://${HOST}.evil.test/User/GetSessionTimeout`, mode: "deep" }).rule, "host");
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://not-${HOST}/User/GetSessionTimeout`, mode: "deep" }).rule, "host");

    const guard = safety.createRunGuard({ mode: "deep" });
    const pathDenied = routeReadRequest({ method: "GET", url: `https://${HOST}/User/Profile`, resourceType: "xhr" }, guard);
    assert.equal(pathDenied.action, "abort");
    assert.equal(pathDenied.violation, true);
    assert.equal(pathDenied.rule, "not_allowlisted");
    const post = routeReadRequest({ method: "POST", url, resourceType: "xhr" }, guard);
    assert.equal(post.action, "abort");
    assert.equal(post.violation, true);
    assert.equal(post.rule, "method");
    assert.equal(guard.shouldAbort(), true);

    const fresh = safety.createRunGuard({ mode: "deep" });
    const fileViewer = routeReadRequest(
      { method: "POST", url: "https://session.planreview.dob.dc.gov/File/FileViewer?fileID=1", resourceType: "document" },
      fresh,
    );
    assert.equal(fileViewer.action, "abort");
    assert.equal(fileViewer.violation, false);
    assert.equal(fileViewer.rule, "method_dropped");
    assert.equal(fresh.shouldAbort(), false);
  });
});
