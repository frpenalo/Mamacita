// _shared/i18n.ts — localización de los mensajes AL CLIENTE (español / inglés).
//
// El barbero (p.ej. Jesús) recibe SIEMPRE español. Solo los textos automáticos que le
// llegan al CLIENTE se localizan según el idioma detectado de su conversación, que
// guardamos en wa_sessions.lang. En la conversación viva el LLM ya sigue el idioma del
// cliente (incluido Spanglish); esto cubre los avisos fijos (confirmación, negociación…).

import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";

// deno-lint-ignore no-explicit-any
type Supa = any;
export type Lang = "es" | "en";

const DOW_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Normaliza cualquier valor a 'es' | 'en' (default 'es'). */
export function asLang(v: unknown): Lang {
  return v === "en" ? "en" : "es";
}

/** Fecha de la cita en el idioma del cliente. ES: "sáb 5 jul, 3:00 PM" · EN: "Sat, Jul 5, 3:00 PM". */
export function formatAppt(startUtc: string, tz: string, lang: Lang): string {
  const ds = formatInTimeZone(startUtc, tz, "yyyy-MM-dd");
  const time = formatInTimeZone(startUtc, tz, "h:mm a");
  const parts = ds.split("-").map(Number);
  const mo = parts[1];
  const da = parts[2];
  const dow = new Date(`${ds}T12:00:00Z`).getUTCDay();
  return lang === "en"
    ? `${DOW_EN[dow]}, ${MON_EN[mo - 1]} ${da}, ${time}`
    : `${DOW_ES[dow]} ${da} ${MON_ES[mo - 1]}, ${time}`;
}

const S = (es: string, en: string) => ({ es, en });

// Textos parametrizables al cliente. {var} se reemplaza con las vars que se pasen.
const STR: Record<string, { es: string; en: string }> = {
  ics_caption: S(
    "📅 Agrega tu cita a tu calendario (toca el archivo).",
    "📅 Add your appointment to your calendar (tap the file).",
  ),
  err_retry: S(
    "Disculpa, tuve un pequeño problema. ¿Me repites, por favor?",
    "Sorry, I had a little hiccup. Could you say that again, please?",
  ),
  err_technical: S(
    "Disculpa, estoy teniendo un problema técnico. Intenta de nuevo en un momento. 🙏",
    "Sorry, I'm having a technical issue. Please try again in a moment. 🙏",
  ),
  // --- Negociación de cambio de cita (mensajes al cliente) ---
  nego_slot_taken: S(
    "Uy, ese horario se acaba de ocupar. Tu cita sigue como estaba; escríbenos para reagendar. 🙏",
    "Oops, that time just got taken. Your appointment stays as it was — message us to reschedule. 🙏",
  ),
  nego_moved: S(
    "¡Listo! Tu cita quedó movida al {when}. ¡Te esperamos! 💈",
    "Done! Your appointment was moved to {when}. See you then! 💈",
  ),
  nego_kept: S(
    "Al final tu cita queda como estaba. ¡Te esperamos!",
    "In the end your appointment stays as it was. See you then!",
  ),
  nego_propose: S(
    "Hola{name} 👋 {barber} necesita mover tu cita. ¿Te sirve el {when}? Responde *SÍ*, o dime otra hora que prefieras.",
    "Hi{name} 👋 {barber} needs to move your appointment. Does {when} work? Reply *YES*, or tell me another time you'd prefer.",
  ),
  nego_bail: S(
    "Ok, dejamos tu cita como estaba. ¡Te esperamos!",
    "Okay, we'll leave your appointment as it was. See you then!",
  ),
  nego_max_rounds: S(
    "Mejor coordínalo directo por aquí con el barbero. Tu cita sigue como estaba por ahora.",
    "It's best to sort it out directly here with the barber. Your appointment stays as it was for now.",
  ),
  nego_counter_fail: S(
    'No pude tomar esa hora 😕. Dime el día y la hora que prefieres (ej. "el jueves 4 PM"), o responde *SÍ* si te sirve la que te propuse.',
    'I couldn\'t book that time 😕. Tell me the day and time you\'d prefer (e.g. "Thursday 4 PM"), or reply *YES* if the one I proposed works.',
  ),
  nego_asking_barber: S(
    "Le pregunto al barbero y te confirmo. ⏳",
    "I'll check with the barber and get back to you. ⏳",
  ),
  // --- Barbero gestiona la cita (mensajes al cliente) ---
  client_cancelled: S(
    "Hola 👋 {barber} tuvo un imprevisto y tuvo que cancelar tu cita del {when}. Escríbenos cuando quieras para reagendar. 🙏",
    "Hi 👋 {barber} had something come up and had to cancel your appointment on {when}. Message us anytime to reschedule. 🙏",
  ),
  client_confirmed: S(
    "✅ ¡{barber} confirmó tu cita del {when}!\n📍 Dirección: {address}\n¡Te esperamos! 💈",
    "✅ {barber} confirmed your appointment on {when}!\n📍 Address: {address}\nSee you then! 💈",
  ),
};

/** Texto localizado con reemplazo de {vars}. Default 'es' si falta la clave/idioma. */
export function t(key: string, lang: Lang, vars: Record<string, string> = {}): string {
  const entry = STR[key];
  if (!entry) return key;
  let s = entry[lang] || entry.es;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Idioma guardado del cliente (por barbero+teléfono). Default 'es' si no hay sesión/idioma. */
export async function getClientLang(supabase: Supa, barberId: string, phone: string): Promise<Lang> {
  if (!phone) return "es";
  const { data } = await supabase
    .from("wa_sessions")
    .select("lang")
    .eq("barber_id", barberId)
    .eq("client_phone", phone)
    .maybeSingle();
  return asLang(data?.lang);
}

/** Clasifica el idioma del texto del cliente: "es" | "en". Spanglish → el dominante (default es). */
export async function detectLang(text: string): Promise<Lang> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return "es";
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              'Classify the language the user writes in. Reply with ONLY "es" or "en". If they mix English and Spanish (Spanglish), pick whichever clearly dominates; if it is truly balanced or unclear, reply "es".',
          },
          { role: "user", content: text.slice(0, 500) },
        ],
        temperature: 0,
        max_tokens: 2,
      }),
    });
    if (!res.ok) return "es";
    const data = await res.json();
    const out = (data.choices?.[0]?.message?.content || "").toLowerCase();
    return out.includes("en") ? "en" : "es";
  } catch {
    return "es";
  }
}
