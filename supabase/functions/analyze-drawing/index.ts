import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.28.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ComplianceIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'advisory';
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
}

interface AnalysisResult {
  issues: ComplianceIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number;
  };
  jurisdictionNotes: string;
}

// Jurisdiction-specific amendments
const jurisdictionAmendments: Record<string, string> = {
  'dc': `WASHINGTON, DC:
The published construction-code adoption is a registry fact, not technical section text. No comprehensive licensed ICC base-code text is stored in this prompt. Cite a section only when its verified text was retrieved. Do not invent a DC threshold.`,
  'new-york': `NEW YORK CITY:
NYC BC is a separate code family. This prompt does not contain its technical provisions. Use retrieved verified text, or leave the citation as an unverified reference.`,
  'california': `CALIFORNIA:
CBC Title 24 is an adopted code family. This prompt does not contain its technical provisions. Use retrieved verified text, or leave the citation as an unverified reference.`,
  'florida': `FLORIDA:
The Florida Building Code is an adopted code family. This prompt does not contain its technical provisions. Use retrieved verified text, or leave the citation as an unverified reference.`,
  'texas': `TEXAS:
Texas adoption is local. This prompt does not contain technical provisions. Use retrieved verified text, or leave the citation as an unverified reference.`,
  'chicago': `CHICAGO:
The Chicago Building Code is a separate code family. This prompt does not contain its technical provisions. Use retrieved verified text, or leave the citation as an unverified reference.`,
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    let imageBase64: string;
    let imageType: string;
    let jurisdiction: string;
    let projectType: string;
    let codeYear: string;

    // Check content type to handle both JSON and FormData
    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle FormData upload
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      jurisdiction = formData.get('jurisdiction') as string || 'General IBC';
      projectType = formData.get('projectType') as string || 'Commercial';
      codeYear = formData.get('codeYear') as string || '2021';

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided in form data' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      imageBase64 = btoa(binary);
      imageType = file.type || 'image/png';
    } else {
      // Handle JSON payload (backward compatibility)
      const body = await req.json();
      imageBase64 = body.imageBase64;
      imageType = body.imageType || 'image/png';
      jurisdiction = body.jurisdiction || 'General IBC';
      projectType = body.projectType || 'Commercial';
      codeYear = body.codeYear || '2021';

      if (!imageBase64) {
        return new Response(
          JSON.stringify({ error: 'Image data is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const jurisdictionKey = jurisdiction?.toLowerCase().replace(/\s+/g, '-') || 'general';
    const jurisdictionContext = jurisdictionAmendments[jurisdictionKey] || '';
    const jurisdictionCitation = jurisdictionKey === 'dc' ? '12A DCMR' 
      : jurisdictionKey === 'new-york' ? 'NYC BC' 
      : jurisdictionKey === 'california' ? 'CBC' 
      : jurisdictionKey === 'florida' ? 'FBC'
      : jurisdictionKey === 'chicago' ? 'Chicago BC'
      : 'IBC';

    const systemPrompt = `You are an expert building code compliance analyst with deep knowledge of:
- International Building Code (IBC) 2018, 2021, 2024
- International Residential Code (IRC) 2018, 2021, 2024
- NFPA 101 Life Safety Code
- ADA Accessibility Guidelines
- State and local amendments including NYC BC, California CBC, Florida FBC, Chicago BC, and D.C. 12A DCMR

${jurisdictionContext}

Analyze the provided architectural drawing/floor plan for code compliance issues.

For each issue found, provide:
1. Category (Egress, Fire Safety, Accessibility, Structural, MEP, Zoning, Life Safety)
2. Clear title describing the issue
3. Detailed description of the violation
4. Severity level (critical, warning, or advisory)
5. Specific code reference (the adopted code family and section id only when that verified text was retrieved)
6. Location in the drawing (e.g., "Main corridor, north exit")
7. Suggested fix to resolve the issue

Consider the jurisdiction: ${jurisdiction || 'General IBC'} and project type: ${projectType || 'Commercial'}.
Use code year: ${codeYear || '2021'}.
Do not recite model-code section text or numeric thresholds from memory. A section number without retrieved verified text is not compliance and not a confirmed violation.
${jurisdictionContext ? `Local code family: ${jurisdictionCitation}. Apply a local provision only when its verified text was retrieved. Do not invent a local threshold.` : ''}

Be thorough but avoid false positives. Only report genuine code compliance concerns visible in the drawing.

You MUST respond with a valid JSON object in exactly this format:
{
  "issues": [
    {
      "id": "issue-1",
      "category": "Egress|Fire Safety|Accessibility|Structural|MEP|Zoning|Life Safety",
      "title": "Brief issue title",
      "description": "Detailed description of the violation",
      "severity": "critical|warning|advisory",
      "codeReference": "Specific code section reference",
      "codeYear": "2021",
      "location": "Location in the drawing",
      "suggestedFix": "Recommended fix for the issue"
    }
  ],
  "jurisdictionNotes": "Notes about jurisdiction-specific requirements",
  "overallScore": 100
}

Scoring: overallScore is 0-100. If issues is an empty array, overallScore MUST be 100. Do not invent a partial score when there are no findings.`;

    const userPrompt = `Analyze this architectural drawing for building code compliance issues. 
Look for violations related to:
- Egress requirements (corridor widths, exit distances, door swings)
- Fire separation and rated assemblies
- Accessibility (ADA compliance, clearances, ramp slopes)
- Occupancy load calculations
- Stairway and handrail requirements
- Emergency lighting and signage
- Structural concerns visible in the plans

Provide a comprehensive analysis with specific code citations. Return ONLY valid JSON.`;

    console.log('Calling OpenAI GPT-4 Vision for drawing analysis...');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: userPrompt },
            { 
              type: 'image_url', 
              image_url: { 
                url: `data:${imageType};base64,${imageBase64}`,
                detail: 'high'
              } 
            }
          ]
        }
      ],
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    });

    console.log('OpenAI response received');

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      console.error('No content in OpenAI response');
      return new Response(
        JSON.stringify({ error: 'No response from AI model' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let analysisData;
    try {
      analysisData = JSON.parse(content);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', content);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON response from AI model' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Calculate summary
    const issues = analysisData.issues || [];
    const critical = issues.filter((i: ComplianceIssue) => i.severity === 'critical').length;
    const warnings = issues.filter((i: ComplianceIssue) => i.severity === 'warning').length;
    const advisory = issues.filter((i: ComplianceIssue) => i.severity === 'advisory').length;

    const result: AnalysisResult = {
      issues: issues.map((issue: ComplianceIssue, index: number) => ({
        ...issue,
        id: issue.id || `issue-${index + 1}`,
        codeYear: issue.codeYear || codeYear || '2021'
      })),
      summary: {
        totalIssues: issues.length,
        critical,
        warnings,
        advisory,
        overallScore:
          issues.length === 0
            ? 100
            : (typeof analysisData.overallScore === "number"
                ? analysisData.overallScore
                : Math.max(0, 100 - critical * 20 - warnings * 10 - advisory * 3)),
      },
      jurisdictionNotes: analysisData.jurisdictionNotes || ''
    };

    console.log(`Analysis complete: ${result.summary.totalIssues} issues found`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-drawing:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
