/**
 * Howard ProjectDox shell — /User/Index, Projects tab, row links /Project/Index?ProjectID=…
 */

"use strict";

function norm(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {import('playwright').Page} projectDoxPage
 */
async function ensureHowardProjectsTab(projectDoxPage) {
  const tab = projectDoxPage.locator('a[href="#projectsTab"]').first();
  await tab.waitFor({ state: "visible", timeout: 30000 });

  const activeInLi = await projectDoxPage
    .locator('li.ui-tabs-active a[href="#projectsTab"]')
    .count();
  const ariaSelected = await projectDoxPage
    .locator('a[href="#projectsTab"][aria-selected="true"]')
    .count();

  if (activeInLi > 0 || ariaSelected > 0) {
    console.log("[Howard][discovery] Projects tab already active, skipping click");
  } else {
    await tab.click({ timeout: 15000 });
    console.log("[Howard][discovery] clicked Projects tab");
  }

  try {
    await projectDoxPage.waitForSelector(
      'a[href*="/Project/Index"][href*="ProjectID="]',
      { timeout: 15000 },
    );
  } catch (e) {
    const gridHtml = await projectDoxPage
      .evaluate(() => {
        const grid =
          document.querySelector('#projectsTab, [id*="projects"]') || document.body;
        return grid.outerHTML.slice(0, 3000);
      })
      .catch(() => "<snapshot failed>");
    console.log("[Howard][discovery] row wait timed out. Grid HTML snapshot:", gridHtml);
    throw new Error("[Howard][discovery] project row anchors did not appear within 15s");
  }
}

/**
 * @param {import('playwright').Page} projectDoxPage — on howardco-md-us-projectdoxwebui, /User/Index
 */
async function collectHowardShellProjects(projectDoxPage) {
  await ensureHowardProjectsTab(projectDoxPage);

  const projects = await projectDoxPage.evaluate(() => {
    function n(s) {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    /** @type {{ id: string, name: string, projectNum: string, projectId: string, description: string, location: string, status: string, tasks: string, href: string }[]} */
    const out = [];

    const anchors = document.querySelectorAll(
      'a[href*="/Project/Index"], a[href*="Project/Index"]',
    );
    /** @type {Map<string, { anchor: Element, href: string, text: string }[]>} */
    const byPid = new Map();
    anchors.forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (/discuss|discussion/i.test(href)) return;
      const m = href.match(/ProjectID=(\d+)/i);
      if (!m) return;
      const pid = m[1];
      const text = n(a.textContent);
      if (!byPid.has(pid)) byPid.set(pid, []);
      byPid.get(pid).push({ anchor: a, href, text });
    });

    byPid.forEach((group, pid) => {
      let best = group[0];
      let bestLen = 0;
      for (const item of group) {
        if (item.text.length > 0 && item.text.length > bestLen) {
          bestLen = item.text.length;
          best = item;
        }
      }
      const a = best.anchor;
      const href = best.href;
      const text = n(a.textContent);
      const name = text && text.length >= 2 ? text : `Project ${pid}`;
      const dashIdx = name.indexOf(" - ");
      const projectNum = dashIdx > 0 ? name.slice(0, dashIdx) : name;
      const tr = a.closest("tr, [role='row']");
      const cells = tr
        ? Array.from(tr.querySelectorAll("td, [role='gridcell']")).map((c) => n(c.textContent))
        : [];
      out.push({
        id: pid,
        name,
        projectNum,
        projectId: pid,
        description: cells[3] || "",
        location: cells[2] || "",
        status: cells[5] || "",
        tasks: "",
        href: href,
      });
    });

    return out;
  });

  if (projects[0]) {
    console.log(
      `[Howard][discovery] sample row parsed: name="${projects[0].name}" ` +
        `projectNum="${projects[0].projectNum}" location="${projects[0].location}" ` +
        `description="${projects[0].description}" status="${projects[0].status}"`,
    );
  }
  console.log(`[Howard][discovery] project rows: ${projects.length}`);
  if (projects.length) {
    console.log(
      `[Howard][discovery] ProjectIDs: ${projects.map((p) => p.projectId).join(", ")}`,
    );
  }
  return projects;
}

/**
 * Open first project briefly so WebUI session is fully established (then close helper tab if popup).
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} projectDoxPage — User/Index with Projects list
 * @param {{ projectId?: string, projectNum?: string }} firstProject
 * @param {string} webUiBase
 */
async function warmHowardWebUiAfterLogin(context, projectDoxPage, firstProject, webUiBase) {
  const pid = String(firstProject.projectId || "").trim();
  const permit = String(firstProject.projectNum || "").trim();
  if (!pid) {
    console.log("[Howard][discovery] warm: skipped (no ProjectID)");
    return { strategy: "skip-no-project-id", finalUrl: projectDoxPage.url() };
  }

  const base = String(webUiBase || "").replace(/\/$/, "");
  const warmUrl = `${base}/Project/Index?ProjectID=${encodeURIComponent(pid)}&tab=tasksTab`;
  console.log(`[Howard][discovery] warm via direct Project/Index: ${warmUrl.slice(0, 120)}…`);

  const warmPage = await context.newPage();
  try {
    await warmPage.goto(warmUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await warmPage.waitForTimeout(1500);
    const u = warmPage.url();
    console.log(`[Howard][discovery] warm final URL: ${u}`);
    return { strategy: "direct-project-index", finalUrl: u };
  } finally {
    await warmPage.close().catch(() => {});
  }
}

module.exports = {
  ensureHowardProjectsTab,
  collectHowardShellProjects,
  warmHowardWebUiAfterLogin,
};
