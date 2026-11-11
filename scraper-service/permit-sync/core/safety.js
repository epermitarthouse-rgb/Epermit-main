"use strict";

/**
 * Read-only safety guard for permit-sync portal adapters.
 *
 * Pure functions only (no Playwright import) so the policy is unit-testable.
 * The Playwright wiring (context.route + safeClick) lives in the adapter layer
 * and must call `evaluateRequest` / `evaluateClick` for every request and click.
 *
 * Policy (default deny):
 *   1. Only GET/HEAD requests are sent. Any other method is refused. A deny
 *      pattern refuses the request and fails the job. A non-GET/HEAD that does
 *      not match a deny pattern is dropped by the read phase without a violation.
 *   2. Host must be on the allowlist for the adapter.
 *   3. Deny patterns are checked BEFORE allow patterns. A match aborts the job.
 *   4. A named read route must match an explicit allow pattern.
 *   5. File-body endpoints (RetrieveFile) require `allowDownloads: true`.
 *   6. On the two DC web hosts (DC_PORTAL_HOSTS) and the one ProjectDox API host
 *      (DC_API_HOST), any other GET/HEAD is allowed. Those pages request paths the
 *      manual scraper never filtered. This does not extend to any other host, and
 *      it never skips a deny pattern or a file-body check.
 *
 * Deny patterns are derived from handler strings observed on the live DC
 * ProjectDox pages (Phase 0 evidence, 2026-11-04/05):
 *   AcceptTask(522941,...), ProcessTask(522941), launchEForm('...autoAssignTask=true...'),
 *   File/ToggleViewed ("Mark as reviewed"), projectTree.deleteFiles(),
 *   Upload / Move / Delete controls, comment and response save endpoints,
 *   Settings save (GridPersistUtility.saveUserSettingsOfGrid), viewFile,
 *   launchEForm(Project/ApprovedPlans...), Download Files, Respond and Resubmit,
 *   SSRS report export, Log Out.
 */

const DENY_PATTERNS = Object.freeze([
  // Task state transitions
  /AcceptTask/i,
  /ProcessTask/i,
  /autoAssignTask/i,
  /launchEForm/i,
  /Eform\.aspx/i,
  /ReassignTask/i,
  /CompleteTask/i,
  /SubmitTask/i,
  // File state / mutation
  /ToggleViewed/i,
  /deleteFiles/i,
  /\/File\/(Upload|Delete|Move|Rename|Copy|Save|Update|Insert|Create|Add|Remove|Check)/i,
  /\/Folder\/(Create|Delete|Move|Rename|Update|Save)/i,
  /Upload/i,
  // Comments / responses / reviews
  /(Save|Insert|Update|Create|Delete|Submit|Respond|Reply|Response|Comment)[A-Za-z]*(Correction|Comment|Response|Review|Task)/i,
  /\/Project\/(Save|Update|Create|Delete|Submit)/i,
  // Settings / grid preferences
  /SaveUserSettings/i,
  /SaveSettings/i,
  /Save Settings/i,
  /GridSettings/i,
  // Workflow mutations
  /\/Workflow\/(Start|Stop|Cancel|Advance|Complete|Accept|Process|Assign|Reassign|Set)/i,
  // Dashboard / file viewer / approved-plans / resubmit controls (observed 2026-11-05)
  /viewFile/i,
  /ApprovedPlans/i,
  /Download\s*Files/i,
  /Resubmit/i,
  // SSRS report export (ReportViewer export menu)
  /OpType=Export/i,
  /rs:Format=/i,
  // Session teardown
  /SessionEnded/i,
  /Log\s*Out/i,
]);

/**
 * Explicit read-only GET allow patterns for DC ProjectDox, limited to requests
 * observed in DevTools on the live portal (see EXTRACTION_SPEC_DC.md).
 * Each entry: { name, pattern, body } where body=true means the response is a file payload.
 */
const DC_READ_ALLOW = Object.freeze([
  // JSON API on ApiUrl (Sessionid header)
  { name: "project_folders", pattern: /\/Folder\/GetProjectFolders(\?|$)/i, body: false },
  { name: "folder_files", pattern: /\/File\/GetFolderFiles(\?|$)/i, body: false },
  { name: "active_task_list", pattern: /\/WorkflowAggregate\/GetActiveWorkflowTaskList(\?|$)/i, body: false },
  { name: "workflow_instances_list", pattern: /\/WorkflowAggregate\/GetWorkflowInstancesList(\?|$)/i, body: false },
  { name: "workflow_status", pattern: /\/WorkflowInstance\/GetWorkflowInstanceStatusData(\?|$)/i, body: false },
  { name: "project_corrections_json", pattern: /\/WorkflowAggregate\/GetProjectCorrectionsByCycleInstance(\?|$)/i, body: false },
  { name: "report_list", pattern: /\/Report\/GetReportList(\?|$)/i, body: false },
  // Dashboard document and the launchRemote SSO hop (planreview.dob.dc.gov/login/sso?url=Project/Index?...)
  { name: "dashboard_home", pattern: /^\/(\?.*)?$/, body: false },
  { name: "sso_hop", pattern: /^\/login\/sso\?url=Project(\/|%2F)Index(\?|%3F)/i, body: false },
  // HTML on the session host (cookie session)
  { name: "project_page", pattern: /\/Project\/Index(\?|$)/i, body: false },
  { name: "project_corrections", pattern: /\/Project\/ProjectCorrections(\?|$)/i, body: false },
  { name: "project_info", pattern: /\/Project\/ProjectInfo(\?|$)/i, body: false },
  { name: "task_list_partial", pattern: /\/User\/Workflow\/WorkflowTaskList(\?|$)/i, body: false },
  { name: "review_comments_report", pattern: /\/WebForms\/ReportViewer\.aspx(\?|$)/i, body: false },
  // File bodies: code-supported only; DC account has DownloadFile=false
  { name: "file_retrieve", pattern: /\/File\/RetrieveFile(\?|$)/i, body: true },
  { name: "markup_pdf", pattern: /\/WorkflowChangemark\/RetrieveMarkupPDF(\?|\/|$)/i, body: true },
]);

/** Hosts observed for DC (Globals in Project/Index page source). */
const DC_HOSTS = Object.freeze([
  "session.planreview.dob.dc.gov",
  "planreview.dob.dc.gov",
  "washington-dc-us-projectdoxwebapi.avolvecloud.com",
  "washington-dc-us-projectdoxwebui.avolvecloud.com",
  "washington-dc-us-portalwebapi.avolvecloud.com",
]);

/**
 * The two DC web hosts the worker already loads pages from (D-048). Exact hostnames.
 */
const DC_PORTAL_HOSTS = Object.freeze([
  "planreview.dob.dc.gov",
  "session.planreview.dob.dc.gov",
]);

/**
 * The one ProjectDox API host the worker already calls (D-049). Exact hostname, no suffix match.
 * Not projectdoxwebui and not portalwebapi.
 */
const DC_API_HOST = "washington-dc-us-projectdoxwebapi.avolvecloud.com";

/**
 * Hosts where a GET or HEAD is allowed even when the path is not a named route.
 * The page and the API call these paths themselves, and the manual scraper does not filter them.
 * Never a reason to skip a deny pattern or a file-body check.
 */
const DC_OPEN_READ_HOSTS = Object.freeze([...DC_PORTAL_HOSTS, DC_API_HOST]);

const ALLOWED_METHODS = Object.freeze(["GET", "HEAD"]);

/**
 * Per-mode request policy (D-057). "json" is the policy above, unchanged. "deep" runs the existing manual
 * DC scraper, which opens the file viewer, retrieves file bodies and exports SSRS reports; those reads are
 * the only patterns it lifts. Every mutation deny (task actions, uploads, saves, Download Files,
 * ApprovedPlans, Resubmit, SessionEnded, Log Out) stays in force in both modes.
 */
const DEEP_MODE_LIFTED_DENY = Object.freeze([/viewFile/i, /OpType=Export/i, /rs:Format=/i].map(String));
/** The file viewer page runs on the ProjectDox web UI host; deep mode reads it like the other open hosts (GET/HEAD only). */
const DC_WEBUI_HOST = "washington-dc-us-projectdoxwebui.avolvecloud.com";
const MODES = Object.freeze({
  json: Object.freeze({ deny: DENY_PATTERNS, openHosts: DC_OPEN_READ_HOSTS, allowDownloads: false }),
  deep: Object.freeze({
    deny: Object.freeze(DENY_PATTERNS.filter((p) => !DEEP_MODE_LIFTED_DENY.includes(String(p)))),
    openHosts: Object.freeze([...DC_OPEN_READ_HOSTS, DC_WEBUI_HOST]),
    allowDownloads: true,
  }),
});

function modePolicy(mode) {
  const m = MODES[mode || "json"];
  if (!m) throw new Error(`unknown guard mode ${mode}`);
  return m;
}

/**
 * Extra hosts for the LOGIN phase only (D-044), observed on the first dashboard load in A-3 run 2.
 * Exact hostnames, never suffixes: anyone can host on *.azurewebsites.net or *.blob.core.windows.net.
 * Never added to DC_HOSTS, so the read guard does not see them.
 *   idp        - treated like an identity provider; may receive the sign-in form (POST).
 *   read_only  - GET/HEAD only.
 */
const LOGIN_EXTRA_HOSTS = Object.freeze({
  "avolvecspiam-as-authmiddleware.azurewebsites.net": Object.freeze({ role: "idp", methods: Object.freeze(["GET", "HEAD", "POST"]) }),
  "avolvecspiamsa.blob.core.windows.net": Object.freeze({ role: "read_only", methods: ALLOWED_METHODS }),
});

/**
 * Login-phase verdict for a LOGIN_EXTRA_HOSTS host, or null when the host is not one of them.
 * @returns {{ allowed: boolean, rule: string, reason: string, role: string } | null}
 */
function evaluateLoginExtraHost(method, hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LOGIN_EXTRA_HOSTS, host)) return null;
  const entry = LOGIN_EXTRA_HOSTS[host];
  const m = String(method || "GET").toUpperCase();
  if (!entry.methods.includes(m)) {
    return { allowed: false, rule: "login_host_method", reason: `${m} to ${host} during login`, role: entry.role };
  }
  return { allowed: true, rule: entry.role === "idp" ? "login_idp_host" : "login_read_host", reason: `exact login host (${entry.role})`, role: entry.role };
}

function isLoginIdpHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOGIN_EXTRA_HOSTS, host) && LOGIN_EXTRA_HOSTS[host].role === "idp";
}

const VOID_HREF = /^javascript:\s*void\(0\);?$/i;
// Dashboard pager labels observed on the DC Plan Review dashboard (client-side paging).
const PAGER_TEXT = /^(\d{1,4}|Next|Prev|Previous|First|Last|»|«|›|‹)$/i;
// Dashboard project links: launchRemote('Project/Index?tab=<tab>&ProjectID=<n>'), nothing else in the handler.
const LAUNCH_REMOTE = /^(?:javascript:)?\s*launchRemote\(\s*['"](Project\/Index\?tab=\w+&ProjectID=\d+)['"]\s*\)\s*;?\s*(?:return\s+false\s*;?)?$/i;

function parseUrl(url) {
  try {
    return new URL(String(url));
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ method?: string, url: string, hosts?: string[], allowlist?: Array<{name:string,pattern:RegExp,body:boolean}>, allowDownloads?: boolean, mode?: "json"|"deep" }} input
 * @returns {{ allowed: boolean, rule: string, reason: string, body: boolean }}
 */
/** The deny pattern a URL matches, or null. Checked before the method rule so a denied POST still fails the job. */
function matchingDenyPattern(url, mode) {
  const raw = String(url || "");
  const decoded = decodeURIComponentSafe(raw);
  return modePolicy(mode).deny.find((p) => p.test(raw) || p.test(decoded)) || null;
}

function matchesDenyPattern(url, mode) {
  return Boolean(matchingDenyPattern(url, mode));
}

function evaluateRequest(input) {
  const method = String((input && input.method) || "GET").toUpperCase();
  const hosts = (input && input.hosts) || DC_HOSTS;
  const allowlist = (input && input.allowlist) || DC_READ_ALLOW;
  const policy = modePolicy(input && input.mode);
  const allowDownloads = Boolean(input && input.allowDownloads) || policy.allowDownloads;
  const raw = String((input && input.url) || "");
  const u = parseUrl(raw);

  const denied = matchingDenyPattern(raw, input && input.mode);
  if (denied) {
    return deny("deny_pattern", `matches deny pattern ${denied}`);
  }
  if (!ALLOWED_METHODS.includes(method)) {
    return deny("method", `method ${method} is not read-only`);
  }
  if (!u) {
    return deny("url", "unparseable URL");
  }
  if (u.protocol !== "https:") {
    return deny("scheme", `scheme ${u.protocol} not allowed`);
  }
  if (!hosts.includes(u.hostname.toLowerCase())) {
    return deny("host", `host ${u.hostname} not on allowlist`);
  }

  const target = u.pathname + u.search;

  const rule = allowlist.find((r) => r.pattern.test(target));
  if (rule) {
    if (rule.body && !allowDownloads) {
      return deny("downloads_disabled", `${rule.name} requires allowDownloads`);
    }
    return { allowed: true, rule: rule.name, reason: "allowlisted read-only GET", body: rule.body };
  }
  if (policy.openHosts.includes(u.hostname.toLowerCase())) {
    return { allowed: true, rule: "portal_page_read", reason: "GET or HEAD on an open DC read host", body: false };
  }
  return deny("not_allowlisted", `path ${u.pathname} has no read-only allow rule`);
}

/**
 * Click guard for Playwright `safeClick`. Only permits navigation anchors whose
 * href is an allowlisted read-only GET; blocks any element whose href/onclick/
 * text/attributes match a deny pattern or that would submit a form.
 *
 * @param {{ tag: string, type?: string, href?: string|null, onclick?: string|null, text?: string|null, formMethod?: string|null, id?: string|null }} el
 * @returns {{ allowed: boolean, rule: string, reason: string }}
 */
function evaluateClick(el) {
  const tag = String((el && el.tag) || "").toLowerCase();
  const type = String((el && el.type) || "").toLowerCase();
  const blob = [el && el.href, el && el.onclick, el && el.text, el && el.id]
    .filter(Boolean)
    .join(" | ");

  for (const p of DENY_PATTERNS) {
    if (p.test(blob)) {
      return { allowed: false, rule: "deny_pattern", reason: `click matches ${p}` };
    }
  }
  if (["input", "textarea", "select"].includes(tag)) {
    return { allowed: false, rule: "form_field", reason: "form fields are never clicked" };
  }
  if (type === "submit" || (el && el.formMethod && String(el.formMethod).toUpperCase() !== "GET")) {
    return { allowed: false, rule: "form_submit", reason: "form submission is not read-only" };
  }
  const href = String((el && el.href) || "").trim();
  const onclick = String((el && el.onclick) || "").trim();
  const text = String((el && el.text) || "").trim();
  if (tag === "a" && VOID_HREF.test(href) && !onclick && PAGER_TEXT.test(text)) {
    return { allowed: true, rule: "dashboard_pager", reason: "client-side pager link" };
  }
  if (tag === "a") {
    const handler = LAUNCH_REMOTE.test(onclick) ? onclick : LAUNCH_REMOTE.test(href) ? href : null;
    const other = handler === onclick ? href : onclick;
    if (handler && (!other || VOID_HREF.test(other) || other === "#")) {
      const target = handler.match(LAUNCH_REMOTE)[1];
      const verdict = evaluateRequest({ method: "GET", url: absolutize(target) });
      if (verdict.allowed && verdict.rule === "project_page") {
        return { allowed: true, rule: "launch_remote_project", reason: "opens read-only Project/Index via SSO hop" };
      }
      return { allowed: false, rule: "launch_remote_target", reason: verdict.reason };
    }
  }
  if (tag === "a" && el.href) {
    const verdict = evaluateRequest({ method: "GET", url: absolutize(el.href) });
    if (verdict.allowed) return { allowed: true, rule: "allowlisted_link", reason: verdict.reason };
    return { allowed: false, rule: "link_not_allowlisted", reason: verdict.reason };
  }
  return { allowed: false, rule: "default_deny", reason: "element is not an allowlisted read-only link" };
}

/**
 * Run-level guard: records every request decision and exposes a violation count.
 * Any violation must abort the run (status failed_unrecoverable) per MASTER_PLAN §6.
 */
function createRunGuard(options) {
  const opts = options || {};
  const mode = opts.mode || "json";
  modePolicy(mode);
  const log = [];
  return {
    mode,
    checkRequest(method, url) {
      const verdict = evaluateRequest({ method, url, allowDownloads: opts.allowDownloads, hosts: opts.hosts, mode });
      log.push({ kind: "request", method, url: redactUrl(url), ...verdict });
      return verdict;
    },
    checkClick(el) {
      const verdict = evaluateClick(el);
      log.push({ kind: "click", text: el && el.text ? String(el.text).slice(0, 80) : null, ...verdict });
      return verdict;
    },
    violations() {
      return log.filter((e) => !e.allowed);
    },
    shouldAbort() {
      return this.violations().length > 0;
    },
    entries() {
      return log.slice();
    },
  };
}

/** Strip query values that could hold identifiers beyond numeric project IDs. */
function redactUrl(url) {
  const u = parseUrl(url);
  if (!u) return "[unparseable]";
  const keep = new Set(["projectid", "tab", "folderid", "fileid", "wflowtaskid", "entityid", "wflowinstanceid", "reportid"]);
  const parts = [];
  for (const [k, v] of u.searchParams) {
    parts.push(`${k}=${keep.has(k.toLowerCase()) ? v : "*"}`);
  }
  return `${u.origin}${u.pathname}${parts.length ? "?" + parts.join("&") : ""}`;
}

function absolutize(href) {
  try {
    return new URL(href, "https://session.planreview.dob.dc.gov/").toString();
  } catch (_) {
    return String(href);
  }
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
}

function deny(rule, reason) {
  return { allowed: false, rule, reason, body: false };
}

module.exports = {
  DENY_PATTERNS,
  DC_READ_ALLOW,
  DC_HOSTS,
  DC_PORTAL_HOSTS,
  DC_API_HOST,
  DC_OPEN_READ_HOSTS,
  ALLOWED_METHODS,
  DC_WEBUI_HOST,
  MODES,
  modePolicy,
  LOGIN_EXTRA_HOSTS,
  evaluateLoginExtraHost,
  isLoginIdpHost,
  matchesDenyPattern,
  evaluateRequest,
  evaluateClick,
  createRunGuard,
  redactUrl,
};
