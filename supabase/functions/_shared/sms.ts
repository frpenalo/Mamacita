// _shared/sms.ts — SMS por Twilio. Es el FALLBACK de WhatsApp: solo se usa cuando el
// cliente no tiene WhatsApp y el mensaje no entrega. Sale del MISMO número long-code
// que WhatsApp (+1984...), registrado en A2P 10DLC bajo Softmedia, con las mismas
// credenciales. El `From` va en TWILIO_SMS_FROM (el número en E.164, sin prefijo).

export function formatPhoneE164(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) {
    cleaned = cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
  } else if (!cleaned.startsWith("+1") && cleaned.length <= 11) {
    cleaned = `+1${cleaned.slice(1)}`;
  }
  return cleaned;
}

export async function sendSMS(to: string, body: string): Promise<string | null> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_SMS_FROM")!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", formatPhoneE164(to));
  params.append("Body", body);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) return data.sid ?? null;
  console.error("[sms] send failed:", data);
  return null;
}
