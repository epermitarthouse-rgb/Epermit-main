import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ValidateRequest {
  action: "validate";
  system: "accela" | "cityview";
  environment: "sandbox" | "production";
  credentials: {
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    agencyId?: string;
    baseUrl?: string;
  };
}

interface SubmitRequest {
  action: "submit";
  projectId: string;
  system: "accela" | "cityview";
  environment: "sandbox" | "production";
  credentials: {
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    agencyId?: string;
    baseUrl?: string;
  };
  applicationData: {
    permitType: string;
    projectName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    description: string;
    estimatedValue?: number;
    squareFootage?: number;
    applicantName: string;
    applicantEmail: string;
    applicantPhone?: string;
    contractorLicense?: string;
  };
  documents?: { name: string; type: string; url: string }[];
}

type EpermitRequest = ValidateRequest | SubmitRequest;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as EpermitRequest;

    if (!body?.action) {
      return errorResponse("Request body must include an action field", 400);
    }

    if (body.action === "validate") {
      const { system, credentials, environment } = body as ValidateRequest;

      if (!system || !credentials) {
        return errorResponse("validate action requires system and credentials", 400);
      }

      if (environment === "sandbox") {
        return jsonResponse({
          valid: true,
          message: "Sandbox mode - credentials not verified",
        });
      }

      const creds = credentials as Record<string, string | undefined>;
      const hasValidCreds =
        (system === "accela" && creds.clientSecret) ||
        (system === "cityview" && (creds.apiKey || creds.clientSecret));

      if (hasValidCreds) {
        return jsonResponse({
          valid: true,
          message: `${system === "accela" ? "Accela" : "CityView"} credentials validated`,
        });
      }

      return jsonResponse({
        valid: false,
        message: "Invalid credentials - clientSecret or apiKey required",
      });
    }

    if (body.action === "submit") {
      const { system, applicationData, environment } = body as SubmitRequest;

      if (!system || !applicationData) {
        return errorResponse("submit action requires system and applicationData", 400);
      }

      const app = applicationData;
      if (!app.permitType || !app.applicantName || !app.applicantEmail) {
        return errorResponse("applicationData must include permitType, applicantName, and applicantEmail", 400);
      }

      const mockTrackingNumber = `${system.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const mockRecordId = `mock-${Date.now()}`;

      const accelaPayload = {
        type: { module: "Building", type: app.permitType, category: "Application" },
        name: app.projectName,
        description: app.description,
        addresses: [{
          addressLine1: app.address,
          city: app.city,
          state: { value: app.state },
          postalCode: app.zipCode,
          isPrimary: "Y",
        }],
        contacts: [{
          firstName: app.applicantName.split(" ")[0],
          lastName: app.applicantName.split(" ").slice(1).join(" ") || "N/A",
          email: app.applicantEmail,
          phone1: app.applicantPhone || "",
          isPrimary: "Y",
          type: { value: "Applicant" },
        }],
      };

      const cityviewPayload = {
        permitType: app.permitType,
        projectInfo: {
          name: app.projectName,
          description: app.description,
          estimatedValue: app.estimatedValue,
          squareFootage: app.squareFootage,
        },
        location: {
          streetAddress: app.address,
          city: app.city,
          stateProvince: app.state,
          postalCode: app.zipCode,
        },
        applicant: {
          fullName: app.applicantName,
          email: app.applicantEmail,
          phone: app.applicantPhone,
          contractorLicense: app.contractorLicense,
        },
      };

      console.log(
        `Mock submit to ${system} (${environment}):`,
        system === "accela" ? accelaPayload : cityviewPayload
      );

      return jsonResponse({
        success: true,
        system,
        recordId: mockRecordId,
        trackingNumber: mockTrackingNumber,
        status: "submitted",
        submittedAt: new Date().toISOString(),
        message: `Successfully submitted to ${system} (${environment} mode)`,
        estimatedReviewTime: "5-10 business days",
      });
    }

    return errorResponse(`Unknown action: ${(body as { action: string }).action}`, 400);
  } catch (error) {
    console.error("E-permit submit error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(message, 500);
  }
});
