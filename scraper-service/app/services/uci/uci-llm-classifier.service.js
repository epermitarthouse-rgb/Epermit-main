"use strict";

/**
 * Stage 5 LLM classifier abstraction (OpenAI primary when Anthropic unavailable).
 * Provider/model live in audit metadata only — operator UI must not surface provider wording.
 * Failure never advances lifecycle — callers treat low-confidence / failure as attention.
 */

const {
  UCI_COMMUNICATION_CATEGORIES,
  CLASSIFIER_VERSION,
  LOW_CONFIDENCE_THRESHOLD,
  isValidCategory,
  classifyCommunicationText,
} = require("./uci-communication-categories.js");
const {
  createOpenAiClient,
} = require("./uci-document-fallback-processors.service.js");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function getLlmClassifierConfig(env = process.env) {
  const openaiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const anthropicKey = String(env.ANTHROPIC_API_KEY ?? "").trim();
  const preferred = String(env.UCI_LLM_CLASSIFIER_PROVIDER ?? "auto")
    .trim()
    .toLowerCase();

  const anthropicEnabledFlag = String(
    env.UCI_CLAUDE_CLASSIFIER_ENABLED ?? (anthropicKey ? "true" : "false"),
  ).toLowerCase();
  const anthropicConfigured = Boolean(anthropicKey) && anthropicEnabledFlag === "true";
  const openaiConfigured = Boolean(openaiKey);

  const explicitDisabled =
    String(env.UCI_LLM_CLASSIFIER_ENABLED ?? "true").toLowerCase() === "false";

  /** @type {"openai" | "anthropic" | null} */
  let provider = null;
  if (!explicitDisabled) {
    if (preferred === "openai" && openaiConfigured) provider = "openai";
    else if ((preferred === "anthropic" || preferred === "claude") && anthropicConfigured) {
      provider = "anthropic";
    } else if (preferred === "keyword" || preferred === "none") {
      provider = null;
    } else if (preferred === "auto" || !preferred) {
      // Prefer Claude when properly configured; otherwise use established OpenAI.
      if (anthropicConfigured) provider = "anthropic";
      else if (openaiConfigured) provider = "openai";
    } else if (openaiConfigured) {
      provider = "openai";
    } else if (anthropicConfigured) {
      provider = "anthropic";
    }
  }

  const openaiModel =
    String(env.UCI_LLM_CLASSIFIER_MODEL ?? env.UCI_OPENAI_CLASSIFIER_MODEL ?? DEFAULT_OPENAI_MODEL)
      .trim() || DEFAULT_OPENAI_MODEL;
  const anthropicModel =
    String(env.UCI_CLAUDE_CLASSIFIER_MODEL ?? DEFAULT_ANTHROPIC_MODEL).trim() ||
    DEFAULT_ANTHROPIC_MODEL;

  return {
    provider,
    openai_configured: openaiConfigured,
    anthropic_configured: anthropicConfigured,
    openai_api_key: openaiKey,
    anthropic_api_key: anthropicKey,
    openai_model: openaiModel,
    anthropic_model: anthropicModel,
    model: provider === "anthropic" ? anthropicModel : provider === "openai" ? openaiModel : null,
    timeout_ms: Math.max(
      3000,
      Number(env.UCI_LLM_CLASSIFIER_TIMEOUT_MS ?? env.UCI_CLAUDE_CLASSIFIER_TIMEOUT_MS ?? 45000) ||
        45000,
    ),
    enabled: Boolean(provider),
    preferred,
  };
}

/**
 * @param {string} text
 */
function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildClassifierSystemPrompt() {
  return [
    "You are the UCI Communication Parser (LLM classifier).",
    "Classify the utility communication into exactly one category.",
    `Allowed categories: ${UCI_COMMUNICATION_CATEGORIES.join(", ")}.`,
    "Return ONLY JSON with keys:",
    "classification, confidence (0-1), summary (1-2 sentences), action_items (array),",
    "needs_human_attention (boolean), rationale (short),",
    "extracted_fields: { utility_ticket_number, utility_project_manager, utility_account_number, next_required_action }.",
    `If confidence < ${LOW_CONFIDENCE_THRESHOLD}, set needs_human_attention true.`,
  ].join(" ");
}

/**
 * @param {unknown} value
 * @param {ReturnType<typeof classifyCommunicationText>} keywordFallback
 * @param {{ provider: string, model: string }} meta
 */
function normalizeLlmResult(value, keywordFallback, meta) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ...keywordFallback,
      classifier_method: "keyword_fallback",
      classifier_version: CLASSIFIER_VERSION,
      llm_provider: meta.provider,
      llm_model: meta.model,
      llm_error: "invalid_json",
      needs_human_attention: true,
    };
  }

  const obj = /** @type {Record<string, unknown>} */ (value);
  const classificationRaw = String(obj.classification ?? "").trim().toLowerCase();
  const classification = isValidCategory(classificationRaw) ? classificationRaw : "unclassified";
  let confidence = Number(obj.confidence ?? obj.classification_confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.min(1, Math.max(0, confidence));

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim().slice(0, 500)
      : keywordFallback.parsed_summary;

  /** @type {Array<Record<string, unknown>>} */
  let actionItems = [];
  if (Array.isArray(obj.action_items)) {
    actionItems = obj.action_items
      .filter((item) => item && typeof item === "object")
      .map((item) => /** @type {Record<string, unknown>} */ (item))
      .slice(0, 10);
  } else if (Array.isArray(keywordFallback.parsed_action_items)) {
    actionItems = /** @type {Array<Record<string, unknown>>} */ (keywordFallback.parsed_action_items);
  }

  const extracted =
    obj.extracted_fields && typeof obj.extracted_fields === "object" && !Array.isArray(obj.extracted_fields)
      ? {
          ...keywordFallback.extracted_fields,
          .../** @type {Record<string, unknown>} */ (obj.extracted_fields),
        }
      : keywordFallback.extracted_fields;

  const needsHumanAttention =
    confidence < LOW_CONFIDENCE_THRESHOLD ||
    classification === "unclassified" ||
    classification === "escalation_or_problem" ||
    classification === "request_for_information" ||
    obj.needs_human_attention === true;

  return {
    classification,
    classification_confidence: confidence,
    parsed_summary: summary,
    parsed_action_items: actionItems,
    needs_human_attention: needsHumanAttention,
    classifier_method: "llm",
    classifier_version: CLASSIFIER_VERSION,
    llm_provider: meta.provider,
    llm_model: meta.model,
    extracted_fields: extracted,
    llm_rationale: typeof obj.rationale === "string" ? obj.rationale.slice(0, 800) : null,
  };
}

/**
 * @param {object} params
 */
async function classifyViaOpenAI(params) {
  const { subject, body, keywordResult, config, deps } = params;
  const hasInjectedCreate = typeof deps.openaiCreateFn === "function";
  const openai =
    deps.openai ||
    (hasInjectedCreate
      ? null
      : createOpenAiClient({
          openai: deps.openai,
          env: deps.env || process.env,
        }));

  if (!openai && !hasInjectedCreate) {
    return {
      ...keywordResult,
      classifier_method: "keyword_fallback",
      classifier_version: CLASSIFIER_VERSION,
      llm_provider: "openai",
      llm_model: config.openai_model,
      llm_error: "client_unavailable",
      needs_human_attention: true,
    };
  }

  const userPrompt = `Subject: ${subject || "(none)"}\n\nBody:\n${(body || "").slice(0, 12000)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const createFn = hasInjectedCreate
      ? deps.openaiCreateFn
      : (request, options) => openai.chat.completions.create(request, options);

    const response = await createFn(
      {
        model: config.openai_model,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildClassifierSystemPrompt() },
          { role: "user", content: userPrompt },
        ],
      },
      { signal: controller.signal },
    );

    const content = response?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(typeof content === "string" ? content : "");
    if (!parsed) {
      return {
        ...keywordResult,
        classifier_method: "keyword_fallback",
        classifier_version: CLASSIFIER_VERSION,
        llm_provider: "openai",
        llm_model: config.openai_model,
        llm_error: "json_extract_failed",
        needs_human_attention: true,
      };
    }

    return normalizeLlmResult(parsed, keywordResult, {
      provider: "openai",
      model: config.openai_model,
    });
  } catch (err) {
    return {
      ...keywordResult,
      classifier_method: "keyword_fallback",
      classifier_version: CLASSIFIER_VERSION,
      llm_provider: "openai",
      llm_model: config.openai_model,
      llm_error: err instanceof Error ? err.name || "request_failed" : "request_failed",
      needs_human_attention: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} params
 */
async function classifyViaAnthropic(params) {
  const { subject, body, keywordResult, config, deps } = params;
  const fetchFn = typeof deps.fetchFn === "function" ? deps.fetchFn : fetch;
  const userPrompt = `Subject: ${subject || "(none)"}\n\nBody:\n${(body || "").slice(0, 12000)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const response = await fetchFn(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropic_api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.anthropic_model,
        max_tokens: 800,
        temperature: 0,
        system: buildClassifierSystemPrompt(),
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        ...keywordResult,
        classifier_method: "keyword_fallback",
        classifier_version: CLASSIFIER_VERSION,
        llm_provider: "anthropic",
        llm_model: config.anthropic_model,
        llm_error: `http_${response.status}`,
        llm_error_detail: text.slice(0, 300),
        needs_human_attention: true,
      };
    }

    /** @type {unknown} */
    let envelope = null;
    try {
      envelope = JSON.parse(text);
    } catch {
      return {
        ...keywordResult,
        classifier_method: "keyword_fallback",
        classifier_version: CLASSIFIER_VERSION,
        llm_provider: "anthropic",
        llm_model: config.anthropic_model,
        llm_error: "response_parse_failed",
        needs_human_attention: true,
      };
    }

    const content = /** @type {{ content?: Array<{ type?: string, text?: string }> }} */ (envelope)
      .content;
    const textParts = Array.isArray(content)
      ? content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text)
      : [];
    const joined = textParts.join("\n");
    const parsed = extractJsonObject(joined);
    if (!parsed) {
      return {
        ...keywordResult,
        classifier_method: "keyword_fallback",
        classifier_version: CLASSIFIER_VERSION,
        llm_provider: "anthropic",
        llm_model: config.anthropic_model,
        llm_error: "json_extract_failed",
        needs_human_attention: true,
      };
    }

    return normalizeLlmResult(parsed, keywordResult, {
      provider: "anthropic",
      model: config.anthropic_model,
    });
  } catch (err) {
    return {
      ...keywordResult,
      classifier_method: "keyword_fallback",
      classifier_version: CLASSIFIER_VERSION,
      llm_provider: "anthropic",
      llm_model: config.anthropic_model,
      llm_error: err instanceof Error ? err.name || "request_failed" : "request_failed",
      needs_human_attention: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} params
 * @param {string | null | undefined} params.subject
 * @param {string | null | undefined} params.body
 * @param {Record<string, unknown>} [params.deps]
 * @param {NodeJS.ProcessEnv} [params.env]
 */
async function classifyWithLlmOrKeyword(params) {
  const subject = params.subject != null ? String(params.subject) : null;
  const body = params.body != null ? String(params.body) : null;
  const keywordResult = classifyCommunicationText(subject, body);
  const env = params.env || process.env;
  const config = getLlmClassifierConfig(env);
  const deps = { ...(params.deps || {}), env };

  if (!config.enabled || !config.provider) {
    return {
      ...keywordResult,
      classifier_method: "keyword",
      classifier_version: CLASSIFIER_VERSION,
      llm_provider: null,
      llm_model: null,
      llm_skipped: true,
      llm_skip_reason: config.preferred === "keyword" ? "forced_keyword" : "no_llm_provider_configured",
    };
  }

  if (config.provider === "openai") {
    return classifyViaOpenAI({ subject, body, keywordResult, config, deps });
  }

  return classifyViaAnthropic({ subject, body, keywordResult, config, deps });
}

module.exports = {
  ANTHROPIC_MESSAGES_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  getLlmClassifierConfig,
  classifyWithLlmOrKeyword,
  normalizeLlmResult,
  extractJsonObject,
  buildClassifierSystemPrompt,
};
