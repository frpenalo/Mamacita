// mamacita-number-verify — confirma que el DESVÍO del dueño quedó activo.
// NXTUP lo llama (POST firmado) después de que el dueño configuró el desvío e hizo una llamada
// de prueba a su número. Consultamos en Twilio si llegó una llamada ENTRANTE al número que le
// provisionamos (shop.phone_number). Además chequeamos que el operador pase el número del
// CLIENTE y no lo reemplace por el número público del negocio (el riesgo de caller-ID).
//
// Request: { shop_id }   Response 200:
//   { verified: true,  callerid_ok: boolean, last_from, last_call_at }
//   { verified: false, note }   (aún no se detecta llamada; que haga la prueba)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await authNxtup(req, rawBody, supabase);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { shop } = auth;

  if (shop.number_setup !== "forward") {
    return json({ verified: false, note: "El shop no está en modo desvío (number_setup != 'forward')." });
  }
  if (!shop.phone_number) {
    return json({ verified: false, note: "El shop no tiene número provisionado todavía." });
  }

  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const basic = btoa(`${sid}:${token}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?To=${encodeURIComponent(shop.phone_number)}&PageSize=5`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) {
    console.error("[number-verify] twilio calls failed:", res.status, await res.text());
    return json({ verified: false, note: "No se pudo consultar Twilio." });
  }
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  const inbound = (data.calls || []).find((c: any) => c.direction === "inbound");
  if (!inbound) {
    return json({ verified: false, note: "Aún no detecto una llamada entrante al número. Que el dueño haga una llamada de prueba a su número y reintenta." });
  }

  // Caller-ID: si el 'from' de la llamada de prueba coincide con el número público del negocio,
  // el operador está pisando el número del cliente (malo). Si difiere, pasa bien.
  const calleridOk = shop.public_phone_number
    ? last10(inbound.from) !== last10(shop.public_phone_number)
    : null;

  await supabase.from("shops")
    .update({ forward_verified: true, forward_callerid_ok: calleridOk })
    .eq("id", shop.id);

  return json({
    verified: true,
    callerid_ok: calleridOk,
    last_from: inbound.from,
    last_call_at: inbound.start_time,
  });
});
