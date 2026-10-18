// send-whatsapp-queue-notification — WhatsApp messages for the walk-in queue flow.
// Two message types:
//   queue_joined      → to the customer: you're on the list, address, ETA, check-in code
//   message_for_owner → to the shop owner: a caller left a message (name, phone, reason)
//
// Twilio requires pre-approved Content templates for business-initiated messages.
// Template SIDs come from env vars (see TEMPLATES below). If a SID is missing,
// falls back to a freeform message — that only delivers inside an open 24h session,
// so REGISTER THE TEMPLATES before the pilot (planning/product/walk-in-queue-spec.md).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Template bodies to register in Twilio Console → Content Template Builder:
//
// El CLIENTE recibe en SU idioma (es/en, según habló con Julie — `language` en el payload).
// El DUEÑO siempre en español.
//
// TWILIO_TPL_QUEUE_JOINED (es) — SIN código de check-in ni minutos (decisión de producto):
//   "Hola {{1}} 👋 Ya estás en la lista de {{2}}.
//    📍 {{3}}
//    https://maps.google.com/?q={{4}}
//    Cuando llegues, regístrate en la tablet de la entrada. ¡Te esperamos!"
// TWILIO_TPL_QUEUE_JOINED_EN (en):
//   "Hi {{1}} 👋 You're on the list at {{2}}.
//    📍 {{3}}
//    https://maps.google.com/?q={{4}}
//    When you arrive, check in at the tablet by the entrance. See you soon!"
//
// TWILIO_TPL_TURN_APPROACHING (es) — SIN minutos:
//   "{{1}}, ¡ya casi te toca en {{2}}! ⏰ Ve acercándote para no perder tu turno."
// TWILIO_TPL_TURN_APPROACHING_EN (en):
//   "{{1}}, you're almost up at {{2}}! ⏰ Head over so you don't miss your turn."
//
// TWILIO_TPL_MSG_FOR_OWNER (es) — va al DUEÑO (hispano), siempre español:
//   "📞 Mensaje tomado por Julie en {{1}}:
//    De: {{2}} ({{3}})
//    Asunto: {{4}}
//    Devuélvele la llamada cuando puedas."
//
// TWILIO_TPL_NEW_ENTRY_OWNER (es) — aviso AUTOMÁTICO al dueño en cada anotación:
//   "MamaCita - Nuevo cliente en la lista 📋
//    {{1}} se anotó en {{2}} por teléfono.
//    Teléfono: {{3}}
//    Ya aparece en la pantalla, viene en camino.
//
//    Este mensaje fue generado automáticamente por MamaCita."

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatPhoneE164, sendSMS } from "../_shared/sms.ts";

// SMS de fallback (texto plano, sin emojis ni tildes para no partir el mensaje en varios
// segmentos). Solo se envía si el WhatsApp del cliente no entrega. Incluye el "Responde
// STOP" que exige el A2P; HELP/STOP los maneja Twilio (Advanced Opt-Out).
function smsBodyForCustomer(
  type: string,
  p: { customer_name?: string; shop_name?: string; address?: string; language?: string },
): string | null {
  const name = p.customer_name || "";
  const shop = p.shop_name || (p.language === "en" ? "the shop" : "el shop");
  const isEn = p.language === "en";
  if (type === "queue_joined") {
    const addr = p.address ? (isEn ? ` Address: ${p.address}.` : ` Direccion: ${p.address}.`) : "";
    return isEn
      ? `Hi ${name}, you're on the list at ${shop}.${addr} When you arrive, check in at the tablet by the entrance. Reply STOP to cancel.`
      : `Hola ${name}, ya estas en la lista de ${shop}.${addr} Al llegar, registrate en la tablet de la entrada. Responde STOP para cancelar.`;
  }
  if (type === "turn_approaching") {
    return isEn
      ? `${name}, you're almost up at ${shop}. Head over so you don't miss your turn. Reply STOP to cancel.`
      : `${name}, ya casi te toca en ${shop}. Ve acercandote para no perder tu turno. Responde STOP para cancelar.`;
  }
  return null;
}

// Registra el WhatsApp enviado al cliente (keyed por SID) con el SMS a usar si falla.
// Si el WhatsApp ni siquiera obtuvo SID (fallo síncrono), cae a SMS de una vez (ese
// fallo no genera StatusCallback, así que no habría otra oportunidad).
async function recordOrFallback(
  messageType: string,
  customerPhone: string,
  smsBody: string | null,
  waResult: { success: boolean; sid?: string },
): Promise<void> {
  const toE164 = formatPhoneE164(customerPhone);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  if (waResult.success && waResult.sid) {
    await supabase.from("message_deliveries").insert({
      provider_sid: waResult.sid,
      to_phone: toE164,
      channel: "whatsapp",
      message_type: messageType,
      sms_body: smsBody,
      status: "sent",
    });
    return;
  }
  // Fallo síncrono del WhatsApp → no llegará StatusCallback. SMS inline (best effort).
  if (smsBody) {
    const smsSid = await sendSMS(toE164, smsBody);
    console.log(`[wa-queue] WhatsApp sync-failed, SMS fallback sid=${smsSid} to ${toE164}`);
    await supabase.from("message_deliveries").insert({
      provider_sid: smsSid,
      to_phone: toE164,
      channel: "sms",
      message_type: messageType,
      sms_body: smsBody,
      status: smsSid ? "sent" : "failed",
      fallback_sid: smsSid,
    });
  }
}

// URL donde Twilio reporta el estado de entrega del WhatsApp (dispara el fallback a SMS).
function statusCallbackUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-message-status`;
}

function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) {
    cleaned = cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
  } else if (cleaned.startsWith("+") && !cleaned.startsWith("+1") && cleaned.length <= 11) {
    cleaned = `+1${cleaned.slice(1)}`;
  }
  return `whatsapp:${cleaned}`;
}

async function sendTemplate(
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>,
  statusCallback?: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to);
  params.append("ContentSid", contentSid);
  params.append("ContentVariables", JSON.stringify(contentVariables));
  if (statusCallback) params.append("StatusCallback", statusCallback);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`[wa-queue] template sent to ${to}, SID: ${data.sid}`);
    return { success: true, sid: data.sid };
  }
  console.error(`[wa-queue] template failed to ${to}:`, data);
  return { success: false, error: data.message || "Unknown error" };
}

async function sendFreeform(
  to: string,
  bodyText: string,
  statusCallback?: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to);
  params.append("Body", bodyText);
  if (statusCallback) params.append("StatusCallback", statusCallback);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) return { success: true, sid: data.sid };
  console.error(`[wa-queue] freeform failed to ${to}:`, data);
  return { success: false, error: data.message };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Internal function: requires FUNCTION_SECRET
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("FUNCTION_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();
    const { type } = payload;

    if (type === "queue_joined") {
      const { customer_phone, customer_name, shop_name, address, language } = payload;
      if (!customer_phone) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const to = formatPhoneForWhatsApp(customer_phone);
      const isEn = language === "en";
      const tplSid = isEn
        ? Deno.env.get("TWILIO_TPL_QUEUE_JOINED_EN")
        : Deno.env.get("TWILIO_TPL_QUEUE_JOINED");
      const cb = statusCallbackUrl();
      let result;
      if (tplSid) {
        result = await sendTemplate(to, tplSid, {
          "1": customer_name || "",
          "2": shop_name || "el shop",
          "3": address || "",
          "4": encodeURIComponent(address || ""),
        }, cb);
      } else {
        console.warn("[wa-queue] queue_joined template not set — trying freeform (24h-session only)");
        result = await sendFreeform(
          to,
          isEn
            ? `Hi ${customer_name} 👋 You're on the list at ${shop_name}.\n📍 ${address}\nhttps://maps.google.com/?q=${encodeURIComponent(address || "")}\nWhen you arrive, check in at the tablet by the entrance. See you soon!`
            : `Hola ${customer_name} 👋 Ya estás en la lista de ${shop_name}.\n📍 ${address}\nhttps://maps.google.com/?q=${encodeURIComponent(address || "")}\nCuando llegues, regístrate en la tablet de la entrada. ¡Te esperamos!`,
          cb
        );
      }
      await recordOrFallback("queue_joined", customer_phone, smsBodyForCustomer("queue_joined", { customer_name, shop_name, address, language }), result);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "turn_approaching") {
      const { customer_phone, customer_name, shop_name, language } = payload;
      if (!customer_phone) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const to = formatPhoneForWhatsApp(customer_phone);
      const isEn = language === "en";
      const tplSid = isEn
        ? Deno.env.get("TWILIO_TPL_TURN_APPROACHING_EN")
        : Deno.env.get("TWILIO_TPL_TURN_APPROACHING");
      const cb = statusCallbackUrl();
      let result;
      if (tplSid) {
        result = await sendTemplate(to, tplSid, {
          "1": customer_name || "",
          "2": shop_name || "el shop",
        }, cb);
      } else {
        console.warn("[wa-queue] turn_approaching template not set — trying freeform (24h-session only)");
        result = await sendFreeform(
          to,
          isEn
            ? `${customer_name}, you're almost up at ${shop_name}! ⏰ Head over so you don't miss your turn.`
            : `${customer_name}, ¡ya casi te toca en ${shop_name}! ⏰ Ve acercándote para no perder tu turno.`,
          cb
        );
      }
      await recordOrFallback("turn_approaching", customer_phone, smsBodyForCustomer("turn_approaching", { customer_name, shop_name, language }), result);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "message_for_owner") {
      const { owner_phone, shop_name, caller_name, caller_phone, reason } = payload;
      if (!owner_phone || !reason) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const to = formatPhoneForWhatsApp(owner_phone);
      const tplSid = Deno.env.get("TWILIO_TPL_MSG_FOR_OWNER");
      let result;
      if (tplSid) {
        result = await sendTemplate(to, tplSid, {
          "1": shop_name || "tu negocio",
          "2": caller_name || "Cliente",
          "3": caller_phone || "",
          "4": reason,
        });
      } else {
        console.warn("[wa-queue] TWILIO_TPL_MSG_FOR_OWNER not set — trying freeform (24h-session only)");
        result = await sendFreeform(
          to,
          `📞 Mensaje tomado por Julie en ${shop_name}:\nDe: ${caller_name} (${caller_phone})\nAsunto: ${reason}\nDevuélvele la llamada cuando puedas.`
        );
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "new_entry_for_owner") {
      // Aviso AUTOMÁTICO al dueño cuando un cliente se anota por voz (no lo pide
      // el cliente). Va al whatsapp_number del shop, siempre en español.
      const { owner_phone, shop_name, customer_name, customer_phone } = payload;
      if (!owner_phone) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const to = formatPhoneForWhatsApp(owner_phone);
      const tplSid = Deno.env.get("TWILIO_TPL_NEW_ENTRY_OWNER");
      let result;
      if (tplSid) {
        result = await sendTemplate(to, tplSid, {
          "1": customer_name || "Cliente",
          "2": shop_name || "el shop",
          "3": customer_phone || "",
        });
      } else {
        console.warn("[wa-queue] TWILIO_TPL_NEW_ENTRY_OWNER not set — trying freeform (24h-session only)");
        result = await sendFreeform(
          to,
          `MamaCita - Nuevo cliente en la lista 📋\n${customer_name || "Cliente"} se anotó en ${shop_name} por teléfono.\nTeléfono: ${customer_phone}\nYa aparece en la pantalla, viene en camino.\n\nEste mensaje fue generado automáticamente por MamaCita.`
        );
      }
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown type: ${type}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wa-queue] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
