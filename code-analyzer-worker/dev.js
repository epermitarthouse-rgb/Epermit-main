"use strict";

const { spawn } = require("child_process");
const path = require("path");

const workerPath = path.join(__dirname, "worker.js");
let child = null;

function start() {
  child = spawn(process.execPath, ["--watch", workerPath], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    console.log(`[code-analyzer-worker:dev] exited ${code}`);
  });
}

start();
