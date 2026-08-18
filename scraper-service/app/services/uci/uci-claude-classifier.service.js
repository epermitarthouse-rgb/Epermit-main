"use strict";

/**
 * Compatibility shim — Stage 5 classifier is provider-abstracted in
 * `uci-llm-classifier.service.js` (OpenAI primary when Anthropic unavailable).
 */

const {
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_ANTHROPIC_MODEL,
  getLlmClassifierConfig,
  classifyWithLlmOrKeyword,
  normalizeLlmResult,
  extractJsonObject,
} = require("./uci-llm-classifier.service.js");

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @deprecated Prefer getLlmClassifierConfig
 */
function getClaudeClassifierConfig(env = process.env) {
  const config = getLlmClassifierConfig(env);
  return {
    api_key: config.anthropic_api_key,
    enabled: config.provider === "anthropic",
    model: config.anthropic_model,
    timeout_ms: config.timeout_ms,
    configured: config.anthropic_configured,
  };
}

/**
 * @param {unknown} value
 * @param {ReturnType<typeof import("./uci-communication-categories.js").classifyCommunicationText>} keywordFallback
 * @deprecated Prefer normalizeLlmResult
 */
function normalizeClaudeResult(value, keywordFallback) {
  const normalized = normalizeLlmResult(value, keywordFallback, {
    provider: "anthropic",
    model: DEFAULT_ANTHROPIC_MODEL,
  });
  return {
    ...normalized,
    // Legacy method label for older tests that assert "claude"
    classifier_method:
      normalized.classifier_method === "llm" ? "claude" : normalized.classifier_method,
    claude_rationale: normalized.llm_rationale ?? null,
    claude_error: normalized.llm_error ?? null,
  };
}

/**
 * @param {object} params
 * @deprecated Prefer classifyWithLlmOrKeyword
 */
async function classifyWithClaudeOrKeyword(params) {
  return classifyWithLlmOrKeyword(params);
}

module.exports = {
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_CLAUDE_MODEL: DEFAULT_ANTHROPIC_MODEL,
  getClaudeClassifierConfig,
  classifyWithClaudeOrKeyword,
  normalizeClaudeResult,
  extractJsonObject,
};
