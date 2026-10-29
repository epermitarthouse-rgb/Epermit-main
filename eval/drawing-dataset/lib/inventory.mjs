/**
 * Recursive source inventory. Every filesystem entry gets a row.
 * Hashes are SHA-256 of file bytes. Zip members are listed, not extracted.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function walkSource(root) {
  const files = [];
  const emptyDirectories = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length === 0 && dir !== root) {
      emptyDirectories.push(path.relative(root, dir).split(path.sep).join("/"));
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relativePath = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        files.push({ absolutePath: abs, relativePath, filename: entry.name, kind: "symlink" });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      files.push({
        absolutePath: abs,
        relativePath,
        filename: entry.name,
        kind: entry.isFile() ? "file" : "other",
      });
    }
  }

  await walk(root);
  return { files, emptyDirectories };
}

export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function classifyZipMember(name) {
  const base = String(name || "").split("/").pop();
  if (base.startsWith("._")) return "appledouble_sidecar";
  if (base.toLowerCase().endsWith(".pdf")) return "pdf_member";
  if (!base) return "directory";
  return "other_member";
}

export function classifyFormat(filename, kind) {
  if (kind === "symlink") return "symlink";
  if (kind !== "file") return "other";
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".zip") return "zip";
  return "other";
}

export function parseZipBuffer(buffer) {
  let eocd = -1;
  const start = Math.max(0, buffer.length - 66_000);
  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) {
    return { parsed: false, reason: "zip_eocd_missing", entries: [] };
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    return { parsed: false, reason: "zip64_not_expanded", entries: [] };
  }
  if (cdOffset + cdSize > buffer.length) {
    return { parsed: false, reason: "zip_central_directory_out_of_range", entries: [] };
  }
  return readCentralDirectory(buffer.subarray(cdOffset, cdOffset + cdSize), entryCount);
}

function readCentralDirectory(cd, entryCount) {
  const entries = [];
  let cursor = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > cd.length || cd.readUInt32LE(cursor) !== 0x02014b50) {
      return { parsed: false, reason: "zip_central_header_invalid", entries };
    }
    const flags = cd.readUInt16LE(cursor + 8);
    const method = cd.readUInt16LE(cursor + 10);
    const crc = cd.readUInt32LE(cursor + 16);
    const compressedSize = cd.readUInt32LE(cursor + 20);
    const uncompressedSize = cd.readUInt32LE(cursor + 24);
    const nameLength = cd.readUInt16LE(cursor + 28);
    const extraLength = cd.readUInt16LE(cursor + 30);
    const commentLength = cd.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > cd.length) {
      return { parsed: false, reason: "zip_name_out_of_range", entries };
    }
    const name = cd.subarray(nameStart, nameEnd).toString("utf8");
    entries.push({
      name,
      directory: name.endsWith("/"),
      compressedSize,
      uncompressedSize,
      method,
      encrypted: (flags & 1) === 1,
      crc32: crc.toString(16).padStart(8, "0"),
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return { parsed: true, reason: null, entries };
}

export async function listZipEntries(filePath) {
  const fh = await open(filePath, "r");
  try {
    const info = await fh.stat();
    const tailLength = Math.min(info.size, 66_000);
    const tail = Buffer.alloc(tailLength);
    await fh.read(tail, 0, tailLength, info.size - tailLength);
    let relativeEocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        relativeEocd = index;
        break;
      }
    }
    if (relativeEocd < 0) return { parsed: false, reason: "zip_eocd_missing", entries: [] };
    const entryCount = tail.readUInt16LE(relativeEocd + 10);
    const cdSize = tail.readUInt32LE(relativeEocd + 12);
    const cdOffset = tail.readUInt32LE(relativeEocd + 16);
    if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      return { parsed: false, reason: "zip64_not_expanded", entries: [] };
    }
    if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > info.size) {
      return { parsed: false, reason: "zip_central_directory_out_of_range", entries: [] };
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    return readCentralDirectory(cd, entryCount);
  } finally {
    await fh.close();
  }
}

export async function inventorySource(root) {
  const walked = await walkSource(root);
  const files = [];
  for (const entry of walked.files) {
    const format = classifyFormat(entry.filename, entry.kind);
    if (entry.kind !== "file") {
      files.push({
        relativePath: entry.relativePath,
        filename: entry.filename,
        format,
        bytes: null,
        sha256: null,
        processingStatus: entry.kind === "symlink" ? "symlink_not_followed" : "unreadable",
        zipEntries: [],
        error: null,
      });
      continue;
    }
    const info = await stat(entry.absolutePath);
    let sha256 = null;
    let error = null;
    try {
      sha256 = await hashFile(entry.absolutePath);
    } catch (cause) {
      error = { errorClass: cause?.name || "Error", message: String(cause?.message || cause).slice(0, 240) };
    }
    let processingStatus = "inventoried";
    let zipEntries = [];
    if (!sha256) processingStatus = "unreadable";
    else if (format === "zip") {
      try {
        const listed = await listZipEntries(entry.absolutePath);
        zipEntries = listed.entries || [];
        processingStatus = listed.parsed ? "container_indexed" : "container_unreadable";
        if (!listed.parsed) error = { errorClass: "ZipRead", message: listed.reason };
      } catch (cause) {
        processingStatus = "container_unreadable";
        error = { errorClass: cause?.name || "Error", message: String(cause?.message || cause).slice(0, 240) };
      }
    } else if (format !== "pdf") {
      processingStatus = "unexpected_format";
    }
    files.push({
      relativePath: entry.relativePath,
      filename: entry.filename,
      format,
      bytes: info.size,
      sha256,
      processingStatus,
      zipEntries,
      error,
    });
  }

  const byHash = new Map();
  for (const file of files) {
    if (!file.sha256) continue;
    if (!byHash.has(file.sha256)) byHash.set(file.sha256, []);
    byHash.get(file.sha256).push(file.relativePath);
  }
  const duplicateGroups = [...byHash.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, relativePaths]) => ({ sha256, relativePaths }));

  const byName = new Map();
  for (const file of files) {
    const name = file.filename.toLowerCase();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(file.relativePath);
  }
  const duplicateNames = [...byName.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([filename, relativePaths]) => ({ filename, relativePaths }));

  for (const file of files) {
    const sameHash = file.sha256 ? byHash.get(file.sha256) : null;
    if (sameHash && sameHash.length > 1 && sameHash[0] !== file.relativePath && file.format === "pdf") {
      file.duplicateOf = sameHash[0];
    } else {
      file.duplicateOf = null;
    }
    file.duplicateFilename = duplicateNames.some((group) => group.relativePaths.includes(file.relativePath));
  }

  return {
    root,
    walkedFiles: walked.files.length,
    emptyDirectories: walked.emptyDirectories,
    files,
    duplicateGroups,
    duplicateNames,
    counts: {
      files: files.length,
      pdf: files.filter((file) => file.format === "pdf").length,
      zip: files.filter((file) => file.format === "zip").length,
      other: files.filter((file) => file.format === "other").length,
      symlink: files.filter((file) => file.format === "symlink").length,
    },
  };
}
