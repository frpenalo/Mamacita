// vapi-assistant-request — walk-in queue version
// Called by VAPI when a call comes in. Looks up the shop by the dialed number,
// fetches current availability (NXTUP API if linked, local tables otherwise),
// and hands the assistant everything it needs to answer the caller.
// Spec: planning/product/walk-in-queue-spec.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Availability {
  professionals_available: number;
  professionals_busy: number;
  queue_waiting: number;
  queue_arrived: number;
  estimated_wait_minutes: number | null;
}

async function getNxtupAvailability(shop: any): Promise<Availability | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `${shop.nxtup_api_url}/api/mamacita/availability?shop_id=${encodeURIComponent(shop.nxtup_shop_id)}`,
      {
        headers: { Authorization: `Bearer ${shop.nxtup_shared_secret}` },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[assistant-request] NXTUP availability returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    return {
      professionals_available: data.professionals_available ?? 0,
      professionals_busy: data.professionals_busy ?? 0,
      queue_waiting: data.queue_waiting ?? 0,
      queue_arrived: 0,
      estimated_wait_minutes: data.estimated_wait_minutes ?? null,
    };
  } catch (err) {
    console.error("[assistant-request] NXTUP availability failed:", err);
    return null;
  }
}

async function getLocalAvailability(supabase: any, shopId: string): Promise<Availability | null> {
  const { data, error } = await supabase.rpc("shop_availability", { p_shop_id: shopId });
  if (error || !data || data.length === 0) {
    console.error("[assistant-request] local availability failed:", error);
    return null;
  }
  const row = data[0];
  return {
    professionals_available: row.professionals_available ?? 0,
    professionals_busy: row.professionals_busy ?? 0,
    queue_waiting: row.queue_waiting ?? 0,
    queue_arrived: row.queue_arrived ?? 0,
    estimated_wait_minutes: row.estimated_wait_minutes,
  };
}

// This string is spoken to the caller almost verbatim by the assistant, so it must be
// clean second-person Spanish with NO internal instructions and NO bare digits (the TTS
// reads "1" as "uno" → bad concordance). Behavior rules (when to add to the list, etc.)
// live in the assistant prompt, not here.
function buildAvailabilityMessage(av: Availability | null): string {
  if (!av) {
    return "En este momento no puedo confirmar la disponibilidad.";
  }
  const inQueue = av.queue_waiting + av.queue_arrived;

  // Nadie en turno: no hay barberos trabajando.
  if (av.professionals_available === 0 && av.professionals_busy === 0) {
    return "En este momento no hay barberos en turno.";
  }

  // Hay barberos LIBRES ahora mismo.
  if (av.professionals_available > 0) {
    const n = av.professionals_available;
    const libres = n === 1 ? "un barbero libre" : `${n} barberos libres`;
    return inQueue === 0
      ? `Hay ${libres} ahora mismo, sin fila. Puedes venir directo.`
      : `Hay ${libres} ahora mismo. Puedes venir directo.`;
  }

  // Todos OCUPADOS (hay barberos trabajando, ninguno libre). Siempre invitamos a
  // venir y esperar — es el corazón del walk-in. Nunca prometemos minutos.
  if (inQueue === 0) {
    return "Los barberos están ocupados ahora mismo, pero no hay nadie esperando. Puedes venir y te atienden enseguida.";
  }
  return inQueue === 1
    ? "Los barberos están ocupados ahora mismo y hay una persona esperando. Puedes venir y esperar tu turno."
    : `Los barberos están ocupados ahora mismo y hay ${inQueue} personas esperando. Puedes venir y esperar tu turno.`;
}

Deno.serve(async (req) => {
  console.log("[vapi-assistant-request] Request received:", req.method);

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
  // Fail-closed: reject if secret not configured OR doesn't match
  if (!expected || !vapiSecret || vapiSecret.trim() !== expected.trim()) {
    console.log("[vapi-assistant-request] Auth failed - returning 401");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const messageType = body?.message?.type;

    if (messageType !== "assistant-request") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calledNumber =
      body?.message?.phoneNumber?.number ||
      body?.message?.call?.to ||
      body?.message?.call?.phoneNumber?.number ||
      null;

    if (!calledNumber) {
      console.error("Cannot determine called number. Full body:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "Cannot determine called number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("*")
      .eq("phone_number", calledNumber)
      .maybeSingle();

    if (shopError || !shop) {
      return new Response(JSON.stringify({ error: "Shop not found for number: " + calledNumber }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Availability: NXTUP if linked, local otherwise. NXTUP failure falls back to local.
    let availability: Availability | null = null;
    if (shop.nxtup_shop_id && shop.nxtup_api_url && shop.nxtup_shared_secret) {
      availability = await getNxtupAvailability(shop);
    }
    if (!availability) {
      availability = await getLocalAvailability(supabase, shop.id);
    }

    // Telemetry: register the call (cost/duration/outcome filled in by other functions)
    const vapiCallId = body?.message?.call?.id;
    const callerPhone =
      body?.message?.call?.from || body?.message?.customer?.number || null;
    if (vapiCallId) {
      const { error: callErr } = await supabase.from("calls").insert({
        shop_id: shop.id,
        vapi_call_id: vapiCallId,
        caller_phone: callerPhone,
      });
      if (callErr && callErr.code !== "23505") {
        // 23505 = duplicate (retry of same call) — fine to ignore
        console.error("[assistant-request] calls insert failed:", callErr);
      }
    }

    const variableValues = {
      shop_id: shop.id,
      shop_name: shop.name,
      caller_phone: callerPhone || "", // the number the caller is dialing from — Julie uses this so she never has to ask
      address: shop.address || "",
      services_text: shop.services_text || "",
      hours: shop.hours_text || "",
      professionals_available: availability?.professionals_available ?? 0,
      queue_count: (availability?.queue_waiting ?? 0) + (availability?.queue_arrived ?? 0),
      estimated_wait_minutes: availability?.estimated_wait_minutes ?? "",
      availability_message: buildAvailabilityMessage(availability),
    };

    console.log(`[assistant-request] shop=${shop.name} av=${JSON.stringify(availability)}`);

    // Tell VAPI (per call) to deliver the end-of-call-report to our telemetry endpoint,
    // authenticated with the same secret. This wires up cost/duration/transcript capture
    // (calls table) without touching the assistant config in the VAPI dashboard.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const endOfCallServer = {
      url: `${supabaseUrl}/functions/v1/vapi-end-of-call`,
      secret: Deno.env.get("VAPI_WEBHOOK_SECRET"),
    };

    const response: any = {};
    if (shop.vapi_assistant_id) {
      response.assistantId = shop.vapi_assistant_id;
      response.assistantOverrides = {
        variableValues,
        server: endOfCallServer,
        serverMessages: ["end-of-call-report"],
      };
    } else {
      response.assistant = {
        firstMessage: `Hola, gracias por llamar a ${shop.name}. ¿En qué te puedo ayudar?`,
        variableValues,
        server: endOfCallServer,
        serverMessages: ["end-of-call-report"],
      };
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vapi-assistant-request error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
