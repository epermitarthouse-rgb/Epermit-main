import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3.23.8';

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';

const FileSchema = z.object({
  name: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(120),
  // data URL, e.g. "data:image/png;base64,...."
  dataUrl: z.string().startsWith('data:').max(20 * 1024 * 1024),
});

const BodySchema = z.object({
  jurisdiction: z.string().min(1).max(160),
  projectType: z.string().min(1).max(160),
  codeYear: z.string().min(2).max(8),
  hvhz: z.boolean().optional().default(false),
  files: z.array(FileSchema).min(1).max(6),
});

const FindingSchema = z.object({
  severity: z.enum(['critical', 'warn', 'info']),
  code: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  page: z.string().min(1).max(80),
  suggestion: z.string().min(1).max(600),
});

const ResponseSchema = z.object({
  pagesReviewed: z.number().int().min(0).max(9999),
  summary: z.string().max(600).optional().default(''),
  findings: z.array(FindingSchema).max(50),
});

const SYSTEM_PROMPT = `You are DesignCheck, an AI code-compliance reviewer for AEC permit drawings.
You perform an initial automated review across 8 reviewer agents:
Zoning Overlay, Fire/Life Safety, Accessibility, Energy Code, Stormwater, Utility Clearance, Historic District, Submission Completeness.

Given the user's project context and the uploaded drawing sheet(s), return a concise list of
likely code-compliance findings. Cite the applicable code section (IBC, IECC, IPC, IFC, ADA, NFPA,
local amendments) with chapter/section numbers. For each finding, identify the sheet/page label
visible in the drawing title block when possible (e.g. "A-101", "P-201"); if not visible, use "n/a".

Severity guidance:
- "critical": code violation that will block permit issuance
- "warn":     borderline/prescriptive shortfall that reviewer will flag
- "info":     assumption to confirm or documentation gap

Be conservative — only report findings you can justify from what's visible or from missing information.
Return between 3 and 12 findings. If the file is not a drawing, return 0 findings and explain in summary.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return json({ error: 'AI is not configured' }, 500);

  let parsed;
  try {
    parsed = BodySchema.safeParse(await req.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, 400);
  }
  const { jurisdiction, projectType, codeYear, hvhz, files } = parsed.data;

  const userText =
    `Jurisdiction: ${jurisdiction}\nProject type: ${projectType}\nAdopted code year: ${codeYear}` +
    (hvhz ? '\nHVHZ: yes (High-Velocity Hurricane Zone — apply FBC HVHZ provisions)' : '') +
    `\n\nReview the attached drawing sheet(s) and return findings.` +
    `\n\nRespond with STRICT JSON only, no prose, matching this TypeScript type:\n` +
    `{"pagesReviewed": number, "summary": string, "findings": Array<{"severity":"critical"|"warn"|"info","code": string,"title": string,"page": string,"suggestion": string}>}`;

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: userText }];
  for (const f of files) {
    if (f.mimeType.startsWith('image/')) {
      content.push({ type: 'image_url', image_url: { url: f.dataUrl } });
    } else if (f.mimeType === 'application/pdf') {
      content.push({ type: 'file', file: { filename: f.name, file_data: f.dataUrl } });
    }
  }

  let gatewayRes: Response;
  try {
    gatewayRes = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Lovable-API-Key': apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });
  } catch (err) {
    console.error('[compliance] gateway fetch failed', err);
    return json({ error: 'AI gateway unreachable' }, 502);
  }

  if (!gatewayRes.ok) {
    const details = await gatewayRes.text();
    console.error(`[compliance] gateway ${gatewayRes.status}: ${details}`);
    if (gatewayRes.status === 429) return json({ error: 'Rate limited. Try again shortly.' }, 429);
    if (gatewayRes.status === 402) return json({ error: 'AI credits exhausted. Please top up.' }, 402);
    return json({ error: 'AI request failed', details }, gatewayRes.status);
  }

  const payload = await gatewayRes.json();
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') {
    return json({ error: 'Empty AI response' }, 502);
  }

  let obj: unknown;
  try {
    obj = JSON.parse(stripFence(raw));
  } catch {
    console.error('[compliance] non-JSON model output', raw.slice(0, 400));
    return json({ error: 'Model returned non-JSON output' }, 502);
  }

  const shaped = ResponseSchema.safeParse(obj);
  if (!shaped.success) {
    return json({ error: 'AI response failed validation', details: shaped.error.flatten() }, 502);
  }

  const withIds = {
    ...shaped.data,
    findings: shaped.data.findings.map((f, i) => ({ id: `F-${String(i + 1).padStart(3, '0')}`, ...f })),
  };
  return json(withIds, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stripFence(s: string): string {
  const t = s.trim();
  if (t.startsWith('```')) {
    return t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return t;
}