// mamacita-port-request — NXTUP crea un request de PORTE con lo NO sensible y recibe un
// ENLACE DE UN SOLO USO para que el dueño meta la data sensible (cuenta/PIN/dirección/
// factura/LOA) por el lado de Mamacita. La data sensible NO pasa por NXTUP (acuerdo 17-oct).
// El porte a Twilio lo hace OPS a mano con la info ya completa.
//
// Request (POST firmado HMAC): { shop_id, phone_number, carrier_name?, authorized_name? }
// Response 200: { status: 'collecting', port_request_id, intake_url }
//   intake_url = enlace seguro que NXTUP le muestra/envía al dueño para completar el porte.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await authNxtup(req, rawBody, supabase);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { shop, payload } = auth;

  const phone = String(payload.phone_number || "").trim();
  if (!phone) return json({ error: "Missing phone_number" }, 400);

  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 días

  // Solo lo NO sensible desde NXTUP. La cuenta/PIN/dirección/factura/LOA entran por el enlace.
  const { data, error } = await supabase
    .from("number_port_requests")
    .insert({
      shop_id: shop.id,
      phone_number: phone,
      carrier_name: payload.carrier_name ?? null,
      authorized_name: payload.authorized_name ?? null,
      status: "collecting",
      port_token: token,
      port_token_expires_at: expires,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[port-request] insert failed:", error.message);
    return json({ error: "Could not create port request" }, 500);
  }

  const intakeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mamacita-port-intake?token=${token}`;
  console.log(`[port-request] shop=${shop.id} phone=${phone} created (collecting)`);
  return json({ status: "collecting", port_request_id: data.id, intake_url: intakeUrl });
});
