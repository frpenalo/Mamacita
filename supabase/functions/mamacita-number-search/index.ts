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

// Overlays conocidos de los metros que servimos: cuando el código exacto se agota (p.ej. 919
// en Raleigh = 0), el overlay comparte EXACTAMENTE la misma geografía (984). Twilio no expone
// esto por API, y el radio genérico (NearNumber) mete códigos vecinos que NO son la misma
// ciudad (910/472/252), así que para estos metros buscamos el overlay DIRECTO. Además el radio
// no sirve si el exacto está en 0 (no hay número real para anclar). Fuera de estos metros se usa
// el radio genérico como respaldo.
const AREA_OVERLAY: Record<string, string[]> = {
  "919": ["984"], "984": ["919"],   // Raleigh / Durham
  "704": ["980"], "980": ["704"],   // Charlotte
  "336": ["743"], "743": ["336"],   // Greensboro / Winston-Salem
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

  if (areaCode && exact.length < MIN_EXACT) {
    // 2) Overlay DIRECTO del mismo metro (984 para 919, etc.). Funciona aunque el exacto esté
    // en 0, porque no depende de anclar en un número real.
    const lists = [exact];
    for (const oc of (AREA_OVERLAY[areaCode] || [])) {
      lists.push(await searchAvailable(oc, sid, token, TARGET));
    }
    let combined = merge(lists);

    // 3) Si todavía faltan y tenemos algún número real, ensanchar por cercanía (radio genérico).
    if (combined.length < MIN_EXACT) {
      const anchor = combined[0];
      if (anchor) {
        combined = merge([combined, await searchNear(anchor, 40, sid, token, TARGET)]);
        if (combined.length < MIN_EXACT) {
          combined = merge([combined, await searchNear(anchor, 100, sid, token, TARGET)]);
        }
      }
    }
    numbers = combined;

    if (numbers.length > exact.length) {
      fallbackNote = exact.length === 0
        ? `No hay números ${areaCode} disponibles; estos son de la misma zona.`
        : `Pocos números ${areaCode} disponibles; completamos con números de la misma zona.`;
    }

    // 4) Último recurso: área sin exactos ni overlay disponible → cualquier US local, avisándolo.
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
