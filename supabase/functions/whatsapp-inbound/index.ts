// whatsapp-inbound — webhook entrante de Twilio WhatsApp para el AGENTE DE CITAS.
// Producto independiente del walk-in (ver planning/product/whatsapp-citas/prd-full.md).
//
// Flujo:
//   1. Twilio POSTea (form-urlencoded) cada mensaje que llega al número compartido.
//   2. Verificamos X-Twilio-Signature (HMAC-SHA1, fail-closed).
//   3. Ruteo: por el código del link (primera vez) o por la sesión existente (teléfono).
//   4. Guardamos la sesión (amarre cliente->barbero) + el mensaje entrante.
//   5. Disparamos el agente LLM (Bloque 4) en background y respondemos a Twilio de inmediato.
//
// El número es COMPARTIDO con los avisos del walk-in: un mensaje que no matchea ninguna
// cuenta de citas recibe un fallback educado (no rompe nada del walk-in).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatPhoneForWhatsApp, sendWhatsApp } from "../_shared/whatsapp.ts";
import { runAgent } from "../_shared/agent.ts";
import { checkNegotiation, handleNegotiationTurn } from "../_shared/negotiation.ts";
import { findBarberByPhone, handleBarberCommand } from "../_shared/barber.ts";
import type { Barber } from "../_shared/appointments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-twilio-signature",
};

// Alfabeto de wa_code (coincide con generate_wa_code en la migración: sin I,O,0,1).
const WA_CODE_RE = /agendar[-_\s]*([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})/i;

// Campos del barbero que el agente necesita (zona, horario, duración, contacto).
const BARBER_FIELDS = "id, name, timezone, working_days, working_hours_start, working_hours_end, appointment_duration, whatsapp_number, phone_number, services, surcharge_after, surcharge_amount, working_hours";

// ---- Verificación de firma de Twilio (HMAC-SHA1 sobre URL + params ordenados, base64) ----
async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// whatsapp:+1XXXXXXXXXX -> +1XXXXXXXXXX (E.164)
function toE164(waFrom: string): string {
  return waFrom.replace(/^whatsapp:/, "").trim();
}

// Respuesta 200 con TwiML vacío: Twilio no auto-responde; nosotros enviamos vía API REST.
function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const form = new URLSearchParams(rawBody);
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = v;

    // --- Verificar X-Twilio-Signature (fail-closed) ---
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const signature = req.headers.get("x-twilio-signature") || "";
    const url = Deno.env.get("TWILIO_WEBHOOK_URL") || req.url; // env override por el proxy de Supabase
    if (!authToken) {
      console.error("[wa-inbound] missing TWILIO_AUTH_TOKEN");
      return new Response("Server not configured", { status: 500, headers: corsHeaders });
    }
    const expected = await twilioSignature(authToken, url, params);
    if (!signature || !timingSafeEqual(signature, expected)) {
      console.log("[wa-inbound] bad Twilio signature");
      return new Response("Invalid signature", { status: 403, headers: corsHeaders });
    }

    const fromPhone = toE164(params["From"] || "");
    const profileName = params["ProfileName"] || null;
    const body = (params["Body"] || "").trim();
    const messageSid = params["MessageSid"] || null;
    if (!fromPhone) return emptyTwiml();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- ¿Es un BARBERO gestionando sus citas? (Aceptar / Modificar / Cancelar) ---
    const barberSender = await findBarberByPhone(supabase, fromPhone);

    // --- ¿Hay una negociación de cambio de cita activa en el turno del remitente? ---
    // Chequeo RÁPIDO (sin LLM); si hay, se maneja en background y no sigue el flujo normal.
    const negoCtx = await checkNegotiation(supabase, fromPhone, barberSender);
    if (negoCtx) {
      const work = handleNegotiationTurn(supabase, negoCtx, body);
      // @ts-ignore EdgeRuntime existe en Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        await work;
      }
      return emptyTwiml();
    }

    if (barberSender) {
      const work = handleBarberCommand(supabase, barberSender, body);
      // @ts-ignore EdgeRuntime existe en Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        await work;
      }
      return emptyTwiml();
    }

    // --- Ruteo: por código del link, si viene; si no, por sesión existente ---
    let barber: Barber | null = null;

    const codeMatch = body.match(WA_CODE_RE);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      const { data } = await supabase.from("barbers").select(BARBER_FIELDS).eq("wa_code", code).maybeSingle();
      if (data) barber = data as Barber;
    }

    if (!barber) {
      const { data: session } = await supabase
        .from("wa_sessions")
        .select(`barber_id, barbers(${BARBER_FIELDS})`)
        .eq("client_phone", fromPhone)
        .order("last_inbound_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const b = (session as any)?.barbers;
      if (b) barber = b as Barber;
    }

    // --- Sin barbero de citas: distinguir contexto (walk-in vs. desconocido) ---
    if (!barber) {
      // ¿Es un cliente del WALK-IN respondiendo a un aviso de la voz? (número compartido)
      const { data: queue } = await supabase.rpc("find_active_queue_entry_by_phone", { p_phone: fromPhone });
      const q = queue && queue.length ? queue[0] : null;
      if (q) {
        await sendWhatsApp(
          formatPhoneForWhatsApp(fromPhone),
          `¡Hola! 👋 Ya estás anotado en ${q.shop_name} 📋. Cuando llegues, regístrate en la tablet de la entrada. Si necesitas algo más, llámanos. ¡Te esperamos! 💈`,
        );
        return emptyTwiml();
      }
      // Ni citas ni walk-in: fallback neutral.
      await sendWhatsApp(
        formatPhoneForWhatsApp(fromPhone),
        "¡Hola! 👋 Para agendar una cita, escríbenos usando el enlace que te compartió tu barbero. ¡Gracias!",
      );
      return emptyTwiml();
    }

    // --- Amarre: upsert de la sesión (cliente <-> barbero) ---
    const { data: session } = await supabase
      .from("wa_sessions")
      .upsert(
        {
          barber_id: barber.id,
          client_phone: fromPhone,
          client_name: profileName,
          last_inbound_at: new Date().toISOString(),
        },
        { onConflict: "barber_id,client_phone" },
      )
      .select("id")
      .single();

    // Si entró por el LINK (código de activación), reinicia el contexto de la conversación
    // (borra el historial viejo) para que cada "agendar-XXXXXX" arranque limpio.
    if (session && codeMatch) {
      await supabase.from("wa_messages").delete().eq("session_id", session.id);
    }

    // --- Log del mensaje entrante ---
    if (session) {
      await supabase.from("wa_messages").insert({
        session_id: session.id,
        barber_id: barber.id,
        direction: "inbound",
        body,
        wa_message_sid: messageSid,
      });

      // --- Disparar el agente (Bloque 4) en background; responder a Twilio de inmediato ---
      const work = runAgent(supabase, {
        barber,
        sessionId: session.id,
        clientPhone: fromPhone,
        clientName: profileName,
      });
      // @ts-ignore EdgeRuntime existe en Supabase Edge Functions
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(work);
      } else {
        await work;
      }
    }

    return emptyTwiml();
  } catch (err) {
    console.error("[wa-inbound] error:", err);
    // 200 igual, para que Twilio no reintente en loop por un error nuestro.
    return emptyTwiml();
  }
});
