// _shared/transcribe.ts — transcribe notas de voz de WhatsApp a texto.
//
// Producto agente de citas: el cliente puede mandar un AUDIO en vez de escribir.
// Recibimos la nota de voz, la transcribimos con OpenAI Whisper (misma clave que ya
// usamos para el agente) y seguimos el flujo normal EN TEXTO. Respondemos siempre en
// texto para que los horarios/confirmación/dirección queden claros y guardables.

// Twilio manda el content-type del adjunto; lo mapeamos a una extensión que Whisper acepta.
const AUDIO_EXT: Record<string, string> = {
  "audio/ogg": "ogg", // WhatsApp usa OGG/Opus para notas de voz
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

/** Primer adjunto de AUDIO en los params del webhook de Twilio (o null si no hay). */
export function firstAudioMedia(
  params: Record<string, string>,
): { url: string; contentType: string } | null {
  const n = parseInt(params["NumMedia"] || "0", 10);
  for (let i = 0; i < n; i++) {
    const ct = (params[`MediaContentType${i}`] || "").toLowerCase();
    const url = params[`MediaUrl${i}`];
    if (url && ct.startsWith("audio/")) return { url, contentType: ct };
  }
  return null;
}

/**
 * Descarga el audio de Twilio (Basic auth) y lo transcribe con Whisper.
 * Devuelve el texto, o null si algo falla (el caller decide el fallback).
 */
export async function transcribeAudio(mediaUrl: string, contentType: string): Promise<string | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!openaiKey || !sid || !token) {
    console.error("[transcribe] faltan OPENAI_API_KEY o credenciales de Twilio");
    return null;
  }

  try {
    // 1. Descargar el audio de Twilio. api.twilio.com pide Basic auth y luego redirige al
    //    CDN con una URL firmada; fetch sigue el redirect y descarta el header cross-origin.
    const auth = btoa(`${sid}:${token}`);
    const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!mediaRes.ok) {
      console.error("[transcribe] descarga de media falló:", mediaRes.status);
      return null;
    }
    const audioBuf = await mediaRes.arrayBuffer();
    // Whisper tope 25 MB. Una nota de voz pesa poco; guard por si acaso.
    if (audioBuf.byteLength > 24 * 1024 * 1024) {
      console.error("[transcribe] audio demasiado grande:", audioBuf.byteLength);
      return null;
    }

    const ext = AUDIO_EXT[contentType.split(";")[0].trim()] || "ogg";
    const blob = new Blob([audioBuf], { type: contentType });

    // 2. Transcribir con Whisper. Sin `language` → auto-detecta español o inglés.
    //    El `prompt` sesga hacia el dominio (barbería) para mejor precisión de horas/nombres.
    const fd = new FormData();
    fd.append("file", blob, `voice.${ext}`);
    fd.append("model", "whisper-1");
    fd.append("prompt", "Nota de voz para agendar una cita en una barbería: nombres, días y horas. Español o inglés.");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: fd,
    });
    if (!res.ok) {
      console.error("[transcribe] Whisper falló:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const text = (data?.text || "").trim();
    return text || null;
  } catch (err) {
    console.error("[transcribe] error:", err);
    return null;
  }
}
