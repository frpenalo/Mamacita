// Auth compartida para los endpoints que NXTUP llama (onboarding del número).
// Mismo esquema que nxtup-events: HMAC-SHA256 x-nxtup-signature sobre `${ts}.${rawBody}`,
// x-nxtup-timestamp con ventana de 5 min, secret = nxtup_shared_secret del shop.

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verifica la firma y resuelve el shop por su nxtup_shop_id.
// Devuelve { shop, payload } si es válido, o { error, status } si no.
// deno-lint-ignore no-explicit-any
export async function authNxtup(
  req: Request,
  rawBody: string,
  supabase: any,
): Promise<{ shop?: any; payload?: any; error?: string; status?: number }> {
  const signature = req.headers.get("x-nxtup-signature") || "";
  const timestamp = req.headers.get("x-nxtup-timestamp") || "";
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(now - ts) > 300) return { error: "Stale or missing timestamp", status: 401 };

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return { error: "Bad JSON", status: 400 }; }

  const shopId = payload.shop_id ?? payload.nxtup_shop_id;
  if (!shopId) return { error: "Missing shop_id", status: 400 };

  const { data: shop } = await supabase.from("shops").select("*").eq("nxtup_shop_id", shopId).maybeSingle();
  if (!shop || !shop.nxtup_shared_secret) return { error: "Unknown shop", status: 404 };

  const expected = await hmacHex(shop.nxtup_shared_secret, `${timestamp}.${rawBody}`);
  if (!signature || !timingSafeEqual(signature, expected)) return { error: "Invalid signature", status: 401 };

  return { shop, payload };
}
