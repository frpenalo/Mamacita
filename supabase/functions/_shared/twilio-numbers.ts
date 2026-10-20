// _shared/twilio-numbers.ts — búsqueda de números disponibles en Twilio.
// Solo US Local (long-code) con capacidad Voice + SMS: el número tiene que servir de
// línea universal (voz vía VAPI + SMS vía A2P). Un toll-free no sirve para esto.

/** Extrae el area code (3 dígitos) de un E.164 US (+1AAABBBCCCC). */
export function areaCodeOf(e164: string): string | undefined {
  const d = String(e164).replace(/\D/g, "");
  const ac = d.length >= 11 ? d.slice(1, 4) : d.slice(0, 3);
  return ac.length === 3 ? ac : undefined;
}

/** Devuelve hasta `limit` números E.164 disponibles. areaCode opcional. Lista vacía si no hay o si falla. */
export async function searchAvailable(
  areaCode: string | undefined,
  sid: string,
  token: string,
  limit = 20,
): Promise<string[]> {
  const auth = btoa(`${sid}:${token}`);
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json`);
  url.searchParams.set("VoiceEnabled", "true");
  url.searchParams.set("SmsEnabled", "true");
  url.searchParams.set("PageSize", String(limit));
  if (areaCode) url.searchParams.set("AreaCode", areaCode);
  const res = await fetch(url.toString(), { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    console.error(`[twilio-numbers] search ${res.status}:`, await res.text());
    return [];
  }
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  return (data.available_phone_numbers || []).map((n: any) => n.phone_number).filter(Boolean);
}

/**
 * Overlay geográfico: números disponibles CERCA de un número (NearNumber + Distance en millas).
 * Sirve para cuando el area code exacto está agotado — Twilio trae los de la misma zona
 * (p.ej. cerca de un 919 de Raleigh devuelve 984, el overlay), genérico y sin mapa hardcodeado.
 */
export async function searchNear(
  nearE164: string,
  distanceMiles: number,
  sid: string,
  token: string,
  limit = 20,
): Promise<string[]> {
  const auth = btoa(`${sid}:${token}`);
  const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json`);
  url.searchParams.set("VoiceEnabled", "true");
  url.searchParams.set("SmsEnabled", "true");
  url.searchParams.set("PageSize", String(limit));
  url.searchParams.set("NearNumber", nearE164);
  url.searchParams.set("Distance", String(distanceMiles));
  const res = await fetch(url.toString(), { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    console.error(`[twilio-numbers] near ${res.status}:`, await res.text());
    return [];
  }
  const data = await res.json();
  // deno-lint-ignore no-explicit-any
  return (data.available_phone_numbers || []).map((n: any) => n.phone_number).filter(Boolean);
}
