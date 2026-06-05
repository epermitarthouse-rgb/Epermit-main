"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, ".env");

const SKIP_MESSAGE =
  "Document ingestion worker not started: missing .env. Copy .env.example to .env and set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY.";

function isEnvConfigured() {
  if (!fs.existsSync(ENV_FILE)) return false;

  require("dotenv").config({ path: ENV_FILE });

  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.OPENAI_API_KEY,
  );
}

function startWorker() {
  const child = spawn(process.execPath, ["worker.js"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }
}

if (!isEnvConfigured()) {
  console.log(SKIP_MESSAGE);
  process.exit(0);
}

startWorker();
