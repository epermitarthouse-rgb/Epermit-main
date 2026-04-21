"use strict";

const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const { Router } = require("express");

function styleSheet(sheet) {
  const r = sheet.getRow(1);
  r.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } };
  r.alignment = { vertical: "middle" };
  r.height = 28;
  r.eachCell((c) => {
    c.border = { bottom: { style: "thin", color: { argb: "FF555577" } } };
  });
}

/**
 * @param {{ sessions: Record<string, any>, tabDefs: { key: string, label: string, param: string }[], scraperRoot: string }} opts
 */
function createExportApiRouter(opts) {
  const { sessions, tabDefs, scraperRoot } = opts;
  const router = Router();

  router.get("/api/export/:sessionId", async (req, res) => {
    const s = sessions[req.params.sessionId];
    if (!s?.data || Object.keys(s.data).length === 0)
      return res.status(404).json({ error: "No data" });

    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "ProjectDox Scraper";

      // 1. Employee Sheet
      const empSheet = wb.addWorksheet("Work by Employee");
      empSheet.columns = [
        { header: "Employee / User", key: "emp", width: 25 },
        { header: "Project", key: "proj", width: 15 },
        { header: "Task / Workflow", key: "task", width: 40 },
        { header: "Status", key: "status", width: 15 },
        { header: "Cycle / Dept", key: "dept", width: 20 },
        { header: "Date", key: "date", width: 15 },
      ];

      const empRows = [];

      const addEmpRow = (empName, projNum, taskName, status, dept, date) => {
        if (!empName || empName.includes("Unassigned")) return;
        empRows.push({
          emp: empName,
          proj: projNum,
          task: taskName,
          status: status || "",
          dept: dept || "",
          date: date || "",
        });
      };

      for (const [pid, pd] of Object.entries(s.data)) {
        const taskTab = pd.tabs["tasks"];
        if (taskTab && taskTab.tables) {
          taskTab.tables.forEach((table) => {
            const findKey = (candidates) =>
              table.headers.find((h) =>
                candidates.some((c) => h.toLowerCase().includes(c)),
              );
            const userHeader = findKey([
              "assigned",
              "user",
              "owner",
              "department",
            ]);
            const taskHeader = findKey(["task", "workflow", "step", "activity"]);
            const statusHeader = findKey(["status"]);
            const dateHeader = findKey(["date", "due", "start"]);

            if (userHeader) {
              table.rows.forEach((row) => {
                addEmpRow(
                  row[userHeader],
                  pd.projectNum || pid,
                  row[taskHeader] || "Unknown Task",
                  row[statusHeader],
                  "Workflow Task",
                  row[dateHeader],
                );
              });
            }
          });
        }

        const infoTab = pd.tabs["info"];
        if (infoTab && infoTab.keyValues) {
          infoTab.keyValues.forEach((kv) => {
            const k = kv.key.toLowerCase();
            if (
              k.includes("applicant") ||
              k.includes("coordinator") ||
              k.includes("contact") ||
              k.includes("manager")
            ) {
              addEmpRow(
                kv.value,
                pd.projectNum || pid,
                kv.key,
                "Info Field",
                "",
                "",
              );
            }
          });
        }
      }

      empRows.sort((a, b) => a.emp.localeCompare(b.emp));
      empRows.forEach((row) => empSheet.addRow(row));
      styleSheet(empSheet);

      // 2. Summary Sheet (Original)
      const summary = wb.addWorksheet("Summary");
      summary.columns = [
        { header: "Project", key: "num", width: 18 },
        { header: "Description", key: "desc", width: 55 },
        { header: "Location", key: "loc", width: 35 },
        { header: "Status", key: "status", width: 15 },
        { header: "Fields", key: "fields", width: 12 },
      ];
      for (const [pid, pd] of Object.entries(s.data)) {
        let f = 0;
        Object.values(pd.tabs).forEach((t) => {
          if (t.keyValues) f += t.keyValues.length;
          if (t.tables) t.tables.forEach((tb) => (f += tb.rows.length));
        });
        summary.addRow({
          num: pd.projectNum || pid,
          desc: pd.description || "",
          loc: pd.location || "",
          status: pd.dashboardStatus || "",
          fields: f,
        });
      }
      styleSheet(summary);

      // 3. Detailed Tabs (Original)
      for (const tab of tabDefs) {
        const sheet = wb.addWorksheet(tab.label);
        const allRows = [];
        for (const [pid, pd] of Object.entries(s.data)) {
          const td = pd.tabs[tab.key];
          if (!td || td.error) continue;
          td.keyValues?.forEach((kv) =>
            allRows.push({
              Project: pd.projectNum || pid,
              Type: "Field",
              Field: kv.key,
              Value: kv.value,
            }),
          );
          td.tables?.forEach((tbl, ti) =>
            tbl.rows.forEach((row) => {
              const fr = {
                Project: pd.projectNum || pid,
                Type: `Table ${ti + 1}`,
              };
              Object.entries(row).forEach(([k, v]) => (fr[k] = v));
              allRows.push(fr);
            }),
          );
        }
        if (allRows.length > 0) {
          const keys = [...new Set(allRows.flatMap((r) => Object.keys(r)))];
          sheet.columns = keys.map((k) => ({ header: k, key: k, width: 25 }));
          allRows.forEach((r) => sheet.addRow(r));
          styleSheet(sheet);
        } else {
          sheet.addRow(["No data"]);
        }
      }

      const fp = path.join(scraperRoot, `Export_${req.params.sessionId}.xlsx`);
      await wb.xlsx.writeFile(fp);
      res.download(fp, "ProjectDox_Export.xlsx", () => {
        try {
          fs.unlinkSync(fp);
        } catch (e) {}
      });
    } catch (err) {
      console.error("Export error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createExportApiRouter,
};
