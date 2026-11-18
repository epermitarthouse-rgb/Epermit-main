/**
 * Read-only cost estimate for the central comment backfill (D-123). No AI calls, no writes.
 * Prints aggregates only: never comment text, names or other personal data.
 *
 *   npx tsx scripts/permit-repo/central/estimate-backfill-cost.ts \
 *     --supabase-dir ../Epermit-main --tokenizer /tmp/tok/node_modules/js-tiktoken [--adapter dc-projectdox]
 *
 * --supabase-dir: a checkout linked to the project (`supabase db query --linked` runs there; one SELECT).
 * --tokenizer: a js-tiktoken install (not a repo dependency). Without it only the byte upper bound is reported.
 *
 * Batches the same way the central stages do (one batch per permit, distinct inputs only, same prompts and chunk
 * sizes), so the input token count is what the calls would send. Output tokens are an assumption per comment;
 * the reservation total is the most the budget can be charged, which is what must fit under the cap.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
  CENTRAL_CLASSIFIER_MAX_TOKENS,
  CENTRAL_ENRICHMENT_MAX_TOKENS,
  CENTRAL_ENRICHMENT_SYSTEM_PROMPT,
  CENTRAL_MODEL,
  CENTRAL_PROCESSING_VERSION,
  CLASSIFIER_CHUNK,
  CLASSIFIER_SYSTEM_PROMPT,
  ENRICHMENT_CHUNK,
  centralClassifierUserContent,
  centralEnrichmentUserContent,
  type CentralCommentInput,
} from "../../../supabase/functions/_shared/commentPrompts";
import { costUsd, priceOf, reservationUsd } from "../../../supabase/functions/_shared/aiCost";

const OUTPUT_TOKENS_PER_COMMENT = { classify: 30, enrich: 110 };
const CHAT_OVERHEAD = { perMessage: 4, perRequest: 3 };

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] ?? null : null;
}

const adapter = arg("adapter") ?? "dc-projectdox";
if (!/^[a-z0-9-]+$/.test(adapter)) throw new Error("invalid --adapter");
const supabaseDir = path.resolve(arg("supabase-dir") ?? ".");
const tokenizerPath = arg("tokenizer");

const SQL = `
SELECT c.permit_id::text AS permit_id,
  encode(sha256(convert_to(concat_ws(chr(31),
    regexp_replace(btrim(coalesce(c.body, '')), '\\s+', ' ', 'g'),
    lower(regexp_replace(btrim(coalesce(c.department, '')), '\\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(c.comment_type, '')), '\\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(p.jurisdiction, '')), '\\s+', ' ', 'g'))), 'UTF8')), 'hex') AS input_hash,
  c.body, c.department, c.comment_type, p.jurisdiction
FROM public.permit_review_comments c
JOIN public.permits p ON p.id = c.permit_id
WHERE p.adapter_key = '${adapter}' AND c.removed_at IS NULL
ORDER BY c.permit_id, c.id`;

type Row = { permit_id: string; input_hash: string; body: string | null; department: string | null; comment_type: string | null; jurisdiction: string | null };

function query(): Row[] {
  const out = execFileSync("supabase", ["db", "query", "--linked", "--agent=no", "-o", "json", SQL], {
    cwd: supabaseDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.slice(out.indexOf("[")));
  return (Array.isArray(parsed) ? parsed : parsed.rows) as Row[];
}

function loadTokenizer(): ((s: string) => number) | null {
  if (!tokenizerPath) return null;
  const req = createRequire(path.resolve(tokenizerPath, "package.json"));
  const { getEncoding } = req(path.resolve(tokenizerPath)) as { getEncoding: (n: string) => { encode: (s: string) => number[] } };
  const enc = getEncoding("o200k_base");
  return (s) => enc.encode(s).length;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const rows = query();
const count = loadTokenizer();
const byPermit = new Map<string, Row[]>();
for (const r of rows) byPermit.set(r.permit_id, [...(byPermit.get(r.permit_id) ?? []), r]);

const seenGlobal = new Set<string>();
const totals = {
  permits_with_comments: 0,
  active_comments: rows.length,
  empty_bodies: 0,
  inputs_to_send_without_cross_permit_copy: 0,
  inputs_to_send_with_cross_permit_copy: 0,
  calls: 0,
  input_tokens: 0,
  assumed_output_tokens: 0,
  reservation_usd: 0,
};

for (const list of byPermit.values()) {
  const withBody = list.filter((r) => String(r.body ?? "").trim() !== "");
  totals.empty_bodies += list.length - withBody.length;
  if (withBody.length) totals.permits_with_comments++;
  const distinct = [...new Map(withBody.map((r) => [r.input_hash, r])).values()];
  totals.inputs_to_send_without_cross_permit_copy += distinct.length;
  const toSend = distinct.filter((r) => !seenGlobal.has(r.input_hash));
  toSend.forEach((r) => seenGlobal.add(r.input_hash));
  totals.inputs_to_send_with_cross_permit_copy += toSend.length;

  const inputs: CentralCommentInput[] = toSend.map((r) => ({ ...r, discipline: "Architectural" }));
  const stages = [
    { system: CLASSIFIER_SYSTEM_PROMPT, size: CLASSIFIER_CHUNK, user: centralClassifierUserContent, max: CENTRAL_CLASSIFIER_MAX_TOKENS, out: OUTPUT_TOKENS_PER_COMMENT.classify },
    { system: CENTRAL_ENRICHMENT_SYSTEM_PROMPT, size: ENRICHMENT_CHUNK, user: centralEnrichmentUserContent, max: CENTRAL_ENRICHMENT_MAX_TOKENS, out: OUTPUT_TOKENS_PER_COMMENT.enrich },
  ];
  for (const s of stages) {
    for (const batch of chunks(inputs, s.size)) {
      const user = s.user(batch);
      totals.calls++;
      totals.reservation_usd += reservationUsd({ model: CENTRAL_MODEL, messages: [s.system, user], maxOutputTokens: s.max });
      totals.assumed_output_tokens += s.out * batch.length;
      if (count) totals.input_tokens += count(s.system) + count(user) + 2 * CHAT_OVERHEAD.perMessage + CHAT_OVERHEAD.perRequest;
    }
  }
}

const price = priceOf(CENTRAL_MODEL);
const report = {
  adapter,
  processing_version: CENTRAL_PROCESSING_VERSION,
  model: CENTRAL_MODEL,
  price_per_mtok_usd: price,
  ...totals,
  reservation_usd: Number(totals.reservation_usd.toFixed(4)),
  estimated_cost_usd: count
    ? Number(costUsd({ model: CENTRAL_MODEL, inputTokens: totals.input_tokens, outputTokens: totals.assumed_output_tokens }).toFixed(4))
    : null,
  note: count
    ? "input_tokens counted with o200k_base on the exact prompts; output tokens assumed per comment; reservation_usd is the worst case the budget can be charged"
    : "no --tokenizer: only reservation_usd (byte upper bound) is reported",
};
console.log(JSON.stringify(report, null, 2));
