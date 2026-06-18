// nxtup-events — receives events from NXTUP (see planning/integration/api-contract.md)
// Initial event: turn_approaching → WhatsApp the customer "ya casi te toca".
// Auth: HMAC-SHA256 with the shop's nxtup_shared_secret over `${timestamp}.${rawBody}`,
// headers x-nxtup-signature + x-nxtup-timestamp. 5-minute replay window.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nxtup-signature, x-nxtup-timestamp",
};

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-nxtup-signature") || "";
    const timestamp = req.headers.get("x-nxtup-timestamp") || "";

    // Replay window: 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (!ts || Math.abs(now - ts) > 300) {
      return new Response(JSON.stringify({ error: "Stale or missing timestamp" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const { event, external_id, shop_id: nxtupShopId } = payload;
    if (!event || !external_id || !nxtupShopId) {
      return new Response(JSON.stringify({ error: "Missing event, external_id or shop_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve the shop by its NXTUP id to get the shared secret
    const { data: shop } = await supabase
      .from("shops")
      .select("id, name, nxtup_shared_secret")
      .eq("nxtup_shop_id", nxtupShopId)
      .maybeSingle();

    if (!shop || !shop.nxtup_shared_secret) {
      return new Response(JSON.stringify({ error: "Unknown shop" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify HMAC (fail-closed)
    const expectedSig = await hmacHex(shop.nxtup_shared_secret, `${timestamp}.${rawBody}`);
    if (!signature || !timingSafeEqual(signature, expectedSig)) {
      console.log(`[nxtup-events] bad signature for shop ${shop.id}`);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Locate our queue entry
    const { data: entry } = await supabase
      .from("queue_entries")
      .select("id, customer_name, customer_phone, status")
      .eq("id", external_id)
      .eq("shop_id", shop.id)
      .maybeSingle();

    if (!entry) {
      return new Response(JSON.stringify({ error: "Queue entry not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event === "turn_approaching") {
      const etaMinutes = payload.eta_minutes ?? 10;
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const functionSecret = Deno.env.get("FUNCTION_SECRET");
        await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-queue-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${functionSecret}`,
          },
          body: JSON.stringify({
            type: "turn_approaching",
            customer_phone: entry.customer_phone,
            customer_name: entry.customer_name,
            shop_name: shop.name,
            eta_minutes: etaMinutes,
          }),
        });
      } catch (waErr) {
        console.error("[nxtup-events] WhatsApp failed:", waErr);
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event === "entry_completed" || event === "entry_no_show") {
      const newStatus = event === "entry_completed" ? "served" : "no_show";
      const update: Record<string, unknown> = { status: newStatus };
      if (newStatus === "served") update.completed_at = new Date().toISOString();
      await supabase.from("queue_entries").update(update).eq("id", entry.id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown event: ${event}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("nxtup-events error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
