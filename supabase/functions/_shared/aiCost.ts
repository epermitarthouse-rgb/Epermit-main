/**
 * Cost of central AI calls (D-123). The budget reserves an upper bound before each call and settles the actual
 * usage after it, so the recorded spend can never pass the cap (permit_ai_budget_reserve):
 *   - input: one BPE token always covers at least one UTF-8 byte, so the byte count of the messages plus the
 *     chat framing is an upper bound on input tokens;
 *   - output: the call's max_tokens.
 *
 * Pure module.
 */

/** USD per 1M tokens (list price). Unknown models are refused, so a model change needs a price here first. */
export const MODEL_PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
};

/** Chat framing tokens per message and per request (generous). */
const PER_MESSAGE_OVERHEAD = 8;
const PER_REQUEST_OVERHEAD = 16;

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function priceOf(model: string): { input: number; output: number } {
  const p = MODEL_PRICES_PER_MTOK[model];
  if (!p) throw new Error(`no price configured for model ${model}`);
  return p;
}

export function inputTokenUpperBound(messages: string[]): number {
  return messages.reduce((n, m) => n + utf8Bytes(m) + PER_MESSAGE_OVERHEAD, PER_REQUEST_OVERHEAD);
}

function round6(n: number): number {
  return Math.ceil(n * 1e6) / 1e6;
}

/** The most this call can cost. */
export function reservationUsd(input: { model: string; messages: string[]; maxOutputTokens: number }): number {
  const p = priceOf(input.model);
  return round6((inputTokenUpperBound(input.messages) * p.input + input.maxOutputTokens * p.output) / 1e6);
}

export function costUsd(input: { model: string; inputTokens: number; outputTokens: number }): number {
  const p = priceOf(input.model);
  return round6((Math.max(0, input.inputTokens) * p.input + Math.max(0, input.outputTokens) * p.output) / 1e6);
}
