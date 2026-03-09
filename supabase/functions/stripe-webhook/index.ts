import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeKey || !webhookSecret) {
      console.error("[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.text();
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error("[stripe-webhook] Signature verification failed:", err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log(`[stripe-webhook] Event: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const barberId = session.metadata?.barber_id;
        if (barberId && session.subscription) {
          await supabaseAdmin
            .from("barbers")
            .update({
              stripe_subscription_id: String(session.subscription),
              subscription_status: "active",
            })
            .eq("id", barberId);
          console.log(`[stripe-webhook] Barber ${barberId} subscription activated`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: barber } = await supabaseAdmin
          .from("barbers")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (barber) {
          const statusMap: Record<string, string> = {
            active: "active",
            past_due: "past_due",
            canceled: "canceled",
            unpaid: "unpaid",
            trialing: "trialing",
          };
          await supabaseAdmin
            .from("barbers")
            .update({
              subscription_status: statusMap[subscription.status] || subscription.status,
            })
            .eq("id", barber.id);
          console.log(`[stripe-webhook] Barber ${barber.id} status → ${subscription.status}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { data: barber } = await supabaseAdmin
          .from("barbers")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (barber) {
          await supabaseAdmin
            .from("barbers")
            .update({
              subscription_status: "canceled",
              stripe_subscription_id: null,
            })
            .eq("id", barber.id);
          console.log(`[stripe-webhook] Barber ${barber.id} subscription canceled`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: barber } = await supabaseAdmin
          .from("barbers")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (barber) {
          await supabaseAdmin
            .from("barbers")
            .update({ subscription_status: "past_due" })
            .eq("id", barber.id);
          console.log(`[stripe-webhook] Barber ${barber.id} payment failed → past_due`);
        }
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[stripe-webhook] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
