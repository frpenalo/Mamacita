// vapi-take-message — VAPI tool handler: the assistant couldn't resolve the
// caller's request (complaint, question for the owner, anything off-script).
// Captures name + phone + reason and notifies the shop owner by WhatsApp.
// The owner calls back when free — the caller is never transferred.
// Spec: planning/product/walk-in-queue-spec.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept the secret from either header: VAPI's "Bearer Token" credential
  // sends Authorization: Bearer <token>; a custom-header credential sends
  // x-vapi-secret. Read whichever is present, then strip the Bearer prefix.
  let vapiSecret = req.headers.get("x-vapi-secret") || req.headers.get("authorization");
  const expected = Deno.env.get("VAPI_WEBHOOK_SECRET");
  if (vapiSecret?.startsWith("Bearer ")) {
    vapiSecret = vapiSecret.substring(7);
  }
  if (!expected || !vapiSecret || vapiSecret.trim() !== expected.trim()) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();

    let args = body?.message?.toolCallList?.[0]?.function?.arguments || body;
    if (typeof args === "string") {
      args = JSON.parse(args);
    }
    console.log("[take-message] args:", JSON.stringify(args));

    const { shop_id, caller_name, caller_phone, reason } = args;
    if (!shop_id || !caller_phone || !reason) {
      throw new Error("Missing required fields: shop_id, caller_phone, reason");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: shop, error: shopErr } = await supabase
      .from("shops")
      .select("id, name, whatsapp_number, phone_number")
      .eq("id", shop_id)
      .maybeSingle();
    if (shopErr || !shop) throw new Error(`Shop not found: ${shop_id}`);

    // Telemetry
    const vapiCallId = body?.message?.call?.id || null;
    if (vapiCallId) {
      await supabase.from("calls").update({ outcome: "message_taken" }).eq("vapi_call_id", vapiCallId);
    }

    // Notify the owner by WhatsApp (non-blocking)
    const ownerPhone = shop.whatsapp_number;
    let delivered = false;
    if (ownerPhone) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const functionSecret = Deno.env.get("FUNCTION_SECRET");
        const waRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-queue-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${functionSecret}`,
          },
          body: JSON.stringify({
            type: "message_for_owner",
            owner_phone: ownerPhone,
            shop_name: shop.name,
            caller_name: caller_name || "Cliente",
            caller_phone,
            reason,
          }),
        });
        delivered = waRes.ok;
        console.log("[take-message] WhatsApp to owner:", waRes.status);
      } catch (waErr) {
        console.error("[take-message] WhatsApp failed:", waErr);
      }
    } else {
      console.error(`[take-message] shop ${shop_id} has no whatsapp_number configured`);
    }

    const toolCallId = body?.message?.toolCallList?.[0]?.id;
    return new Response(
      JSON.stringify({
        results: [{
          toolCallId,
          result: delivered
            ? "Mensaje tomado y enviado al dueño. Dile al cliente que le devolverán la llamada."
            : "Mensaje registrado. Dile al cliente que le devolverán la llamada.",
        }],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-take-message error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
