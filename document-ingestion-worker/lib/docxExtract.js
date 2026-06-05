"use strict";

const fs = require("fs/promises");
const mammoth = require("mammoth");
const { MIN_PAGE_TEXT_CHARS } = require("./chunk");

async function extractDocxPage(filePath) {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value ?? "").replace(/\r\n/g, "\n").trim();

  return {
    pageNumber: 1,
    text,
    lowText: text.length < MIN_PAGE_TEXT_CHARS,
  };
}

module.exports = { extractDocxPage };
