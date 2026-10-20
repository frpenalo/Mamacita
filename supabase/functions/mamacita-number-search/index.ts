// mamacita-number-search — NXTUP pide números disponibles para que el dueño elija.
// Request (POST firmado, HMAC x-nxtup-signature/x-nxtup-timestamp): { shop_id, area_code }
// Response 200: { numbers: ['+1...', ...], fallback_note? }
// La búsqueda sale de aquí porque la compra ocurre en la cuenta Twilio de Softmedia
// (evita doble credencial y descuadre de inventario). Solo Local Voice+SMS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authNxtup } from "../_shared/nxtup-auth.ts";
import { searchAvailable, searchNear } from "../_shared/twilio-numbers.ts";

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

  const TARGET = 20;
  const MIN_EXACT = 10; // si hay menos que esto del código exacto, completamos con el overlay

  // 1) Código exacto (como antes).
  const exact = await searchAvailable(areaCode, sid, token, TARGET);

  // deno-lint-ignore no-explicit-any
  const merge = (lists: string[][]) => {
    const seen = new Set<string>(), out: string[] = [];
    for (const list of lists) for (const n of list) {
      if (!seen.has(n)) { seen.add(n); out.push(n); }
      if (out.length >= TARGET) return out;
    }
    return out;
  };

  let numbers = exact;
  let fallbackNote: string | undefined;

  // 2) Si el código exacto está agotado o casi, completar con el OVERLAY geográfico de la
  // misma zona. Se ancla en un número REAL del área (uno de los exactos), NO en un 555, que
  // Twilio no geolocaliza. NearNumber a 40 millas; si aún falta, ensanchar a 100. Genérico.
  if (areaCode && exact.length < MIN_EXACT) {
    const anchor = exact[0];
    if (anchor) {
      let overlay = await searchNear(anchor, 40, sid, token, TARGET);
      if (merge([exact, overlay]).length < MIN_EXACT) {
        overlay = merge([overlay, await searchNear(anchor, 100, sid, token, TARGET)]);
      }
      numbers = merge([exact, overlay]);
      if (numbers.length > exact.length) {
        fallbackNote = exact.length === 0
          ? `No hay números ${areaCode} disponibles; estos son de la misma zona.`
          : `Pocos números ${areaCode} disponibles; completamos con números de la misma zona.`;
      }
    }
    // 3) Último recurso: área sin exactos (no hay ancla) → cualquier US local, avisándolo.
    if (numbers.length === 0) {
      numbers = await searchAvailable(undefined, sid, token, TARGET);
      if (numbers.length > 0) fallbackNote = `No hay números ${areaCode} ni cercanos disponibles; estos son otros disponibles.`;
    }
  }

  // deno-lint-ignore no-explicit-any
  const body: any = { numbers };
  if (fallbackNote) body.fallback_note = fallbackNote;
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
