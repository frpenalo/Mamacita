// vapi-end-of-call — closes out a call:
//   1. Telemetry: writes duration, cost, transcript and final outcome to `calls`
//      (cost data is NON-OPTIONAL — it defines voice-tier pricing, see
//      planning/business/pricing-economics.md)
//   2. Legacy: releases held availability_slots (Fase 2 appointments flow)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, secretsMatch } from "../_shared/security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (await isRateLimited(req, "vapi-end-of-call")) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Accept the secret from either header: VAPI's "Bearer Token" credential
  // sends Authorization: Bearer <token>; a custom-header credential sends
  // x-vapi-secret. Read whichever is present, then strip the Bearer prefix.
  let vapiSecret = req.headers.get("x-vapi-secret") || req.headers.get("authorization");
  const expected = Deno.env.get("VAPI_WEBHOOK_SECRET");
  if (vapiSecret?.startsWith("Bearer ")) {
    vapiSecret = vapiSecret.substring(7);
  }
  if (!secretsMatch(vapiSecret?.trim(), expected?.trim())) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const messageType = body?.message?.type;

    if (messageType !== "end-of-call-report") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callId = body?.message?.call?.id;
    if (!callId) {
      return new Response(JSON.stringify({ error: "Missing call.id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- 1. Telemetry ---
    const msg = body.message;
    const startedAt = msg?.startedAt ? new Date(msg.startedAt) : null;
    const endedAt = msg?.endedAt ? new Date(msg.endedAt) : new Date();
    const durationSeconds =
      startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null;
    const costUsd = typeof msg?.cost === "number" ? msg.cost : null;
    const transcript = typeof msg?.transcript === "string" ? msg.transcript : null;

    // Outcome: keep what join-queue/take-message already set; otherwise classify
    const { data: existingCall } = await supabase
      .from("calls")
      .select("id, outcome")
      .eq("vapi_call_id", callId)
      .maybeSingle();

    const update: Record<string, unknown> = {
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
      cost_usd: costUsd,
      transcript,
    };
    if (existingCall && existingCall.outcome === "unknown") {
      // Call ended without joining queue or leaving a message
      update.outcome = durationSeconds !== null && durationSeconds < 10 ? "hangup" : "info_only";
    }

    if (existingCall) {
      const { error: updErr } = await supabase.from("calls").update(update).eq("id", existingCall.id);
      if (updErr) console.error("[end-of-call] calls update failed:", updErr);
      else console.log(`[end-of-call] telemetry saved for ${callId}: ${durationSeconds}s $${costUsd}`);
    } else {
      console.warn(`[end-of-call] no calls row for ${callId} — assistant-request may have failed`);
    }

    // --- 2. Legacy: release held slots (Fase 2 appointments flow) ---
    const { data, error } = await supabase
      .from("availability_slots")
      .update({
        status: "available",
        hold_expires_at: null,
        held_by_session_id: null,
      })
      .eq("held_by_session_id", callId)
      .eq("status", "held")
      .select();

    if (error) {
      console.error("Error releasing slots:", error);
    }
    console.log(`[end-of-call] Released ${data?.length || 0} held slots for call ${callId}`);

    return new Response(
      JSON.stringify({ ok: true, released_slots: data?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-end-of-call error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
