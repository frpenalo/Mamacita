// vapi-join-queue — VAPI tool handler: caller confirmed they're coming.
// Captures name + phone, creates the queue entry (local always, NXTUP if linked),
// fires the WhatsApp confirmation, returns the check-in code to the assistant.
// Spec: planning/product/walk-in-queue-spec.md · API: planning/integration/api-contract.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, secretsMatch } from "../_shared/security.ts";
import { isShopOpen } from "../_shared/shop-hours.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret",
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

async function pushToNxtup(shop: any, entry: any): Promise<void> {
  const body = JSON.stringify({
    external_id: entry.id,
    shop_id: shop.nxtup_shop_id,
    customer_name: entry.customer_name,
    customer_phone: entry.customer_phone,
    source: "voice",
    check_in_code: entry.check_in_code,
    eta_at: entry.eta_at,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(shop.nxtup_shared_secret, `${timestamp}.${body}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const res = await fetch(`${shop.nxtup_api_url}/api/mamacita/queue-entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${shop.nxtup_shared_secret}`,
      "x-mamacita-signature": signature,
      "x-mamacita-timestamp": timestamp,
    },
    body,
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`NXTUP queue-entries returned ${res.status}`);
  }
  console.log("[join-queue] pushed to NXTUP OK");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (await isRateLimited(req, "vapi-join-queue")) {
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

    let args = body?.message?.toolCallList?.[0]?.function?.arguments || body;
    if (typeof args === "string") {
      args = JSON.parse(args);
    }
    console.log("[join-queue] args:", JSON.stringify(args));

    const { shop_id, customer_name, customer_phone } = args;
    // Language the call happened in (es/en), so the WhatsApp to the CLIENT matches
    // what they spoke with Julie. Julie passes it in the tool call. Default Spanish.
    const language = args.language === "en" ? "en" : "es";
    if (!shop_id || !customer_name || !customer_phone) {
      throw new Error("Missing required fields: shop_id, customer_name, customer_phone");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: shop, error: shopErr } = await supabase
      .from("shops")
      .select("*")
      .eq("id", shop_id)
      .maybeSingle();
    if (shopErr || !shop) throw new Error(`Shop not found: ${shop_id}`);

    // Guard DURO: no anotar si la barbería está CERRADA (respeta el horario aunque un
    // barbero se haya quedado "available" en NXTUP). No se crea entrada; Julie lo relaya.
    if (!isShopOpen(shop.hours, shop.timezone || "America/New_York")) {
      const toolCallId = body?.message?.toolCallList?.[0]?.id;
      return new Response(
        JSON.stringify({
          results: [{ toolCallId, result: "La barbería está cerrada en este momento, no puedo anotarte en la lista. Vuelve dentro del horario, por favor." }],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vapiCallId = body?.message?.call?.id || null;

    // Idempotency: same call already joined → return the existing code
    if (vapiCallId) {
      const { data: existing } = await supabase
        .from("queue_entries")
        .select("check_in_code")
        .eq("vapi_call_id", vapiCallId)
        .maybeSingle();
      if (existing) {
        const toolCallId = body?.message?.toolCallList?.[0]?.id;
        return new Response(
          JSON.stringify({
            results: [{ toolCallId, result: `Ya está en la lista. Código: ${existing.check_in_code}` }],
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Dedup por teléfono: un mismo teléfono = un mismo cliente. Si ya tiene
    // una entrada ACTIVA en la cola de este shop, no lo anotamos de nuevo
    // (evita "Francisco #1" + "Francisco #2" si la misma persona llama dos
    // veces). En producción cada cliente llama desde su propio número.
    //
    // VENTANA de 12h: solo cuentan entradas activas RECIENTES. Las viejas (de
    // días anteriores) ya fueron atendidas o limpiadas por el reset nocturno de
    // NXTUP, pero Mamacita no se entera y su entrada queda 'waiting' para
    // siempre. Sin la ventana, esa entrada fantasma bloquearía al cliente para
    // siempre (Julie diría "ya estás en la lista" pero NXTUP ya no lo tiene).
    const recentCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: alreadyInQueue } = await supabase
      .from("queue_entries")
      .select("check_in_code")
      .eq("shop_id", shop_id)
      .eq("customer_phone", customer_phone)
      .in("status", ["waiting", "arrived", "in_service"])
      .gte("created_at", recentCutoff)
      .limit(1);
    if (alreadyInQueue && alreadyInQueue.length > 0) {
      const toolCallId = body?.message?.toolCallList?.[0]?.id;
      return new Response(
        JSON.stringify({
          results: [{
            toolCallId,
            result: "El cliente ya está en la lista de espera. Confírmale que ya quedó anotado y dile que al llegar se registre en la tablet. NO lo agregues de nuevo, NO menciones ningún código.",
          }],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Customer: find or create by (shop_id, phone)
    let customerId: string | null = null;
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, total_visits")
      .eq("shop_id", shop_id)
      .eq("phone_number", customer_phone)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      await supabase
        .from("customers")
        .update({ total_visits: (existingCustomer.total_visits || 0) + 1 })
        .eq("id", customerId);
    } else {
      const { data: newCustomer } = await supabase
        .from("customers")
        .insert({
          shop_id,
          barber_id: shop_id, // legacy NOT NULL column; shop_id===old barber_id by backfill design
          name: customer_name,
          phone_number: customer_phone,
          total_visits: 1,
        })
        .select("id")
        .single();
      customerId = newCustomer?.id ?? null;
    }

    // Wait shown to the caller = real in-shop wait (0 if no line). eta_at carries a small
    // floor only for the timestamp (travel time); the spoken message uses the real wait.
    const { data: avData } = await supabase.rpc("shop_availability", { p_shop_id: shop_id });
    const waitMin = avData?.[0]?.estimated_wait_minutes ?? 0;
    const etaAt = new Date(Date.now() + Math.max(waitMin, 10) * 60000).toISOString();

    // Create the queue entry (check_in_code generated by DB trigger)
    const { data: entry, error: entryErr } = await supabase
      .from("queue_entries")
      .insert({
        shop_id,
        customer_id: customerId,
        customer_name,
        customer_phone,
        eta_at: etaAt,
        status: "waiting",
        source: "voice",
        vapi_call_id: vapiCallId,
      })
      .select()
      .single();
    if (entryErr || !entry) throw entryErr;

    console.log(`[join-queue] entry ${entry.id} code=${entry.check_in_code}`);

    // Telemetry: this call converted
    if (vapiCallId) {
      await supabase.from("calls").update({ outcome: "joined_queue" }).eq("vapi_call_id", vapiCallId);
    }

    // Push to NXTUP if linked (non-blocking: local entry is the source of truth for Mamacita)
    if (shop.nxtup_shop_id && shop.nxtup_api_url && shop.nxtup_shared_secret) {
      try {
        await pushToNxtup(shop, entry);
      } catch (nxtupErr) {
        console.error("[join-queue] NXTUP push failed (non-blocking):", nxtupErr);
        await supabase
          .from("queue_entries")
          .update({ notes: "NXTUP sync failed — needs manual review" })
          .eq("id", entry.id);
      }
    }

    // WhatsApp confirmation (non-blocking)
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
          type: "queue_joined",
          customer_phone,
          customer_name,
          shop_name: shop.name,
          address: shop.address || "",
          language,
        }),
      });
      console.log("[join-queue] WhatsApp result:", waRes.status);
    } catch (waErr) {
      console.error("[join-queue] WhatsApp failed (non-blocking):", waErr);
    }

    // Aviso AUTOMÁTICO al DUEÑO (non-blocking): un cliente nuevo entró a la lista.
    // No lo pide el cliente — sale solo en cada anotación, al whatsapp_number del shop.
    if (shop.whatsapp_number) {
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
            type: "new_entry_for_owner",
            owner_phone: shop.whatsapp_number,
            shop_name: shop.name,
            customer_name,
            customer_phone,
          }),
        });
        console.log("[join-queue] owner notified");
      } catch (ownerErr) {
        console.error("[join-queue] owner notify failed (non-blocking):", ownerErr);
      }
    }

    const toolCallId = body?.message?.toolCallList?.[0]?.id;
    return new Response(
      JSON.stringify({
        results: [{
          toolCallId,
          // The check-in code is still stored on the entry for future use (WhatsApp +
          // code-based kiosk check-in). For now we do NOT read it to the caller — check-in
          // is by phone at the kiosk. Tell Julie to just confirm + point to the tablet.
          result: `Cliente agregado a la lista correctamente. Confírmale que ya quedó en la lista y dile que cuando llegue se registre en la tablet de la entrada. NO le des ningún código, NO menciones WhatsApp, mensajes de texto, ni tiempos de espera.`,
        }],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-join-queue error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
