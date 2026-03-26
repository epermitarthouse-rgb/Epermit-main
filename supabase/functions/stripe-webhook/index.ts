// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// 1. MAPPING: Replace these with your NEW TEST IDS from Stripe Dashboard!
const PRODUCT_TIERS: Record<string, string> = {
  prod_Tt117EaQ2zMjnE: "starter", // 👈 PASTE YOUR STARTER ID HERE
  prod_Tt11mscNlOcrcz: "professional", // 👈 PASTE PROFESSIONAL ID HERE
  prod_Tt11XNeEHlHCaf: "business", // 👈 PASTE BUSINESS ID HERE
  prod_Tt12LVzcadJGLU: "enterprise", // 👈 PASTE ENTERPRISE ID HERE
};

const logStep = (step: string, details?: any) => {
  console.log(`[STRIPE-WEBHOOK] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SIGNING_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing required environment variables.");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) throw new Error("No signature header");

    let event;
    try {
      // ✅ THE FIX IS HERE: Using 'await' and 'constructEventAsync'
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      logStep("Signature verified successfully");
    } catch (err) {
      logStep("Signature failed", err);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    // Handle the event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const email = session.customer_email;

      if (!email) {
        logStep("No email in session, skipping");
        return new Response(JSON.stringify({ received: true }), { headers: corsHeaders });
      }

      logStep(`Processing checkout for ${email}`);

      // 1. Find the User ID
      const {
        data: { users },
        error: userError,
      } = await supabaseAdmin.auth.admin.listUsers();
      const user = users?.find((u) => u.email === email);

      if (!user) {
        logStep("User not found in Auth", { email });
        return new Response("User not found", { status: 404 });
      }

      // 2. Get the Product ID to find the Tier
      const subscriptionId = session.subscription as string;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const productId = subscription.items.data[0].price.product as string;

      const tier = PRODUCT_TIERS[productId] || "starter";

      logStep(`Upgrading user to: ${tier}`);

      // 3. Update the Profile
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({
          subscription_tier: tier,
          subscription_status: "active",
          stripe_customer_id: session.customer,
          subscription_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })
        .eq("user_id", user.id);

      if (updateError) {
        logStep("Database Update Failed", updateError);
        throw updateError;
      }

      logStep("Database Updated Successfully!");
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logStep("Server Error", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
