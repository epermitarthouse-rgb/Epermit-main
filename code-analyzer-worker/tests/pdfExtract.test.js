"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { extractPdfPagesFromFile } = require("../lib/pdfExtract");

function buildSinglePagePdf({ mediaBox, cropBox }) {
  const box = (name, values) => (values ? `/${name} [${values.join(" ")}]` : "");
  const content = " ";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    `<< /Type /Page /Parent 2 0 R ${box("MediaBox", mediaBox)} ${box("CropBox", cropBox)} /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return body;
}

async function readFirstPageSize(pdfBody) {
  const filePath = path.join(os.tmpdir(), `code-analyzer-page-size-${process.pid}-${Date.now()}.pdf`);
  await fs.writeFile(filePath, pdfBody);
  try {
    const pages = [];
    for await (const page of extractPdfPagesFromFile(filePath)) pages.push(page);
    assert.equal(pages.length, 1);
    return pages[0];
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}

describe("pdf page size from MediaBox / CropBox", () => {
  it("reads a 24x36 MediaBox in inches", async () => {
    const page = await readFirstPageSize(buildSinglePagePdf({ mediaBox: [0, 0, 36 * 72, 24 * 72] }));
    assert.ok(Math.abs(page.widthInches - 36) < 0.05, `width ${page.widthInches}`);
    assert.ok(Math.abs(page.heightInches - 24) < 0.05, `height ${page.heightInches}`);
  });

  it("uses the CropBox when it is smaller than the MediaBox", async () => {
    const page = await readFirstPageSize(
      buildSinglePagePdf({
        mediaBox: [0, 0, 36 * 72, 24 * 72],
        cropBox: [0, 0, 8.5 * 72, 11 * 72],
      }),
    );
    const shortSide = Math.min(page.widthInches, page.heightInches);
    const longSide = Math.max(page.widthInches, page.heightInches);
    assert.ok(Math.abs(shortSide - 8.5) < 0.05, `short ${shortSide}`);
    assert.ok(Math.abs(longSide - 11) < 0.05, `long ${longSide}`);
  });
});
