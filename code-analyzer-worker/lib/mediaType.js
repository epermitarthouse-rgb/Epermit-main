"use strict";

const RASTER_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const RASTER_MIME_PREFIXES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

function extensionOf(fileName) {
  if (!fileName || typeof fileName !== "string") return "";
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function isRasterImageFile(fileName, fileType) {
  const ext = extensionOf(fileName);
  if (RASTER_EXTENSIONS.has(ext)) return true;
  const mime = String(fileType || "").toLowerCase();
  return RASTER_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function isPdfFile(fileName, fileType) {
  const ext = extensionOf(fileName);
  if (ext === ".pdf") return true;
  return String(fileType || "").toLowerCase().includes("pdf");
}

module.exports = {
  isRasterImageFile,
  isPdfFile,
  extensionOf,
};
