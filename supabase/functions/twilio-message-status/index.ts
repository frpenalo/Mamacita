// twilio-message-status — recibe el StatusCallback de Twilio sobre la ENTREGA de los
// mensajes de WhatsApp que mandamos al cliente. Si el WhatsApp quedó failed/undelivered
// (típicamente: el cliente no tiene WhatsApp), dispara el SMS de fallback guardado en
// message_deliveries. Nunca duplica: solo manda SMS cuando el WhatsApp NO entregó, y una
// sola vez por mensaje (guardado en fallback_sid).
//
// Seguridad: valida X-Twilio-Signature (HMAC-SHA1 sobre URL + params ordenados, con el
// auth token). Escape hatch: TWILIO_SKIP_SIGNATURE_CHECK="1" la salta (solo para pruebas).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendSMS } from "../_shared/sms.ts";

async function expectedTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  // URL + cada par (ordenado por clave) concatenado como clave+valor, sin separadores.
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const rawBody = await req.text();
  const form = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  // Validar firma de Twilio (fail-closed salvo escape hatch explícito).
  const skipCheck = Deno.env.get("TWILIO_SKIP_SIGNATURE_CHECK") === "1";
  if (!skipCheck) {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-message-status`;
    const received = req.headers.get("x-twilio-signature") || "";
    const expected = await expectedTwilioSignature(authToken, callbackUrl, params);
    if (received !== expected) {
      console.warn(`[msg-status] bad signature received=${received} expected=${expected}`);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const messageSid = params["MessageSid"] || params["SmsSid"] || "";
  const messageStatus = params["MessageStatus"] || params["SmsStatus"] || "";
  console.log(`[msg-status] sid=${messageSid} status=${messageStatus}`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row } = await supabase
    .from("message_deliveries")
    .select("*")
    .eq("provider_sid", messageSid)
    .maybeSingle();

  // Siempre reflejar el último estado (observabilidad), aunque no haya fila (ej. mensajes
  // del dueño, que no registramos).
  if (row) {
    await supabase
      .from("message_deliveries")
      .update({ status: messageStatus, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // Candado contra callbacks desordenados: si la fila YA estaba entregada/leída, un
  // "failed" que llegue tarde no debe disparar SMS (si no, el cliente recibiría los dos
  // canales). row es el estado PREVIO a este callback.
  const alreadyDelivered = row?.status === "delivered" || row?.status === "read";
  const failed = messageStatus === "failed" || messageStatus === "undelivered";
  if (failed && !alreadyDelivered && row && row.channel === "whatsapp" && !row.fallback_sid && row.sms_body) {
    const smsSid = await sendSMS(row.to_phone, row.sms_body);
    console.log(`[msg-status] WhatsApp ${messageStatus} → SMS fallback sid=${smsSid} to ${row.to_phone}`);
    await supabase
      .from("message_deliveries")
      .update({ fallback_sid: smsSid, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  // Twilio reintenta si no recibe 2xx; respondemos 200 siempre.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
