"use strict";

const FALLBACK_SCHEMA_VERSION = "row-fallback-v1";

/**
 * @returns {{
 *   schema_version: string;
 *   vision_enabled: boolean;
 *   ocr_enabled: boolean;
 *   vision_max_pages_per_run: number;
 *   ocr_max_pages_per_run: number;
 *   ai_timeout_ms: number;
 *   ai_max_retries: number;
 *   ocr_min_confidence: number;
 *   vision_model: string;
 *   ocr_model: string;
 *   openai_configured: boolean;
 * }}
 */
function getDocumentFallbackConfig(env = process.env) {
  const openaiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const visionEnabled =
    String(env.UCI_DOCUMENT_VISION_ENABLED ?? "false").toLowerCase() === "true";
  const ocrEnabled =
    String(env.UCI_DOCUMENT_OCR_ENABLED ?? "false").toLowerCase() === "true";

  return {
    schema_version: FALLBACK_SCHEMA_VERSION,
    vision_enabled: visionEnabled,
    ocr_enabled: ocrEnabled,
    vision_max_pages_per_run: Math.max(
      0,
      Number(env.UCI_DOCUMENT_VISION_MAX_PAGES_PER_RUN ?? 25) || 25,
    ),
    ocr_max_pages_per_run: Math.max(
      0,
      Number(env.UCI_DOCUMENT_OCR_MAX_PAGES_PER_RUN ?? 25) || 25,
    ),
    ai_timeout_ms: Math.max(5000, Number(env.UCI_DOCUMENT_AI_TIMEOUT_MS ?? 90000) || 90000),
    ai_max_retries: Math.max(
      0,
      Number.isFinite(Number(env.UCI_DOCUMENT_AI_MAX_RETRIES))
        ? Number(env.UCI_DOCUMENT_AI_MAX_RETRIES)
        : 1,
    ),
    ocr_min_confidence: Math.min(
      1,
      Math.max(0, Number(env.UCI_DOCUMENT_OCR_MIN_CONFIDENCE ?? 0.6) || 0.6),
    ),
    vision_model: String(env.UCI_DOCUMENT_VISION_MODEL ?? "gpt-4o").trim() || "gpt-4o",
    ocr_model: String(env.UCI_DOCUMENT_OCR_MODEL ?? "gpt-4o").trim() || "gpt-4o",
    openai_configured: Boolean(openaiKey),
  };
}

/**
 * @param {"vision"|"ocr"} method
 * @param {ReturnType<typeof getDocumentFallbackConfig>} config
 */
function isFallbackMethodAvailable(method, config) {
  if (method === "vision") {
    return config.vision_enabled && config.openai_configured;
  }
  if (method === "ocr") {
    return config.ocr_enabled && config.openai_configured;
  }
  return false;
}

/**
 * @param {ReturnType<typeof getDocumentFallbackConfig>} config
 */
function fallbackProviderStatus(config) {
  /** @type {string[]} */
  const warnings = [];
  if (!config.openai_configured) {
    warnings.push("OpenAI API key is not configured — Vision/OCR fallback is unavailable");
  }
  if (!config.vision_enabled) {
    warnings.push("Vision fallback is disabled (UCI_DOCUMENT_VISION_ENABLED=false)");
  }
  if (!config.ocr_enabled) {
    warnings.push("OCR fallback is disabled (UCI_DOCUMENT_OCR_ENABLED=false)");
  }
  return {
    vision_available: isFallbackMethodAvailable("vision", config),
    ocr_available: isFallbackMethodAvailable("ocr", config),
    warnings,
  };
}

module.exports = {
  FALLBACK_SCHEMA_VERSION,
  getDocumentFallbackConfig,
  isFallbackMethodAvailable,
  fallbackProviderStatus,
};
