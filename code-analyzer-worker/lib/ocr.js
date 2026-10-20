"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SWIFT_SOURCE = path.join(__dirname, "ocr-vision.swift");
const VISION_BIN = path.join(os.tmpdir(), "epermit-ocr-vision");

let visionBinary = undefined;

function ensureVisionBinary() {
  if (visionBinary !== undefined) return visionBinary;
  visionBinary = null;
  if (process.platform !== "darwin") return null;
  if (!fs.existsSync(SWIFT_SOURCE)) return null;
  try {
    const sourceTime = fs.statSync(SWIFT_SOURCE).mtimeMs;
    const fresh = fs.existsSync(VISION_BIN) && fs.statSync(VISION_BIN).mtimeMs >= sourceTime;
    if (!fresh) {
      const compiled = spawnSync("swiftc", ["-O", "-o", VISION_BIN, SWIFT_SOURCE], {
        timeout: 120000,
        encoding: "utf8",
      });
      if (compiled.status !== 0) return null;
    }
    visionBinary = VISION_BIN;
    return visionBinary;
  } catch {
    visionBinary = null;
    return null;
  }
}

function recognizeWithVision(pngBuffer) {
  const bin = ensureVisionBinary();
  if (!bin) return null;
  const tmp = path.join(os.tmpdir(), `epermit-ocr-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  fs.writeFileSync(tmp, pngBuffer);
  try {
    const result = spawnSync(bin, [tmp], { timeout: 45000, encoding: "utf8", maxBuffer: 5_000_000 });
    if (result.status !== 0 || !result.stdout) return { engine: "macos-vision", words: [], failed: true };
    const words = [];
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const text = String(parsed.text || "").trim();
        if (!text) continue;
        words.push({
          text,
          confidence: Number(parsed.confidence),
          x: Number(parsed.x),
          y: Number(parsed.y),
          width: Number(parsed.width),
          height: Number(parsed.height),
          origin: "bottom-left",
        });
      } catch {
        continue;
      }
    }
    return { engine: "macos-vision", words };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function recognizeWithTesseract(pngBuffer) {
  const probe = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0 && probe.error) return null;
  const tmp = path.join(os.tmpdir(), `epermit-tess-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(tmp, pngBuffer);
  try {
    // Sparse-text mode: drawings are scattered labels and tables, not one uniform block.
    const result = spawnSync("tesseract", [tmp, "stdout", "--psm", "11", "tsv"], {
      timeout: 45000,
      encoding: "utf8",
      maxBuffer: 5_000_000,
    });
    if (result.status !== 0 || !result.stdout) return { engine: "tesseract", words: [], failed: true };
    const lines = result.stdout.split("\n").slice(1);
    const words = [];
    for (const line of lines) {
      const cols = line.split("\t");
      if (cols.length < 12) continue;
      const text = String(cols[11] || "").trim();
      const conf = Number(cols[10]);
      const left = Number(cols[6]);
      const top = Number(cols[7]);
      const width = Number(cols[8]);
      const height = Number(cols[9]);
      if (!text || text === "-1") continue;
      words.push({
        text,
        confidence: Number.isFinite(conf) ? conf / 100 : 0,
        left,
        top,
        width,
        height,
        origin: "top-left-px",
      });
    }
    return { engine: "tesseract", words };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Read words from a PNG crop. An injected reader wins.
 * Returns unavailable when no local OCR engine exists. Never invents text.
 * @param {Buffer} pngBuffer
 * @param {{ ocr?: Function }} [options]
 */
async function recognizePng(pngBuffer, options = {}) {
  if (typeof options.ocr === "function") {
    const custom = await options.ocr(pngBuffer);
    return custom || { engine: "injected", words: [] };
  }
  const vision = recognizeWithVision(pngBuffer);
  if (vision) return vision;
  const tesseract = recognizeWithTesseract(pngBuffer);
  if (tesseract) return tesseract;
  return { engine: null, words: [], unavailable: true };
}

module.exports = {
  recognizePng,
  ensureVisionBinary,
};
