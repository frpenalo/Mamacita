// _shared/whatsapp.ts — envío de mensajes por Twilio WhatsApp.
// Freeform: válido dentro de la ventana de 24h (el cliente acaba de escribir, así que
// está abierta). Para mensajes fuera de esa ventana se usan plantillas (Bloques 5/6).

export function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) cleaned = cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
  return `whatsapp:${cleaned}`;
}

export async function sendWhatsApp(to: string, body: string): Promise<string | null> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to.startsWith("whatsapp:") ? to : formatPhoneForWhatsApp(to));
  params.append("Body", body);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) return data.sid ?? null;
  console.error("[whatsapp] send failed:", data);
  return null;
}

// Envío con adjunto (media) — dentro de la ventana de 24h. Ej. el .ics "agregar al calendario".
export async function sendWhatsAppMedia(to: string, mediaUrl: string, body?: string): Promise<string | null> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to.startsWith("whatsapp:") ? to : formatPhoneForWhatsApp(to));
  if (body) params.append("Body", body);
  params.append("MediaUrl", mediaUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) return data.sid ?? null;
  console.error("[whatsapp] media send failed:", data);
  return null;
}

// Envío de una Content Template aprobada por Meta (business-initiated: llega SIEMPRE,
// fuera de la ventana de 24h). Soporta botones. contentVariables = {"1": ..., "2": ...}.
export async function sendTemplate(
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>,
): Promise<string | null> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to.startsWith("whatsapp:") ? to : formatPhoneForWhatsApp(to));
  params.append("ContentSid", contentSid);
  params.append("ContentVariables", JSON.stringify(contentVariables));
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (res.ok) return data.sid ?? null;
  console.error("[whatsapp] template send failed:", data);
  return null;
}

// Mensaje con 1-3 botones de respuesta rápida (plantillas TWILIO_TPL_SLOTS_1..3, cuerpo
// "📅 {{1}} 👇"; sin aprobación de Meta, solo dentro de la ventana de 24h). El id del botón
// vuelve en ButtonPayload al tocarlo. Título ≤20 chars; message en UNA línea.
// Si la plantilla falla, cae a texto con las opciones como lista.
export async function sendButtons(
  to: string,
  message: string,
  buttons: { title: string; id: string }[],
): Promise<string | null> {
  const n = Math.min(buttons.length, 3);
  const sid = Deno.env.get(`TWILIO_TPL_SLOTS_${n}`);
  if (sid && n > 0) {
    const vars: Record<string, string> = { "1": message };
    buttons.slice(0, n).forEach((b, i) => {
      vars[String(2 + i)] = b.title;
      vars[String(2 + n + i)] = b.id;
    });
    const sent = await sendTemplate(to, sid, vars);
    if (sent) return sent;
  }
  return await sendWhatsApp(to, `${message}\n\n${buttons.map((b) => `• ${b.title}`).join("\n")}`);
}
