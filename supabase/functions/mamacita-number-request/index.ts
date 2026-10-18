// mamacita-number-request — NXTUP pide provisionar el número elegido por el dueño.
// Request (POST firmado): { shop_id, choice: 'buy'|'port', requested_number?, current_number?, owner_name }
// Response 200 (buy), uno de:
//   { status: 'completed', number }                         comprado + importado a VAPI + asociado al shop
//   { status: 'failed', fail_reason: 'number_taken', numbers:[alt] }  se vendió en la ventana → alternativas
//   { status: 'failed', fail_reason: 'provisioning_error' }  falló la compra o el import a VAPI
// El PORTE es fase 2 (NXTUP lo tiene deshabilitado); si llega, responde failed port_not_available.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";
import { areaCodeOf, searchAvailable } from "../_shared/twilio-numbers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};

const ASSISTANT_ID = "155157c5-6884-4fb2-a734-de26675ed69e";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
  if (payload.choice !== "buy") return json({ error: "Unknown choice" }, 400);

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
      name: `${shop.name} - MamaCita`,
    }),
  });

  if (!vapiRes.ok) {
    console.error("[number-request] vapi import failed:", vapiRes.status, await vapiRes.text());
    return json({ status: "failed", fail_reason: "provisioning_error" });
  }
  const vapiData = await vapiRes.json();

  // 3. Asociar el número al shop (por donde entra Julie).
  const { error: upErr } = await supabase
    .from("shops")
    .update({ phone_number: number, vapi_phone_number_id: vapiData.id })
    .eq("id", shop.id);
  if (upErr) {
    console.error("[number-request] shop update failed:", upErr);
    return json({ status: "failed", fail_reason: "provisioning_error" });
  }

  return json({ status: "completed", number });
});
