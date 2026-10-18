// mamacita-number-search — NXTUP pide números disponibles para que el dueño elija.
// Request (POST firmado, HMAC x-nxtup-signature/x-nxtup-timestamp): { shop_id, area_code }
// Response 200: { numbers: ['+1...', ...], fallback_note? }
// La búsqueda sale de aquí porque la compra ocurre en la cuenta Twilio de Softmedia
// (evita doble credencial y descuadre de inventario). Solo Local Voice+SMS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";
import { searchAvailable } from "../_shared/twilio-numbers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-nxtup-signature, x-nxtup-timestamp",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = await authNxtup(req, rawBody, supabase);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const areaCode = String(auth.payload.area_code || "").replace(/\D/g, "").slice(0, 3) || undefined;
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;

  let numbers = await searchAvailable(areaCode, sid, token);
  let fallbackNote: string | undefined;
  // Sin disponibles en ese área code → buscar sin área code (otros US local) y avisarlo.
  if (numbers.length === 0 && areaCode) {
    numbers = await searchAvailable(undefined, sid, token);
    if (numbers.length > 0) fallbackNote = `No había números disponibles en el área ${areaCode}; estos son otros disponibles.`;
  }

  // deno-lint-ignore no-explicit-any
  const body: any = { numbers };
  if (fallbackNote) body.fallback_note = fallbackNote;
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
