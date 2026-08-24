"use strict";

const fs = require("fs/promises");
const { createCanvas } = require("canvas");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const sharp = require("sharp");

const DPI = Number(process.env.CODE_ANALYZER_RASTER_DPI) || 150;
const SCALE = DPI / 72;

async function rasterizePagePng(filePath, pageNumber) {
  const buffer = await fs.readFile(filePath);
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise;
  try {
    const page = await pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      return { buffer: png, width: canvas.width, height: canvas.height };
    } finally {
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
}

async function createThumbnail(pngBuffer) {
  return sharp(pngBuffer).resize({ width: 320, withoutEnlargement: true }).png().toBuffer();
}

module.exports = { rasterizePagePng, createThumbnail };
