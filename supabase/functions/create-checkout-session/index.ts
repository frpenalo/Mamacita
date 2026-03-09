import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_PRICE_CENTS = 2500; // $25/month

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get barber data including referral_balance
    const { data: barber, error: barberError } = await supabaseClient
      .from("barbers")
      .select("id, name, shop_name, stripe_customer_id, referral_balance")
      .eq("user_id", user.id)
      .single();

    if (barberError || !barber) {
      return new Response(
        JSON.stringify({ error: "Barber profile not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body to get discount amount to apply
    const { success_url, cancel_url, apply_balance } = await req.json();
    
    // Calculate discount from balance (user chooses how much to apply)
    const availableBalance = Number(barber.referral_balance) || 0;
    const discountToApply = Math.min(
      Math.max(0, Number(apply_balance) || 0),
      availableBalance,
      BASE_PRICE_CENTS / 100 // Can't discount more than the price
    );
    const discountCents = Math.round(discountToApply * 100);
    const finalPriceCents = Math.max(0, BASE_PRICE_CENTS - discountCents);

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    // Get or create Stripe customer
    let customerId = barber.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: barber.name,
        metadata: {
          barber_id: barber.id,
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save stripe_customer_id using service role
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      await supabaseAdmin
        .from("barbers")
        .update({ stripe_customer_id: customerId })
        .eq("id", barber.id);
    }

    // Note: We moved req.json() parsing earlier in the code

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            recurring: { interval: "month" },
            unit_amount: finalPriceCents,
            product_data: {
              name: "MamaCita Pro - Suscripción Mensual",
              description: `$25/mes${
                activeReferrals
                  ? ` (-$${((activeReferrals || 0) * 5).toFixed(0)} descuento por ${activeReferrals} referido${activeReferrals > 1 ? "s" : ""})`
                  : ""
              }`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: success_url || "https://tumamacita.com/dashboard?checkout=success",
      cancel_url: cancel_url || "https://tumamacita.com/dashboard?checkout=cancel",
      metadata: {
        barber_id: barber.id,
        active_referrals: String(activeReferrals || 0),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[checkout] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
