"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CONVERT_BYTES = 50 * 1024 * 1024;

const MANUAL_COMMENT_LETTER_DESCRIPTION = "Manual comment letter upload (Comment Review)";

function isLegacyDocFileName(fileName) {
  const lower = String(fileName || "").toLowerCase();
  return lower.endsWith(".doc") && !lower.endsWith(".docx");
}

function sanitizeTempFileName(fileName) {
  const base = path.basename(String(fileName || "document.doc"));
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "document.doc";
}

async function removePath(targetPath) {
  if (!targetPath) return;
  try {
    await fsp.rm(targetPath, { recursive: true, force: true });
  } catch (_) {
    // ignore cleanup errors
  }
}

function runLibreOfficeConvert(inputPath, outDir, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [
      "--headless",
      "--nologo",
      "--nofirststartwizard",
      "--convert-to",
      "docx",
      "--outdir",
      outDir,
      inputPath,
    ];

    const child = spawn("libreoffice", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Conversion timed out"));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (err && err.code === "ENOENT") {
        reject(new Error("Legacy Word conversion is unavailable on this server"));
        return;
      }
      reject(new Error("Conversion failed"));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error("Conversion failed"));
        return;
      }
      resolve(stderr);
    });
  });
}

/**
 * Convert a legacy binary .DOC buffer to DOCX using LibreOffice headless mode.
 * @param {{ buffer: Buffer, originalFileName: string, timeoutMs?: number }} input
 */
async function convertLegacyDocBuffer(input) {
  const { buffer, originalFileName, timeoutMs = DEFAULT_TIMEOUT_MS } = input;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Document file is empty");
  }
  if (buffer.length > MAX_CONVERT_BYTES) {
    throw new Error("File is too large to convert");
  }
  if (!isLegacyDocFileName(originalFileName)) {
    throw new Error("Only legacy .DOC files can be converted");
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "legacy-doc-"));
  const safeName = sanitizeTempFileName(originalFileName);
  const inputPath = path.join(tempRoot, safeName);

  try {
    await fsp.writeFile(inputPath, buffer);
    await runLibreOfficeConvert(inputPath, tempRoot, timeoutMs);

    const stem = safeName.replace(/\.doc$/i, "");
    let outputPath = path.join(tempRoot, `${stem}.docx`);
    if (!fs.existsSync(outputPath)) {
      const entries = await fsp.readdir(tempRoot);
      const docxName = entries.find((entry) => entry.toLowerCase().endsWith(".docx"));
      if (!docxName) {
        throw new Error("Conversion produced no output file");
      }
      outputPath = path.join(tempRoot, docxName);
    }

    const stat = await fsp.stat(outputPath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error("Conversion produced an empty file");
    }

    const converted = await fsp.readFile(outputPath);
    const convertedFileName = String(originalFileName).replace(/\.doc$/i, ".docx");

    return {
      buffer: converted,
      convertedFileName,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  } finally {
    await removePath(tempRoot);
  }
}

function isManualCommentLetterDocument(doc) {
  return (
    doc &&
    doc.document_type === "correspondence" &&
    typeof doc.description === "string" &&
    doc.description.includes("Manual comment letter upload")
  );
}

module.exports = {
  convertLegacyDocBuffer,
  isLegacyDocFileName,
  isManualCommentLetterDocument,
  MANUAL_COMMENT_LETTER_DESCRIPTION,
  MAX_CONVERT_BYTES,
  DEFAULT_TIMEOUT_MS,
};
