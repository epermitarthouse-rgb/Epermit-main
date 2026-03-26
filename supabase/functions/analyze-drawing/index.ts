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
  'dc': `
WASHINGTON D.C. BUILDING CODE AMENDMENTS (12A DCMR):
The District of Columbia adopts the IBC with the following key amendments:

EGRESS & EXITS:
- 12A DCMR 1004.5: Occupant load calculations for assembly spaces require additional 15% capacity factor
- 12A DCMR 1006.3: Exit access travel distance reduced to 200 ft (unsprinklered) and 250 ft (sprinklered) for B occupancy
- 12A DCMR 1017.2: Corridor width minimum 48" for all occupancies (stricter than IBC 44")

FIRE SAFETY:
- 12A DCMR 903.2.1: Automatic sprinkler systems required in all new buildings over 5,000 sq ft
- 12A DCMR 903.2.9: Group R-2 occupancies require NFPA 13R systems minimum (no 13D allowed in D.C.)
- 12A DCMR 907.2: Fire alarm systems required in buildings over 3 stories (not 4 as in IBC)

ACCESSIBILITY (D.C. Human Rights Act compliance):
- 12A DCMR 1103.2.2: 10% of dwelling units in multi-family must be Type A units (IBC requires 2%)
- 12A DCMR 1107.6: All primary entrances must be accessible (no exemptions for grade changes)
- 12A DCMR 1109.2: D.C. requires grab bars at all water closets in public restrooms

STRUCTURAL:
- 12A DCMR 1604.5: Snow load minimum 30 psf (higher than standard IBC for region)
- 12A DCMR 1609.3: Wind design per ASCE 7 with 115 mph basic wind speed minimum

HISTORIC PRESERVATION (unique to D.C.):
- 12A DCMR 3412: Historic buildings within Historic Districts require HPRB approval
- Work in L'Enfant Plan zones requires additional Historic Preservation Review Board compliance

ENERGY:
- D.C. Green Building Act: Buildings over 10,000 sq ft must meet LEED certification or equivalent
- 12A DCMR C402: Envelope requirements 10% more stringent than IECC
`,

  'new-york': `
NEW YORK CITY BUILDING CODE (NYC BC):
NYC has its own building code separate from IBC with significant differences:

EGRESS & EXITS:
- NYC BC 1003.2: Minimum corridor width 44" but 60" in Group I-2 (hospitals)
- NYC BC 1005.1: Egress capacity factors differ - 0.2" per occupant for stairs (IBC is 0.3")
- NYC BC 1009.3: Stair width minimum 44" (IBC allows 36" in some cases)
- NYC BC 1020.1: Exit access travel distance 200 ft max (sprinklered), 150 ft (unsprinklered)

FIRE SAFETY:
- NYC BC 903.2: Sprinklers required in ALL new buildings regardless of size (stricter than IBC)
- NYC BC 907.2.1: Fire alarm required in buildings over 75 ft in height
- NYC BC 3002.4: Standpipe systems required in buildings over 4 stories
- Local Law 5/73: Retroactive fire safety requirements for existing high-rise buildings

ACCESSIBILITY:
- NYC BC 1107: 5% of dwelling units must be Type A accessible (stricter than IBC 2%)
- NYC BC 1109.2.1: At least one accessible entrance per 200 ft of street frontage
- Local Law 58: Enhanced accessibility for places of public accommodation

STRUCTURAL:
- NYC BC 1604.3: Special wind provisions for buildings over 100 ft
- NYC BC Appendix K: Special seismic provisions for NYC (different from national standards)
- 1 inch per hour rain load requirement (stricter than most jurisdictions)

HIGH-RISE REQUIREMENTS (Buildings over 75 ft):
- NYC BC 403: Additional requirements for high-rise construction
- Emergency voice/alarm communication system required
- Stair pressurization or smokeproof enclosures required
- Fire command center required

SPECIAL NYC REQUIREMENTS:
- Multiple Dwelling Law (MDL): Additional requirements for residential buildings
- Zoning Resolution: Floor area ratio, setback, and height restrictions
- Landmarks Preservation: Special requirements in historic districts
`,

  'california': `
CALIFORNIA BUILDING CODE (CBC - Title 24):
California adopts IBC with extensive amendments:

ACCESSIBILITY (Most Restrictive in U.S.):
- CBC 11B-206.2.1: Accessible routes required from ALL parking spaces, not just accessible spaces
- CBC 11B-403.5.1: Corridor width minimum 48" clear (IBC allows 44")
- CBC 11B-404.2.4: Maneuvering clearances at doors more restrictive than ADA
- CBC 11B-603: Toilet room clearances require 60" turning space (stricter than federal ADA)
- CBC 11B-810: Accessible seating dispersal requirements for assembly occupancies

FIRE SAFETY:
- CBC 903.2.3: Sprinklers required in Group R-3 (single-family) over 5,000 sq ft in fire hazard areas
- CBC 707A: Fire-resistive exterior wall requirements in WUI (Wildland-Urban Interface) zones
- CBC Chapter 7A: Materials and construction methods for WUI fire zones
- CBC 903.2.8.4: Basements over 1,500 sq ft require sprinklers

SEISMIC (VERY CRITICAL):
- CBC 1613: California-specific seismic design requirements beyond IBC
- CBC 1616: Site-specific ground motion procedures required for many buildings
- Hospital (OSHPD) buildings have additional seismic requirements
- Essential facilities (hospitals, schools) have enhanced seismic performance requirements

ENERGY (Title 24 Part 6):
- CBC requires compliance with California Energy Code (most stringent in U.S.)
- Solar-ready requirements for new construction
- Cool roof requirements in climate zones 10-15
- Electric vehicle charging infrastructure requirements

GREEN BUILDING (CALGreen - Title 24 Part 11):
- Mandatory green building standards for all new construction
- Water efficiency requirements (20% reduction from baseline)
- Construction waste diversion (65% minimum)
- Low-emitting materials requirements

STRUCTURAL:
- CBC 1604.9: Special load combinations for California
- CBC 1613.1: Seismic Design Category based on California site class
- Reinforced masonry requirements stricter than national standards
`,

  'florida': `
FLORIDA BUILDING CODE (FBC):
Florida adopts IBC with hurricane and high-velocity wind zone amendments:

WIND DESIGN (CRITICAL):
- FBC 1609: High-Velocity Hurricane Zone (HVHZ) requirements for Miami-Dade and Broward
- Wind speeds up to 180 mph in HVHZ areas
- FBC 1609.1.2: Wind-borne debris protection required in wind-borne debris regions
- Impact-resistant glazing or shutters required in coastal high-hazard areas

FLOOD REQUIREMENTS:
- FBC 3109: Coastal construction requirements
- Buildings in V-zones must be elevated above base flood elevation
- Breakaway walls required below design flood elevation
- FBC 1612: Flood-resistant construction for coastal A-zones

ROOFING:
- FBC 1507.2.8: Enhanced roof underlayment requirements for high-wind zones
- FBC 1518: Roof deck attachment requirements in HVHZ
- Secondary water resistance required in high-wind areas

POOL SAFETY (Florida-specific):
- FBC 454: Residential swimming pool safety requirements
- 4-foot minimum barrier height with self-latching gates
- Pool alarms or safety covers required

ACCESSIBILITY:
- Florida Accessibility Code: Some provisions stricter than ADA
- FBC 11-4.1.3: Accessible parking space requirements
`,

  'texas': `
TEXAS BUILDING CODE:
Texas allows local jurisdictions to adopt IBC with amendments. Major cities have specific requirements:

WIND DESIGN:
- Texas Windstorm Insurance Association (TWIA) requirements for coastal counties
- Buildings in designated catastrophe areas must meet enhanced wind standards
- WPI-8 inspection requirements for coastal construction

ENERGY:
- Texas uses International Energy Conservation Code (IECC) with amendments
- Some jurisdictions require ENERGY STAR compliance

FIRE SAFETY:
- Texas adopts NFPA standards for fire protection
- Local fire marshal approval required for sprinkler systems

ACCESSIBILITY:
- Texas Accessibility Standards (TAS) - generally follows ADA but some local variations
- Texas Department of Licensing and Regulation (TDLR) registration required

LOCAL VARIATIONS:
- Houston: No zoning, but building code fully adopted
- Austin: Stricter green building requirements
- Dallas: Enhanced high-rise fire safety requirements
`,

  'chicago': `
CHICAGO BUILDING CODE (CBC):
Chicago has its own comprehensive building code separate from IBC:

EGRESS:
- Chicago BC 13-160: Corridor widths minimum 44", 66" for schools
- Chicago BC 13-160-140: Exit stair requirements differ from IBC
- Chicago BC 13-96: Means of egress calculations specific to Chicago

FIRE SAFETY:
- Chicago BC 15-16: Sprinkler requirements for buildings over 80 ft
- Chicago BC 15-8: Standpipe requirements
- High-Rise Fire Safety Ordinance: Additional requirements for buildings over 80 ft
- Chicago Fire Prevention Code: Separate from building code

STRUCTURAL:
- Chicago BC 13-132: Wind load requirements specific to Chicago
- Chicago BC 13-136: Seismic design (Chicago is in a moderate seismic zone)
- Chicago BC 13-128: Foundation requirements for Chicago soil conditions

ACCESSIBILITY:
- Illinois Accessibility Code (IAC) applies
- Chicago Commission on Human Relations enforces accessibility

ELEVATOR REQUIREMENTS:
- Chicago BC 18-30: Elevator requirements specific to Chicago
- Freight elevator requirements in commercial buildings

HISTORIC PRESERVATION:
- Landmarks Commission approval required for designated buildings
- Special provisions for buildings in historic districts
`
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
5. Specific code reference (e.g., "${jurisdictionCitation} Section 1005.1")
6. Location in the drawing (e.g., "Main corridor, north exit")
7. Suggested fix to resolve the issue

Consider the jurisdiction: ${jurisdiction || 'General IBC'} and project type: ${projectType || 'Commercial'}.
Use code year: ${codeYear || '2021'}.
${jurisdictionContext ? `IMPORTANT: Apply ${jurisdictionCitation} amendments which may be MORE RESTRICTIVE than base IBC. Always cite ${jurisdictionCitation} sections when jurisdiction-specific requirements apply.` : ''}

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
  "overallScore": 85
}`;

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
        overallScore: analysisData.overallScore || Math.max(0, 100 - (critical * 20) - (warnings * 10) - (advisory * 3))
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
