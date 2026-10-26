// nxtup-customer-sms — SMS de la cola de NXTUP al CLIENTE por el número A2P aprobado de
// Softmedia (el 1-800 de NXTUP fue rechazado; decisión de Francisco 25-oct). NXTUP no tiene
// las llaves de Twilio de Softmedia: manda solo los DATOS y el texto lo redactamos aquí,
// conforme a la campaña registrada (mismo estilo que los SMS de fallback de la cola).
//
// Request (POST firmado, HMAC x-nxtup-signature/x-nxtup-timestamp sobre `${ts}.${rawBody}`):
//   { event: 'customer_sms', kind: 'checkin_confirmed' | 'barber_ready', nxtup_shop_id,
//     to: '+1...', language: 'es' | 'en', idempotency_key,
//     vars: { customer_name, shop_name, position?, wait?, barber_name? } }
// Response 200: { sent: true, sid } | { sent: false, reason }
//
// Sirve a TODOS los shops de NXTUP, no solo a los de Julie: el secret del canal es GLOBAL
// (mismo criterio que nxtup-events), así que si el shop no existe aquí se verifica con el
// de cualquier shop registrado. STOP/HELP los maneja Twilio (Advanced Opt-Out).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacHex, timingSafeEqual } from "../_shared/nxtup-auth.ts";
import { formatPhoneE164, sendSMS } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Sin tildes ni emojis: un solo carácter fuera de GSM-7 parte el SMS en segmentos de 70.
function gsm(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "").trim();
}

// deno-lint-ignore no-explicit-any
function smsBody(kind: string, lang: string, v: any): string | null {
  const isEn = lang === "en";
  const name = gsm(v.customer_name);
  const shop = gsm(v.shop_name) || (isEn ? "the shop" : "la barberia");
  if (kind === "checkin_confirmed") {
    const pos = Number(v.position) > 0 ? ` #${Number(v.position)}` : "";
    const wait = v.wait ? gsm(v.wait) : "";
    return isEn
      ? `Hi ${name}, you're${pos} in line at ${shop}.${wait ? ` Approx. wait ${wait} min.` : ""} We'll text you when your barber is ready. Reply STOP to cancel.`
      : `Hola ${name}, eres el${pos} en la fila de ${shop}.${wait ? ` Espera aprox. ${wait} min.` : ""} Te avisamos cuando tu barbero este listo. Responde STOP para cancelar.`;
  }
  if (kind === "barber_ready") {
    const barber = gsm(v.barber_name);
    return isEn
      ? `${name}, your barber ${barber} is ready at ${shop}. Please come in. Reply STOP to cancel.`
      : `${name}, tu barbero ${barber} esta listo en ${shop}. Pasa adentro. Responde STOP para cancelar.`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const signature = req.headers.get("x-nxtup-signature") || "";
  const timestamp = req.headers.get("x-nxtup-timestamp") || "";
  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return json({ error: "Stale or missing timestamp" }, 401);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "Bad JSON" }, 400); }
  if (!payload.nxtup_shop_id) return json({ error: "Missing nxtup_shop_id" }, 400);

  const { data: shop } = await supabase
    .from("shops").select("nxtup_shared_secret").eq("nxtup_shop_id", payload.nxtup_shop_id).maybeSingle();
  let secret: string | null = shop?.nxtup_shared_secret ?? null;
  if (!secret) {
    const { data: anyShop } = await supabase
      .from("shops").select("nxtup_shared_secret").not("nxtup_shared_secret", "is", null).limit(1).maybeSingle();
    secret = anyShop?.nxtup_shared_secret ?? null;
  }
  if (!secret) return json({ error: "No shared secret configured" }, 500);

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signature || !timingSafeEqual(signature, expected)) return json({ error: "Invalid signature" }, 401);

  const body = smsBody(String(payload.kind), String(payload.language), payload.vars ?? {});
  if (!body) return json({ error: "Unknown kind" }, 400);
  if (!payload.to) return json({ error: "Missing to" }, 400);

  const to = formatPhoneE164(String(payload.to));
  const messageType = `nxtup_${payload.kind}`;

  const sid = await sendSMS(to, body);
  await supabase.from("message_deliveries").insert({
    provider_sid: sid,
    to_phone: to,
    channel: "sms",
    message_type: messageType,
    sms_body: body,
    status: sid ? "sent" : "failed",
  });
  console.log(`[nxtup-sms] ${payload.kind} to ${to} shop=${payload.nxtup_shop_id} key=${payload.idempotency_key} sid=${sid}`);
  return sid ? json({ sent: true, sid }) : json({ sent: false, reason: "send_failed" }, 502);
});
