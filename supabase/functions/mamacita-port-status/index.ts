// mamacita-port-status — NXTUP consulta el estado del porte para mostrárselo al dueño.
// Devuelve el porte más reciente del shop. Ops actualiza el status a medida que avanza
// (submitted → scheduled → completed/rejected).
//
// Request (POST firmado HMAC): { shop_id }
// Response 200: { status, phone_number, foc_date, reject_reason } | { status: 'none' }

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
  const { shop } = auth;

  const { data } = await supabase
    .from("number_port_requests")
    .select("status, phone_number, foc_date, reject_reason")
    .eq("shop_id", shop.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return json({ status: "none" });
  return json(data);
});
