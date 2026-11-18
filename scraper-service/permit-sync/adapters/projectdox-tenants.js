"use strict";

/**
 * ProjectDox tenants the permit-sync worker reads. The JSON routes, the read-only guard rules and the adapter
 * logic are shared; a tenant only names its hosts, its report identities and its jurisdiction. Exact hostnames,
 * never suffixes.
 *
 * Montgomery evidence: supervised read-only capture 2026-11-18 (MONTGOMERY_CAPABILITY_MAP.md). Its Web API
 * answers the same JSON routes as DC; the Review Comments report is ReportID 133.
 */

const DC = Object.freeze({
  key: "dc-projectdox",
  jurisdiction: "Washington DC",
  apiOrigin: "https://washington-dc-us-projectdoxwebapi.avolvecloud.com",
  uiOrigin: "https://session.planreview.dob.dc.gov",
  hosts: Object.freeze([
    "session.planreview.dob.dc.gov",
    "planreview.dob.dc.gov",
    "washington-dc-us-projectdoxwebapi.avolvecloud.com",
    "washington-dc-us-projectdoxwebui.avolvecloud.com",
    "washington-dc-us-portalwebapi.avolvecloud.com",
  ]),
  /** Web hosts the worker loads pages from (D-048). */
  portalHosts: Object.freeze(["planreview.dob.dc.gov", "session.planreview.dob.dc.gov"]),
  /** The one ProjectDox API host (D-049). */
  apiHost: "washington-dc-us-projectdoxwebapi.avolvecloud.com",
  /** File viewer host; open in deep mode only. */
  webuiHost: "washington-dc-us-projectdoxwebui.avolvecloud.com",
  /** Keepalive host: /User/GetSessionTimeout only, deep mode (D-092). */
  portalWebApiHost: "washington-dc-us-portalwebapi.avolvecloud.com",
  /** Hosts serving ReportViewer.aspx (report-identity exemption, D-081). */
  reportHosts: Object.freeze(["planreview.dob.dc.gov", "session.planreview.dob.dc.gov"]),
  reviewReport: Object.freeze({ ReportID: 14, ReportPath: "/WashingtonDCProd/ProjectDox/Plan Review - Review Comments", DataSourceName: "DataSource1" }),
  projectInfoTemplateId: 5,
  extraRoutes: Object.freeze([]),
});

const MONTGOMERY = Object.freeze({
  key: "montgomery-projectdox",
  jurisdiction: "Montgomery County MD",
  portalOrigin: "https://montgomeryco-md-us.avolvecloud.com",
  apiOrigin: "https://montgomeryco-md-us-projectdoxwebapi.avolvecloud.com",
  uiOrigin: "https://montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
  hosts: Object.freeze([
    "montgomeryco-md-us.avolvecloud.com",
    "montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
    "montgomeryco-md-us-projectdoxwebapi.avolvecloud.com",
    "montgomeryco-md-us-portalwebapi.avolvecloud.com",
  ]),
  // Project pages live on the WebUI host here (DC serves them from its own session host).
  portalHosts: Object.freeze(["montgomeryco-md-us.avolvecloud.com", "montgomeryco-md-us-projectdoxwebui.avolvecloud.com"]),
  apiHost: "montgomeryco-md-us-projectdoxwebapi.avolvecloud.com",
  webuiHost: "montgomeryco-md-us-projectdoxwebui.avolvecloud.com",
  portalWebApiHost: "montgomeryco-md-us-portalwebapi.avolvecloud.com",
  reportHosts: Object.freeze(["montgomeryco-md-us-projectdoxwebui.avolvecloud.com"]),
  reviewReport: Object.freeze({ ReportID: 133, ReportPath: "/MontgomeryCountyProd/ProjectDox/Plan Review - Review Comments", DataSourceName: "DataSource1" }),
  projectInfoTemplateId: null,
  // Projects grid data call (all accessible projects, one page); the portal Home table lists only some of them.
  extraRoutes: Object.freeze([{ name: "paged_active_projects", pattern: /\/Project\/GetPagedActiveProjects(\?|$)/i, body: false }]),
});

const TENANTS = Object.freeze({ [DC.key]: DC, [MONTGOMERY.key]: MONTGOMERY });

/** Tenant config by adapter key or tenant object; DC when omitted. Throws for an unknown key. */
function tenantFor(keyOrTenant) {
  if (!keyOrTenant) return DC;
  if (typeof keyOrTenant === "object") return keyOrTenant;
  const t = TENANTS[keyOrTenant];
  if (!t) throw new Error(`unknown ProjectDox tenant ${keyOrTenant}`);
  return t;
}

module.exports = { DC, MONTGOMERY, TENANTS, tenantFor };
