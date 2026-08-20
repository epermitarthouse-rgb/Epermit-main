require("dotenv").config();

const { spawn } = require("child_process");
const { createSharedHttpApp } = require("./app/http-app.js");
const {
  registerExecutionRoutes,
  runPlaywrightStartupDiagnostics,
} = require("./app/register-execution-routes.js");
const { sessions, cleanupSession } = require("./app/session/in-memory-store.js");
const {
  getDocumentFallbackConfig,
  fallbackProviderStatus,
} = require("./app/services/uci/uci-document-fallback-config.service.js");

const app = createSharedHttpApp({ scraperServiceRoot: __dirname });
const { PORT, arlingtonWorker, uciWorker, graphInboundPoller, lifecycleScheduler } =
  registerExecutionRoutes(app);
const documentFallbackConfig = getDocumentFallbackConfig();
console.log(
  "[SCRAPER SERVER] UCI document fallback runtime",
  JSON.stringify({
    ...fallbackProviderStatus(documentFallbackConfig),
    openai_configured: documentFallbackConfig.openai_configured,
    vision_model: documentFallbackConfig.vision_model,
    ocr_model: documentFallbackConfig.ocr_model,
    timeout_ms: documentFallbackConfig.ai_timeout_ms,
    max_retries: documentFallbackConfig.ai_max_retries,
  }),
);

// ─── Shutdown ────────────────────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down scraper dev stack...");
  if (arlingtonWorker && typeof arlingtonWorker.stop === "function") {
    console.log(
      "[SCRAPER SERVER] Stopping background Arlington durable worker (unrelated to PEPCO/UCI scrape sessions)",
    );
    arlingtonWorker.stop();
  }
  if (uciWorker && typeof uciWorker.stop === "function") {
    console.log("[SCRAPER SERVER] Stopping background UCI durable portal sync worker");
    uciWorker.stop();
  }
  if (graphInboundPoller && typeof graphInboundPoller.stop === "function") {
    console.log("[SCRAPER SERVER] Stopping background UCI Graph inbound mailbox poller");
    graphInboundPoller.stop();
  }
  if (lifecycleScheduler && typeof lifecycleScheduler.stop === "function") {
    console.log("[SCRAPER SERVER] Stopping background UCI lifecycle scheduler");
    lifecycleScheduler.stop();
  }
  for (const sid of Object.keys(sessions)) cleanupSession(sid, "sigint");
  process.exit(0);
});

async function logLibreOfficeAvailability() {
  return new Promise((resolve) => {
    const child = spawn("libreoffice", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      console.warn("[SCRAPER SERVER] LibreOffice not available; legacy .DOC conversion disabled");
      resolve(false);
    });
    child.on("close", (code) => {
      if (code === 0 && output.trim()) {
        console.log(`[SCRAPER SERVER] LibreOffice available: ${output.trim().split("\n")[0]}`);
        resolve(true);
      } else {
        console.warn("[SCRAPER SERVER] LibreOffice not available; legacy .DOC conversion disabled");
        resolve(false);
      }
    });
  });
}

async function startServer() {
  console.log("Playwright startup diagnostics:");
  const browserOk = await runPlaywrightStartupDiagnostics();
  await logLibreOfficeAvailability();
  if (!browserOk) {
    console.log(
      "Server will start anyway; login/scrape will return 503 until Chromium is installed.",
    );
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    const envName =
      process.env.NODE_ENV ||
      (process.env.RAILWAY_ENVIRONMENT ? "railway" : "development");
    console.log(
      `[SCRAPER SERVER] PID=${process.pid}, PORT=${PORT}, ENV=${envName}, READY`,
    );
    console.log(
      "[SCRAPER SERVER] Do not run multiple scraper server instances at the same time.",
    );
    if (arlingtonWorker?.workerId) {
      console.log(
        `[SCRAPER SERVER] Background Arlington durable worker active workerId=${arlingtonWorker.workerId} (polls scrape_jobs; not PEPCO/UCI)`,
      );
    }
    if (uciWorker?.workerId) {
      console.log(
        `[SCRAPER SERVER] Background UCI durable portal sync worker active workerId=${uciWorker.workerId}`,
      );
    }
    if (graphInboundPoller?.pollerId) {
      console.log(
        `[SCRAPER SERVER] Background UCI Graph inbound poller active pollerId=${graphInboundPoller.pollerId} intervalMs=${graphInboundPoller.intervalMs}`,
      );
    }
    console.log(`
╔══════════════════════════════════════════════════════╗
║  🏛️  ProjectDox Data Extractor                        ║
║  Server running at: http://localhost:${PORT}          ║
║  Export now includes "Work by Employee" Tab          ║
║  Automatic PDF Downloading Enabled (Option A)        ║
╚══════════════════════════════════════════════════════╝
  `);
    if (!process.env.RAILWAY_ENVIRONMENT) {
      import("open")
        .then((mod) => mod.default(`http://localhost:${PORT}`))
        .catch(() => {});
    }
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `[SCRAPER SERVER] PID=${process.pid}, PORT=${PORT}, BIND_FAILED=EADDRINUSE`,
      );
      console.error(
        "[SCRAPER SERVER] Another scraper instance is already running on this port.",
      );
    }
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

module.exports = { app };
