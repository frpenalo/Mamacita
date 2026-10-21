// mamacita-number-request — NXTUP pide provisionar el número elegido por el dueño.
// Request (POST firmado): { shop_id, choice: 'buy'|'forward'|'port', requested_number?, current_number?, owner_name }
//   'buy'     = compra un número nuevo que el dueño ANUNCIA (lo da a sus clientes).
//   'forward' = compra un número nuevo (invisible) y el dueño DESVÍA su número de siempre hacia él.
//               `current_number` = el número público del dueño (origen del desvío).
//   'port'    = fase 2 (deshabilitado).
// Response 200, uno de:
//   { status: 'completed', number, setup: 'bought' }                         (buy)
//   { status: 'completed', number, setup: 'forward', forward_to, instructions } (forward: guía de desvío)
//   { status: 'failed', fail_reason: 'number_taken', numbers:[alt] }  se vendió en la ventana → alternativas
//   { status: 'failed', fail_reason: 'provisioning_error' }  falló la compra o el import a VAPI
//   { status: 'failed', fail_reason: 'port_not_available' }  porte = fase 2

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";
import { areaCodeOf, searchAvailable } from "../_shared/twilio-numbers.ts";
import { forwardingInstructions } from "../_shared/forwarding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};

const ASSISTANT_ID = "155157c5-6884-4fb2-a734-de26675ed69e";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Libera un número comprado en Twilio (compensación cuando un paso POSTERIOR falla), para no
// dejar números huérfanos que se cobran sin usarse.
async function releaseTwilioNumber(acctSid: string, basicAuth: string, pnSid: string): Promise<void> {
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acctSid}/IncomingPhoneNumbers/${pnSid}.json`, {
      method: "DELETE", headers: { Authorization: `Basic ${basicAuth}` },
    });
    console.log(`[number-request] released Twilio number ${pnSid} (rollback)`);
  } catch (e) {
    console.error("[number-request] release failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await authNxtup(req, rawBody, supabase);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const { shop, payload } = auth;
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;

  // Porte = fase 2 (NXTUP lo tiene deshabilitado; esto es por si llega).
  if (payload.choice === "port") {
    return json({ status: "failed", fail_reason: "port_not_available" });
  }
  // 'buy' (anuncia el número nuevo) y 'forward' (desvía su número viejo) provisionan igual;
  // solo difieren en metadata + la guía de desvío que devolvemos.
  const isForward = payload.choice === "forward";
  if (payload.choice !== "buy" && !isForward) return json({ error: "Unknown choice" }, 400);

  // Idempotencia: si el shop YA tiene número, no comprar otro (evita doble compra / huérfanos
  // en reintentos). Devuelve el que ya tiene.
  if (shop.phone_number) {
    return json({ status: "completed", number: shop.phone_number, setup: shop.number_setup ?? "bought", already: true });
  }

  const requested = String(payload.requested_number || "").trim();
  if (!requested) return json({ error: "Missing requested_number" }, 400);

  // 1. Comprar el número en Twilio (cuenta de Softmedia).
  const basic = btoa(`${sid}:${token}`);
  const buyRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ PhoneNumber: requested }).toString(),
  });

  if (!buyRes.ok) {
    const errData = await buyRes.json().catch(() => ({}));
    // 21422 = número no disponible (se vendió en la ventana) → alternativas frescas.
    if (buyRes.status === 400 && errData?.code === 21422) {
      const alt = await searchAvailable(areaCodeOf(requested), sid, token);
      return json({ status: "failed", fail_reason: "number_taken", numbers: alt });
    }
    console.error("[number-request] buy failed:", buyRes.status, JSON.stringify(errData));
    return json({ status: "failed", fail_reason: "provisioning_error" });
  }

  const buyData = await buyRes.json();
  const number: string = buyData.phone_number || requested;

  // 2. Importar el número a VAPI (provider twilio) y apuntarlo al assistant de Julie.
  // El `name` de VAPI tiene límite de 40 caracteres: sanitizar (sin emojis/no-ASCII) y recortar,
  // o VAPI responde 400 y el número quedaría huérfano (bug real con nombres largos/con emojis).
  const vapiName = `${shop.name} - MamaCita`.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("VAPI_PRIVATE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "twilio",
      number,
      twilioAccountSid: sid,
      twilioAuthToken: token,
      assistantId: ASSISTANT_ID,
      server: { url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/vapi-assistant-request` },
      name: vapiName,
    }),
  });

  if (!vapiRes.ok) {
    console.error("[number-request] vapi import failed:", vapiRes.status, await vapiRes.text());
    await releaseTwilioNumber(sid, basic, buyData.sid); // rollback: no dejar huérfano
    return json({ status: "failed", fail_reason: "provisioning_error" });
  }
  const vapiData = await vapiRes.json();

  // 3. Asociar el número al shop (por donde entra Julie).
  // deno-lint-ignore no-explicit-any
  const shopUpdate: Record<string, any> = {
    phone_number: number,
    vapi_phone_number_id: vapiData.id,
    number_setup: isForward ? "forward" : "bought",
  };
  if (isForward) {
    // El número público del dueño (origen del desvío). Lo guardamos para mostrarlo y para el
    // chequeo de caller-ID al verificar (que el operador no reemplace el número del cliente).
    const pub = String(payload.current_number || "").trim();
    if (pub) shopUpdate.public_phone_number = pub;
    shopUpdate.forward_verified = false;
  }
  const { error: upErr } = await supabase.from("shops").update(shopUpdate).eq("id", shop.id);
  if (upErr) {
    console.error("[number-request] shop update failed:", upErr);
    await releaseTwilioNumber(sid, basic, buyData.sid); // rollback: no dejar huérfano
    return json({ status: "failed", fail_reason: "provisioning_error" });
  }

  if (isForward) {
    return json({
      status: "completed",
      number,
      setup: "forward",
      forward_to: number,
      instructions: forwardingInstructions(number),
    });
  }
  return json({ status: "completed", number, setup: "bought" });
});
