// _shared/security.ts — utilidades de seguridad HTTP para las Edge Functions públicas.
//   - secretsMatch: comparación de secretos en TIEMPO CONSTANTE (evita timing attacks)
//   - isRateLimited: rate limit por IP, DB-backed (tabla rate_limit_hits), fail-open

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Comparación en tiempo constante de dos secretos. false si falta alguno (fail-closed). */
export function secretsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** IP del cliente desde los headers del gateway (x-forwarded-for / x-real-ip). */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

// Umbral GENEROSO a propósito: VAPI/Twilio mandan desde IPs compartidas, así que solo debe
// cortar floods egregios, nunca el volumen legítimo del proveedor. La firma/secret sigue siendo
// la barrera principal; esto es una capa barata anti-DoS por delante.
const RL_LIMIT = 600;      // solicitudes...
const RL_WINDOW_SEC = 60;  // ...por ventana, por (bucket, IP)

/**
 * ¿La IP superó el límite para este bucket (nombre de la función)? DB-backed.
 * fail-open: sin IP o si el chequeo falla, NO limita (mejor dejar pasar que romper lo legítimo).
 */
export async function isRateLimited(req: Request, bucket: string): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return false;
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = `${bucket}:${ip}`;
    const since = new Date(Date.now() - RL_WINDOW_SEC * 1000).toISOString();
    const { count } = await supabase
      .from("rate_limit_hits")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("ts", since);
    if ((count ?? 0) >= RL_LIMIT) return true;
    await supabase.from("rate_limit_hits").insert({ key });
    // Purga oportunista: acota el tamaño de la tabla sin un cron aparte.
    if (Math.random() < 0.02) {
      await supabase.from("rate_limit_hits").delete().lt("ts", since);
    }
    return false;
  } catch (e) {
    console.error("[rate-limit] error:", e);
    return false; // fail-open
  }
}
