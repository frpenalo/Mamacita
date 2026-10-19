// mamacita-port-request — NXTUP envía la info de PORTE que capturó del dueño.
// La guardamos en number_port_requests (status 'submitted'); OPS somete el porte a mano en
// la consola de Twilio con estos datos. No automatizamos el port-in todavía (bajo volumen).
//
// Request (POST firmado HMAC): {
//   shop_id, phone_number, carrier_name?, carrier_account_number?, carrier_pin?,
//   service_address?, authorized_name?, bill_url?, loa_signer_name?, loa_signed_at?
// }
// Response 200: { status: 'received', port_request_id }
// NO logueamos los campos sensibles (PIN / número de cuenta).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await authNxtup(req, rawBody, supabase);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { shop, payload } = auth;

  const phone = String(payload.phone_number || "").trim();
  if (!phone) return json({ error: "Missing phone_number" }, 400);

  const row = {
    shop_id: shop.id,
    phone_number: phone,
    carrier_name: payload.carrier_name ?? null,
    carrier_account_number: payload.carrier_account_number ?? null,
    carrier_pin: payload.carrier_pin ?? null,
    service_address: payload.service_address ?? null,
    authorized_name: payload.authorized_name ?? null,
    bill_url: payload.bill_url ?? null,
    loa_signer_name: payload.loa_signer_name ?? null,
    loa_signed_at: payload.loa_signed_at ?? null,
    status: "submitted",
  };

  const { data, error } = await supabase
    .from("number_port_requests")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    console.error("[port-request] insert failed:", error.message);
    return json({ error: "Could not save port request" }, 500);
  }

  console.log(`[port-request] shop=${shop.id} phone=${phone} saved (ops to submit manually)`);
  return json({ status: "received", port_request_id: data.id });
});
