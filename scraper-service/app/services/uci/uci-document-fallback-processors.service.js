"use strict";

const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MAX_OPENAI_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const UCI_VISION_SYSTEM_PROMPT = `You extract factual engineering and utility-application evidence from a single plan/document page image.
Return JSON only with shape:
{
  "findings": [
    {
      "field_key": "service_voltage|service_amperage|phase|connected_load_kva|panel_demand_load_kva|...",
      "raw_value": "verbatim text",
      "normalized_value": number|string|null,
      "unit": "V|A|kVA|kW|...|null",
      "entity_type": "project_service|electrical_panel|equipment|specification_reference",
      "entity_name": "panel/equipment name or null",
      "evidence_text": "short supporting quote from page",
      "bounding_region": { "x": 0, "y": 0, "width": 0, "height": 0 },
      "confidence": 0.0
    }
  ],
  "sheet_title": "optional",
  "sheet_number": "optional"
}
Rules:
- Only report values visibly supported on the page.
- Do not infer engineering calculations or convert kVA↔kW.
- Use null normalized_value when uncertain.
- All findings require human review.`;

const UCI_OCR_SYSTEM_PROMPT = `You perform OCR on a utility/permit document page image.
Return JSON only:
{
  "page_text": "full extracted text preserving line breaks where possible",
  "average_confidence": 0.0,
  "low_confidence_regions": [{ "text": "", "confidence": 0.0 }],
  "words": [{ "text": "", "confidence": 0.0, "x": 0, "y": 0, "width": 0, "height": 0 }]
}
Do not interpret or classify fields — OCR text only.`;

function fallbackError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function validateImageInput(imageBase64, imageMimeType) {
  const mimeType = String(imageMimeType || "").toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw fallbackError(`Unsupported fallback image type: ${mimeType || "missing"}`, {
      code: "FALLBACK_IMAGE_TYPE_UNSUPPORTED",
      stage: "image_validation",
    });
  }
  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    throw fallbackError("Fallback page image is empty", {
      code: "FALLBACK_IMAGE_EMPTY",
      stage: "image_validation",
    });
  }
  const estimatedBytes = Math.floor((imageBase64.length * 3) / 4);
  if (estimatedBytes > MAX_OPENAI_IMAGE_BYTES) {
    throw fallbackError(
      `Fallback page image exceeds ${MAX_OPENAI_IMAGE_BYTES} byte limit`,
      {
        code: "FALLBACK_IMAGE_TOO_LARGE",
        stage: "image_validation",
        image_bytes: estimatedBytes,
      },
    );
  }
  return { mimeType, estimatedBytes };
}

function isRetryableOpenAiError(error) {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if ([408, 409, 429].includes(status) || status >= 500) return true;
  return ["APIConnectionError", "APITimeoutError", "ECONNRESET", "ETIMEDOUT"].includes(
    String(error?.name ?? error?.code ?? ""),
  );
}

function safeProviderMessage(error) {
  return String(error?.error?.message ?? error?.message ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function decorateOpenAiError(error, details) {
  if (error?.stage) return error;
  const status = Number(error?.status ?? error?.statusCode ?? 0) || null;
  const providerCode = error?.code != null ? String(error.code) : null;
  const providerType = error?.type != null ? String(error.type) : null;
  const requestId =
    error?.request_id != null
      ? String(error.request_id)
      : error?.headers?.get?.("x-request-id") ?? null;
  return fallbackError(
    status
      ? `OpenAI request failed (${status}${providerCode ? ` ${providerCode}` : ""})`
      : `OpenAI request failed: ${String(error?.message || "network error").slice(0, 240)}`,
    {
      code: "OPENAI_REQUEST_FAILED",
      stage: "openai_request",
      http_status: status,
      provider_code: providerCode,
      provider_type: providerType,
      provider_message: safeProviderMessage(error),
      request_id: requestId,
      endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      model: details.model,
      attempts: details.attempts,
      cause: error,
    },
  );
}

async function createChatCompletionWithRetry(openai, request, options) {
  const maxRetries = Math.max(0, Number(options.maxRetries ?? 0));
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await openai.chat.completions.create(request, { signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableOpenAiError(error)) {
        throw decorateOpenAiError(error, { model: request.model, attempts: attempt + 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 4000)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw decorateOpenAiError(lastError, { model: request.model, attempts: maxRetries + 1 });
}

function parseJsonResponse(raw, expectedField, details) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !(expectedField in parsed)) {
      throw new Error(`missing ${expectedField}`);
    }
    return parsed;
  } catch (error) {
    throw fallbackError(`OpenAI returned invalid fallback JSON (${String(error.message)})`, {
      code: "OPENAI_RESPONSE_PARSE_FAILED",
      stage: "response_parsing",
      endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
      model: details.model,
      response_chars: String(raw ?? "").length,
    });
  }
}

function createOpenAiClient(deps = {}) {
  if (deps.openai) return deps.openai;
  const apiKey = String((deps.env || process.env).OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const OpenAI = require("openai").default || require("openai");
  return new OpenAI({ apiKey });
}

/**
 * @param {object} params
 * @returns {Promise<{ findings: Array<Record<string, unknown>>, usage?: Record<string, unknown>, duration_ms: number, provider: string, model: string }>}
 */
async function processVisionPageOpenAI(params) {
  const {
    openai,
    imageBase64,
    imageMimeType = "image/png",
    model = "gpt-4o",
    timeoutMs = 90000,
    maxRetries = 1,
    documentRoles = [],
    pageNumber = 1,
  } = params;

  if (!openai) {
    throw new Error("OpenAI client not configured");
  }

  const start = Date.now();
  validateImageInput(imageBase64, imageMimeType);

  const response = await createChatCompletionWithRetry(
    openai,
    {
        model,
        messages: [
          { role: "system", content: UCI_VISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Page ${pageNumber}. Document roles: ${documentRoles.join(", ") || "unknown"}. Extract UCI-relevant facts only.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        response_format: { type: "json_object" },
    },
    { timeoutMs, maxRetries },
  );

  const raw = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonResponse(raw, "findings", { model });

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return {
      findings: findings.map((f) => ({
        ...f,
        page_number: pageNumber,
        extraction_method: "vision",
        requires_human_review: true,
      })),
      sheet_title: parsed.sheet_title ?? null,
      sheet_number: parsed.sheet_number ?? null,
      usage: response.usage ?? null,
      duration_ms: Date.now() - start,
      provider: "openai",
      model,
    endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
  };
}

/**
 * @param {object} params
 */
async function processOcrPageOpenAI(params) {
  const {
    openai,
    imageBase64,
    imageMimeType = "image/png",
    model = "gpt-4o",
    timeoutMs = 90000,
    maxRetries = 1,
    pageNumber = 1,
  } = params;

  if (!openai) {
    throw new Error("OpenAI client not configured");
  }

  const start = Date.now();
  validateImageInput(imageBase64, imageMimeType);

  const response = await createChatCompletionWithRetry(
    openai,
    {
        model,
        messages: [
          { role: "system", content: UCI_OCR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `OCR page ${pageNumber}. Return text only.` },
              {
                type: "image_url",
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        response_format: { type: "json_object" },
    },
    { timeoutMs, maxRetries },
  );

  const raw = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonResponse(raw, "page_text", { model });

  return {
      page_text: String(parsed.page_text ?? ""),
      average_confidence:
        parsed.average_confidence != null ? Number(parsed.average_confidence) : null,
      low_confidence_regions: Array.isArray(parsed.low_confidence_regions)
        ? parsed.low_confidence_regions
        : [],
      words: Array.isArray(parsed.words) ? parsed.words : [],
      usage: response.usage ?? null,
      duration_ms: Date.now() - start,
      provider: "openai",
      model,
    endpoint: OPENAI_CHAT_COMPLETIONS_ENDPOINT,
  };
}

/**
 * Mock vision processor for tests.
 */
class MockVisionPageProcessor {
  /**
   * @param {Array<Record<string, unknown>>} [responses]
   */
  constructor(responses = []) {
    this.responses = responses;
    this.calls = [];
  }

  /**
   * @param {Record<string, unknown>} input
   */
  async processPage(input) {
    this.calls.push(input);
    const idx = this.calls.length - 1;
    const preset = this.responses[idx] ?? this.responses[0] ?? { findings: [] };
    return {
      findings: Array.isArray(preset.findings) ? preset.findings : [],
      sheet_title: preset.sheet_title ?? null,
      sheet_number: preset.sheet_number ?? null,
      duration_ms: 1,
      provider: "mock",
      model: "mock-vision",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
  }
}

/**
 * Mock OCR processor for tests.
 */
class MockOcrPageProcessor {
  /**
   * @param {Array<Record<string, unknown>>} [responses]
   */
  constructor(responses = []) {
    this.responses = responses;
    this.calls = [];
  }

  /**
   * @param {Record<string, unknown>} input
   */
  async processPage(input) {
    this.calls.push(input);
    const idx = this.calls.length - 1;
    const preset =
      this.responses[idx] ??
      this.responses[0] ?? {
        page_text: "",
        average_confidence: 0.5,
      };
    return {
      page_text: String(preset.page_text ?? ""),
      average_confidence:
        preset.average_confidence != null ? Number(preset.average_confidence) : 0.5,
      low_confidence_regions: Array.isArray(preset.low_confidence_regions)
        ? preset.low_confidence_regions
        : [],
      words: Array.isArray(preset.words) ? preset.words : [],
      duration_ms: 1,
      provider: "mock",
      model: "mock-ocr",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
  }
}

/**
 * @param {ReturnType<import("./uci-document-fallback-config.service.js").getDocumentFallbackConfig>} config
 * @param {object} [deps]
 */
function createVisionPageProcessor(config, deps = {}) {
  if (deps.visionProcessor) return deps.visionProcessor;
  if (!config.vision_enabled || !config.openai_configured) {
    return {
      async processPage() {
        const err = new Error("Vision processing is disabled or not configured");
        err.code = "VISION_DISABLED";
        throw err;
      },
    };
  }
  const openai = createOpenAiClient(deps);
  if (!openai) {
    return {
      async processPage() {
        const err = new Error("OpenAI client not available");
        err.code = "VISION_NOT_CONFIGURED";
        throw err;
      },
    };
  }
  return {
    async processPage(input) {
      return processVisionPageOpenAI({
        openai,
        imageBase64: input.image_base64,
        imageMimeType: input.image_mime_type,
        model: config.vision_model,
        timeoutMs: config.ai_timeout_ms,
        maxRetries: config.ai_max_retries,
        documentRoles: input.document_roles ?? [],
        pageNumber: input.page_number,
      });
    },
  };
}

/**
 * @param {ReturnType<import("./uci-document-fallback-config.service.js").getDocumentFallbackConfig>} config
 * @param {object} [deps]
 */
function createOcrPageProcessor(config, deps = {}) {
  if (deps.ocrProcessor) return deps.ocrProcessor;
  if (!config.ocr_enabled || !config.openai_configured) {
    return {
      async processPage() {
        const err = new Error("OCR processing is disabled or not configured");
        err.code = "OCR_DISABLED";
        throw err;
      },
    };
  }
  const openai = createOpenAiClient(deps);
  if (!openai) {
    return {
      async processPage() {
        const err = new Error("OpenAI client not available");
        err.code = "OCR_NOT_CONFIGURED";
        throw err;
      },
    };
  }
  return {
    async processPage(input) {
      return processOcrPageOpenAI({
        openai,
        imageBase64: input.image_base64,
        imageMimeType: input.image_mime_type,
        model: config.ocr_model,
        timeoutMs: config.ai_timeout_ms,
        maxRetries: config.ai_max_retries,
        pageNumber: input.page_number,
      });
    },
  };
}

module.exports = {
  UCI_VISION_SYSTEM_PROMPT,
  UCI_OCR_SYSTEM_PROMPT,
  MockVisionPageProcessor,
  MockOcrPageProcessor,
  createVisionPageProcessor,
  createOcrPageProcessor,
  processVisionPageOpenAI,
  processOcrPageOpenAI,
  createOpenAiClient,
  validateImageInput,
  OPENAI_CHAT_COMPLETIONS_ENDPOINT,
  MAX_OPENAI_IMAGE_BYTES,
};
