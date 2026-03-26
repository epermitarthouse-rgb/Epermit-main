import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not set");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) throw new Error("Unauthorized");

    const { project_id } = await req.json();
    const { data: project } = await supabase.from("projects").select("*").eq("id", project_id).single();
    if (!project?.permit_number) throw new Error("Permit Number missing on Project");

    const { data: creds } = await supabase.from("portal_credentials").select("*").eq("user_id", user.id);
    const credential = creds?.find(c => c.project_id === project.id) || creds?.find(c => c.permit_number === project.permit_number) || creds?.[0];
    if (!credential) throw new Error("No credentials found");

    const username = credential.portal_username;
    const password = credential.portal_password;
    const loginUrl = credential.login_url || "https://washington-dc-us.avolvecloud.com/User/Index";
    
    // Check for "Deep Run" Capability (Do we have the ProjectID?)
    const projectUrl = project.project_url || "";
    const idMatch = projectUrl.match(/ProjectID=(\d+)/i);
    const internalId = idMatch ? idMatch[1] : null;
    const isDeepRun = !!internalId;

    console.log(`[ROBOT v25] Starting Run. Permit: ${project.permit_number}. Internal ID: ${internalId}`);

    // --- ACTIONS CONFIGURATION ---
    const actions: any[] = [
        { type: "wait", ms: 2000 },
        { type: "type", selector: 'input[name="Email"]', text: username },
        { type: "click", selector: '#next-btn, button:contains("Next")' },
        { type: "wait", ms: 3000 },
        { type: "type", selector: 'input[name="Password"]', text: password },
        { type: "click", selector: '#login-btn, button:contains("Sign In")' },
        { type: "wait", ms: 5000 }
    ];

    let targetUrl = loginUrl;

    if (isDeepRun) {
        // SURGEON MODE: Go directly to the Hidden API Page
        // This page renders the JSON directly in the source code (as you confirmed!)
        targetUrl = `https://washington-dc-us.avolvecloud.com/Admin/Report/ReportList?assignedToProjectOnly=true&projectId=${internalId}&reportTypes=1&reportTypes=10&reportTypes=11`;
        console.log(`[ROBOT] Surgeon Mode Active. Target: ${targetUrl}`);
        
        actions.push(
            { type: "wait", ms: 5000 }, // Wait for that javascript to load
            { type: "scrape", formats: ["html", "rawHtml"] } // Grab the source!
        );
    } else {
        // SCOUT MODE: Find the Project ID
        console.log(`[ROBOT] Scout Mode Active. Searching Dashboard...`);
        actions.push(
             { type: "wait", selector: "#ctl00_MainContent_gvProjects, table", ms: 10000 },
             { type: "scrape", formats: ["markdown", "html"] }
        );
    }

    // --- EXECUTE FIRECRAWL v0 (The Stable Version) ---
    const fcResponse = await fetch("https://api.firecrawl.dev/v0/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${FIRECRAWL_API_KEY}` },
        body: JSON.stringify({
            url: targetUrl,
            actions: actions,
            pageOptions: { waitFor: 5000, includeHtml: true, includeRawHtml: true }
        })
    });
    
    const fcData = await fcResponse.json();
    const markdown = fcData.data?.markdown || "";
    const html = fcData.data?.html || fcData.data?.rawHtml || "";

    // --- PARSING ---
    let portalStatus = "Unknown";
    let newProjectUrl = null;
    let reportData = null;

    if (markdown.includes("block cookies")) {
        console.log("[ROBOT] 🛑 BLOCKED by Microsoft.");
        portalStatus = "Login Blocked";
    } 
    else if (isDeepRun) {
        // --- PARSE THE JSON FROM THE HTML SOURCE ---
        // We look for: .igGrid("option", "dataSource", [ ... ])
        const jsonRegex = /"dataSource",\s*(\[\s*{.*?}\s*\])\s*\)/s;
        const match = html.match(jsonRegex);
        
        if (match && match[1]) {
            try {
                // CLEAN UP: Sometimes the JSON has weird escaping.
                // We parse it into a real object.
                const cleanJson = JSON.parse(match[1]);
                console.log(`[ROBOT] SUCCESS! Extracted ${cleanJson.length} reports.`);
                reportData = cleanJson; 
                portalStatus = "Reports Synced";
            } catch (e) {
                console.error("JSON Parse Failed:", e);
                // Fallback: Save the raw string if parsing fails
                // reportData = match[1]; 
                portalStatus = "Parse Error";
            }
        } else {
            console.log("[ROBOT] Could not find dataSource JSON pattern.");
        }
    } else {
        // --- SCOUT MODE PARSING ---
        const combinedText = (html + " " + markdown).replace(/\s+/g, ' '); 
        const permitIndex = combinedText.indexOf(project.permit_number);

        if (permitIndex !== -1) {
            const chunk = combinedText.substring(permitIndex, permitIndex + 1500);
            
            if (/Status\s*[:\-]?\s*Upload/i.test(chunk) || /Upload/i.test(chunk)) portalStatus = "Upload";
            else if (/Resubmit/i.test(chunk)) portalStatus = "Resubmit";
            else if (/Approved/i.test(chunk)) portalStatus = "Approved";
            else if (/Open/i.test(chunk)) portalStatus = "Open";

            const idMatch = chunk.match(/ProjectID=(\d+)/i) || html.match(/ProjectID=(\d+)/i);
            if (idMatch) {
                newProjectUrl = `https://washington-dc-us.avolvecloud.com/Project/Index?ProjectID=${idMatch[1]}`;
                console.log(`[ROBOT] Discovered ProjectID: ${idMatch[1]}`);
            }
        }
    }

    // --- SAVE ---
    const updatePayload: any = { portal_status: portalStatus, last_checked_at: new Date().toISOString() };
    if (newProjectUrl) updatePayload.project_url = newProjectUrl;
    if (reportData) updatePayload.portal_data = reportData;

    await supabase.from("projects").update(updatePayload).eq("id", project_id);

    if (reportData) {
      const baseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "") + "/functions/v1";
      try {
        await fetch(`${baseUrl}/intake-pipeline-agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader },
          body: JSON.stringify({ project_id }),
        });
      } catch (e) {
        console.warn("[check-portal-status] Intake pipeline trigger failed:", e);
      }
    }

    return new Response(JSON.stringify({ 
        status: "Success", 
        portal_status: portalStatus,
        version: "v25" // I added this so you can verify the new code is running!
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});