"use strict";

const OpenAI = require("openai");

let openaiClient = null;

function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

async function embedTexts(openai, texts) {
  if (texts.length === 0) return [];

  const batchSize = 20;
  const embeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });

    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      embeddings.push(item.embedding);
    }
  }

  return embeddings;
}

module.exports = { embedTexts, getOpenAIClient };
