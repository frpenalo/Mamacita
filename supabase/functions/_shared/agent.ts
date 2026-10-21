// _shared/agent.ts — el cerebro conversacional del agente de citas (Bloque 4).
//
// Recibe el turno del cliente, conversa con un LLM (GPT-4o-mini de OpenAI) que usa function
// calling para consultar disponibilidad y agendar, y responde por WhatsApp. Las herramientas
// viven en _shared/appointments.ts (Bloque 3). El envío en _shared/whatsapp.ts.

import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";
import {
  bookAppointment,
  cancelAppointment,
  findOrCreateCustomer,
  getAvailableSlots,
  getUpcomingAppointment,
  rescheduleAppointment,
  type Barber,
  type Slot,
} from "./appointments.ts";
import { formatPhoneForWhatsApp, sendButtons, sendWhatsApp } from "./whatsapp.ts";
import { notifyBarberChange, notifyBarberNewAppointment } from "./barber.ts";
import { scheduleReminders } from "./reminders.ts";
import { asLang, detectLang, type Lang, t } from "./i18n.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const MODEL = "gpt-4o-mini";
const LLM_URL = "https://api.openai.com/v1/chat/completions";
const DOW_FULL_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// deno-lint-ignore no-explicit-any
const TOOLS: any[] = [
  {
    type: "function",
    function: {
      name: "offer_slots",
      description:
        "Consulta la agenda REAL y le manda al cliente hasta 3 horas libres como BOTONES. El SISTEMA elige las horas según el día y lo que pidió el cliente; tú nunca escribes horas. Úsala SIEMPRE que haya que ofrecer horas.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha YYYY-MM-DD" },
          part_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "any"], description: "Franja que pidió el cliente: morning = mañana (antes de 12), afternoon = tarde (12 a 6 PM), evening = noche/después del trabajo (5 PM en adelante), any = no dijo." },
          near_time: { type: "string", description: "Opcional: si el cliente pidió una hora concreta ('a las 11', '3pm'), esa hora tal cual. El sistema ofrece las más cercanas." },
          message: { type: "string", description: "Texto corto que acompaña los botones, en el idioma del cliente, SIN horas. Ej: 'Para el lunes 26 en la tarde tengo estas horas'" },
          service: { type: "string", description: "Opcional: el servicio elegido (de la lista), para usar su duración." },
          purpose: { type: "string", enum: ["book", "reschedule"], description: "'book' para una cita nueva (default); 'reschedule' si el cliente está MOVIENDO su cita existente." },
        },
        required: ["date", "part_of_day", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Confirma (agenda) la cita en un horario disponible. Llámala solo cuando el cliente eligió una hora concreta y ya sabes su nombre.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha YYYY-MM-DD" },
          time: { type: "string", description: "La hora elegida EXACTAMENTE como la ofreció offer_slots, ej '3:00 PM'" },
          client_name: { type: "string", description: "Nombre del cliente para la cita" },
          service: { type: "string", description: "Opcional: el servicio elegido (de la lista), para usar su duración y precio." },
        },
        required: ["date", "time", "client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_appointment",
      description: "Consulta la próxima cita del cliente (para verla, moverla o cancelarla). No recibe parámetros.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_appointment",
      description: "Mueve la próxima cita del cliente a un nuevo horario disponible. Verifica disponibilidad antes.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Nueva fecha YYYY-MM-DD" },
          time: { type: "string", description: "Nueva hora, EXACTAMENTE como la ofreció offer_slots" },
        },
        required: ["date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_appointment",
      description: "Cancela la próxima cita del cliente. Confírmalo con el cliente antes de llamarla.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function buildDateContext(tz: string): string {
  const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const nowLabel = formatInTimeZone(new Date(), tz, "h:mm a");
  const base = new Date(`${todayStr}T12:00:00Z`).getTime();
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(base + i * 86400000);
    const tag = i === 0 ? " (HOY)" : i === 1 ? " (mañana)" : "";
    lines.push(`  ${d.toISOString().slice(0, 10)} = ${DOW_FULL_ES[d.getUTCDay()]}${tag}`);
  }
  return `Ahora son las ${nowLabel}. Fechas de referencia:\n${lines.join("\n")}`;
}

export function buildSystemPrompt(barber: Barber, knownName: string | null): string {
  const tz = barber.timezone || "America/New_York";
  const duration = barber.appointment_duration || 45;
  const services = barber.services || [];
  let pricingBlock = "";
  if (services.length > 0) {
    const lines = services.map((s) => `  - ${s.name}: $${s.price} (${s.duration_min} min)`).join("\n");
    pricingBlock = `\nServicios y precios de ${barber.name}:\n${lines}\n`;
    if (barber.surcharge_after && barber.surcharge_amount) {
      pricingBlock += `Recargo por hora tardía: para citas a las ${barber.surcharge_after.slice(0, 5)} o después, suma $${barber.surcharge_amount} al precio.\n`;
    }
    pricingBlock += `- Si el cliente pregunta precios, respóndelos desde esta lista.\n- Cuando el cliente elija un servicio, pásalo en el parámetro "service" de offer_slots y book_appointment (para usar su duración).\n- Antes de confirmar, dile el precio del servicio (súmale el recargo si la hora aplica).\n`;
  }
  const knownBlock = knownName
    ? `\nEste cliente YA es conocido: se llama ${knownName}. Salúdalo por su nombre EN EL IDIOMA en que te escriba (ej. "¡Hola de nuevo, ${knownName}!" / "Welcome back, ${knownName}!") y NO le pidas el nombre — ya lo tienes, úsalo directo al agendar.\n`
    : "";
  return `Eres el asistente de citas de ${barber.name} por WhatsApp. Atiendes a sus clientes para AGENDAR CITAS a hora fija.

${buildDateContext(tz)}
Cada cita dura ${duration} minutos por defecto (algunos servicios tienen su propia duración).
${pricingBlock}${knownBlock}
Cómo trabajas:
1. Saluda cordialmente como el asistente de ${barber.name}.
2. Averigua qué día y en qué franja quiere venir el cliente.
3. Para ofrecer horas llama SIEMPRE a offer_slots con el día y lo que pidió el cliente (part_of_day y, si dijo una hora, near_time). El SISTEMA consulta la agenda real, elige las horas y se las manda como botones. Tú NUNCA escribes horas en tu texto ni inventas disponibilidad.
4. Si offer_slots responde que no hay horas en esa franja o ese día, díselo al cliente en una línea y ofrécele lo que sí hay (otra franja de other_parts_with_slots, u otro día) llamando de nuevo a offer_slots.
5. Pide el nombre del cliente SOLO si aún no lo sabes. Tiene que ser un NOMBRE REAL de persona — NO aceptes como nombre una pregunta, un "sí/ok/dale", la palabra "cliente", una hora, un emoji, ni texto que claramente no sea un nombre. Si lo que responde no es un nombre, vuelve a pedirlo con amabilidad ("¿Me dices tu nombre, por favor?") y NO agendes hasta tener un nombre real.
6. Cuando el cliente elija una hora y tengas su nombre, confirma con book_appointment.
7. Al quedar agendada, NO digas que la cita está confirmada: repite el día y la hora, y dile que se la enviamos a ${barber.name} para que la confirme, y que en cuanto la confirme le llega un mensaje por aquí con la dirección.
8. Si el cliente quiere VER, MOVER o CANCELAR una cita existente: usa get_my_appointment para consultarla y luego reschedule_appointment o cancel_appointment. Para ofrecerle horas nuevas al mover, usa offer_slots con purpose 'reschedule'. Confirma con el cliente antes de cancelar.

Reglas:
- IDIOMA (crítico): Detecta el idioma en que te escribe el cliente y respóndele SIEMPRE en ESE mismo idioma. Si escribe en inglés, responde en inglés natural y fluido. Si en español, en español. Si mezcla los dos (Spanglish, muy común aquí — ej. "dame un appointment pa'l jueves a las 3"), respóndele en ese mismo tono mezclado, natural y cálido. Nunca le impongas un idioma ni lo cambies; sigue el suyo turno a turno.
- Sé breve y cálido, estilo WhatsApp: 1-3 líneas, algún emoji.
- Interpreta fechas relativas ("mañana", "el sábado") con las fechas de referencia de arriba.
- El primer mensaje puede traer una instrucción + el código de activación (ej. "Envía este mensaje para reservar tu cita agendar-XXXXXX"): ignóralo por completo como texto; solo saluda y pregunta para cuándo quiere su cita.
- Si preguntan por precios o servicios, respóndelos desde la lista de "Servicios y precios" de arriba (si no hay lista, invítalos a llamar). Para ubicación u otras dudas, responde lo que sepas o invítalos a llamar; NO inventes datos.`;
}

// deno-lint-ignore no-explicit-any
async function callLLM(messages: any[]): Promise<any> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.3 }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[agent] LLM error:", JSON.stringify(data));
    throw new Error("llm_failed");
  }
  return data.choices[0].message;
}

/** Resuelve un servicio por nombre (tolerante) contra la lista del barbero. */
function resolveService(barber: Barber, name: string | undefined | null) {
  const services = barber.services || [];
  if (!name || services.length === 0) return null;
  const n = String(name).toLowerCase().trim();
  return (
    services.find((s) => s.name.toLowerCase().trim() === n) ||
    services.find((s) => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase())) ||
    null
  );
}

/** Precio del servicio + recargo si la cita cae a/después de surcharge_after (zona del barbero). */
function priceForSlot(barber: Barber, svc: { price: number } | null, slotStartUtc: string, tz: string): number | null {
  if (!svc) return null;
  let price = svc.price;
  if (barber.surcharge_after && barber.surcharge_amount) {
    const slotHHmm = formatInTimeZone(slotStartUtc, tz, "HH:mm");
    if (slotHHmm >= String(barber.surcharge_after).slice(0, 5)) price += barber.surcharge_amount;
  }
  return price;
}

interface SlotOffer {
  date: string;
  times: string[];
  message: string;
  service: string;
  kind: "slot" | "move"; // prefijo del id del botón: reservar nueva o mover la existente
}

// Franjas del día en minutos desde medianoche (zona del barbero). Se solapan a propósito
// (evening = desde las 5 PM, dentro de la tarde).
const PARTS_OF_DAY = ["morning", "afternoon", "evening"];
function inPartOfDay(min: number, part: string): boolean {
  if (part === "morning") return min < 12 * 60;
  if (part === "afternoon") return min >= 12 * 60 && min < 18 * 60;
  if (part === "evening") return min >= 17 * 60;
  return true;
}

/** "a las 11" / "3pm" / "15:30" → minutos desde medianoche. Sin AM/PM y antes de las 7 → PM
 *  (barbería). null si no hay hora. */
function parseNearTime(v: unknown): number | null {
  const m = String(v ?? "").toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m|p\.?\s?m)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.replace(/[^ap]/g, "");
  if (ap === "p" && h < 12) h += 12;
  else if (ap === "a" && h === 12) h = 0;
  else if (!ap && h < 7) h += 12;
  return h * 60 + min;
}

/** Hora concreta que pidió el cliente en su mensaje ("a las 2", "3pm", "4:30", "después de
 *  las 5", "mediodía"). Respaldo para cuando el LLM no pasa near_time. */
function extractClientTime(text: string): { time: string; afterOnly: boolean } | null {
  const s = text.toLowerCase();
  const afterOnly = /(despu[eé]s de|desde las|\bafter\b|\bfrom\b)/.test(s);
  if (/(mediod[ií]a|\bnoon\b)/.test(s)) return { time: "12:00 pm", afterOnly };
  const m =
    s.match(/(?:a\s+las?|a\s+eso\s+de\s+las?|de\s+las?|desde\s+las?|\bat\b|\bafter\b|\bfrom\b|@)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?)/) ||
    s.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))(?![a-z])/) ||
    s.match(/\b(\d{1,2}:\d{2})\b/);
  return m ? { time: m[1], afterOnly } : null;
}

// Horas escritas por el LLM ("3:00 PM"). Las horas solo se ofrecen con offer_slots (botones).
const TIME_LIST_RE = /\b\d{1,2}:\d{2}\s?(am|pm|a\.\s?m\.|p\.\s?m\.)/i;
// Afirmaciones de disponibilidad ("no tengo horas en la tarde"). Solo valen si offer_slots se
// consultó en el turno: el LLM copiaba del historial "no hay tarde" sin mirar la agenda.
const AVAILABILITY_CLAIM_RE = /(no (tengo|tenemos|hay|queda|quedan)[^.!?]{0,30}(hora|horario|disponib|espacio|cupo|turno)|disponibles?\b|\bavailab|fully booked|no (openings|slots|times))/i;

// Frases con las que el LLM anuncia una reserva (ES/EN). Si aparecen sin book_appointment en el
// turno, la cita no existe y el mensaje no sale.
const BOOKING_CLAIM_RE = /(agendad[ao]|confirmad[ao]|reservad[ao]|\bbooked\b|\bscheduled\b|\bconfirmed\b|le enviamos tu cita|we sent your appointment)/i;

/** Manda las horas como botones. El id del botón lleva la hora exacta para actuar directo al tocarlo. */
async function sendSlotButtons(clientPhone: string, offer: SlotOffer): Promise<void> {
  await sendButtons(
    formatPhoneForWhatsApp(clientPhone),
    offer.message.replace(/\s*\n+\s*/g, " "),
    offer.times.map((tm) => ({ title: tm, id: `${offer.kind}|${offer.date}|${tm}|${offer.service}` })),
  );
}

async function executeTool(
  supabase: Supa,
  barber: Barber,
  sessionId: string,
  clientPhone: string,
  fallbackName: string | null,
  lang: Lang,
  name: string,
  // deno-lint-ignore no-explicit-any
  args: any,
): Promise<string> {
  const tz = barber.timezone || "America/New_York";

  if (name === "offer_slots") {
    // El SISTEMA elige las horas (el LLM inventaba horas fuera de la cuadrícula de la agenda y
    // concluía que "no hay tarde").
    const svc = resolveService(barber, args.service);
    const slots = await getAvailableSlots(supabase, barber, args.date, svc?.duration_min);
    if (slots.length === 0) return JSON.stringify({ ok: false, reason: "no hay horas libres ese día; propón otro día" });
    const minOf = (s: Slot) => {
      const [h, m] = formatInTimeZone(s.startUtc, tz, "HH:mm").split(":").map(Number);
      return h * 60 + m;
    };
    const near = parseNearTime(args.near_time);
    let picked: Slot[];
    if (near !== null) {
      // Pidió una hora: 1 antes (si está a ≤90 min) + 2 desde esa hora; si no, las 3 siguientes.
      // Si faltan, se completa con las anteriores más cercanas (salvo "después de las X").
      const after = slots.filter((s) => minOf(s) >= near);
      const before = slots.filter((s) => minOf(s) < near);
      const prev = before[before.length - 1];
      if (args.after_only && after.length === 0) {
        return JSON.stringify({ ok: false, reason: "no hay horas libres después de esa hora ese día; propón otro día" });
      }
      picked = prev && !args.after_only && near - minOf(prev) <= 90 && after.length >= 2
        ? [prev, ...after.slice(0, 2)]
        : after.slice(0, 3);
      for (const s of args.after_only ? [] : [...before].reverse()) {
        if (picked.length >= 3) break;
        if (!picked.includes(s)) picked.push(s);
      }
      picked.sort((a, b) => minOf(a) - minOf(b));
    } else {
      const part = String(args.part_of_day || "any");
      const pool = slots.filter((s) => inPartOfDay(minOf(s), part));
      if (pool.length === 0) {
        const others = PARTS_OF_DAY.filter((p) => slots.some((s) => inPartOfDay(minOf(s), p)));
        return JSON.stringify({ ok: false, reason: "no hay horas libres en esa franja ese día", other_parts_with_slots: others });
      }
      picked = pool.length <= 3 ? pool : [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];
    }
    const message = String(args.message || "").trim() || t("slots_default", lang);
    const kind = args.purpose === "reschedule" ? "move" : "slot";
    const times = picked.map((s) => s.label);
    return JSON.stringify({ ok: true, offered: times, offer: { date: args.date, times, message, service: svc?.name || "", kind } });
  }

  if (name === "book_appointment") {
    const svc = resolveService(barber, args.service);
    // Re-resolvemos el hueco por (fecha, etiqueta de hora): nunca confiamos en timestamps del LLM.
    const slots = await getAvailableSlots(supabase, barber, args.date, svc?.duration_min);
    const slot = slots.find((s) => s.label.toLowerCase() === String(args.time || "").toLowerCase().trim());
    if (!slot) return JSON.stringify({ ok: false, reason: "ese horario ya no está disponible; ofrece otro de la lista" });

    const clientName = args.client_name || fallbackName || null;
    const customerId = await findOrCreateCustomer(supabase, barber.id, clientPhone, clientName);
    if (!customerId) return JSON.stringify({ ok: false, reason: "no se pudo registrar al cliente" });

    const result = await bookAppointment(supabase, {
      barberId: barber.id,
      customerId,
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
    });
    if (result.ok) {
      if (clientName) await supabase.from("wa_sessions").update({ client_name: clientName }).eq("id", sessionId);
      // Bloque 5: avisar al barbero de la nueva cita (con confirmar/cancelar).
      await notifyBarberNewAppointment(supabase, barber, { clientName, code: result.code!, startUtc: slot.startUtc });
      // Bloque 6: programar los recordatorios 24h + 2h.
      await scheduleReminders(supabase, { appointmentId: result.appointmentId!, barberId: barber.id, startUtc: slot.startUtc });
      const price = priceForSlot(barber, svc, slot.startUtc, tz);
      return JSON.stringify({ ok: true, status: "pendiente_de_confirmacion_del_barbero", date: args.date, time: slot.label, code: result.code, service: svc?.name, price });
    }
    if (result.reason === "slot_taken") return JSON.stringify({ ok: false, reason: "acaban de tomar ese horario; ofrece otro" });
    return JSON.stringify({ ok: false, reason: "no se pudo agendar; intenta de nuevo" });
  }

  if (name === "get_my_appointment") {
    const appt = await getUpcomingAppointment(supabase, barber.id, clientPhone);
    if (!appt) return JSON.stringify({ has_appointment: false });
    return JSON.stringify({
      has_appointment: true,
      date: formatInTimeZone(appt.startUtc, tz, "yyyy-MM-dd"),
      time: formatInTimeZone(appt.startUtc, tz, "h:mm a"),
      code: appt.code,
    });
  }

  if (name === "reschedule_appointment") {
    const appt = await getUpcomingAppointment(supabase, barber.id, clientPhone);
    if (!appt) return JSON.stringify({ ok: false, reason: "no tienes una cita próxima para mover" });
    const slots = await getAvailableSlots(supabase, barber, args.date);
    const slot = slots.find((s) => s.label.toLowerCase() === String(args.time || "").toLowerCase().trim());
    if (!slot) return JSON.stringify({ ok: false, reason: "ese horario no está disponible; ofrece otro de la lista" });
    const r = await rescheduleAppointment(supabase, {
      appointmentId: appt.id,
      barberId: barber.id,
      newStartUtc: slot.startUtc,
      newEndUtc: slot.endUtc,
    });
    if (r.ok) {
      await notifyBarberChange(supabase, barber, { clientName: fallbackName, action: "reschedule", startUtc: appt.startUtc, newStartUtc: slot.startUtc });
      return JSON.stringify({ ok: true, date: args.date, time: slot.label });
    }
    if (r.reason === "slot_taken") return JSON.stringify({ ok: false, reason: "acaban de tomar ese horario; ofrece otro" });
    return JSON.stringify({ ok: false, reason: "no se pudo mover; intenta de nuevo" });
  }

  if (name === "cancel_appointment") {
    const appt = await getUpcomingAppointment(supabase, barber.id, clientPhone);
    if (!appt) return JSON.stringify({ ok: false, reason: "no tienes una cita próxima para cancelar" });
    await cancelAppointment(supabase, appt.id);
    await notifyBarberChange(supabase, barber, { clientName: fallbackName, action: "cancel", startUtc: appt.startUtc });
    return JSON.stringify({ ok: true, cancelled_time: formatInTimeZone(appt.startUtc, tz, "h:mm a") });
  }

  return JSON.stringify({ error: "unknown tool" });
}

export async function runAgent(
  supabase: Supa,
  ctx: { barber: Barber; sessionId: string; clientPhone: string; clientName: string | null; buttonPayload?: string | null },
): Promise<void> {
  const { barber, sessionId, clientPhone, clientName, buttonPayload } = ctx;
  let lang: Lang = "es"; // se detecta abajo; default seguro para los fallbacks del catch.
  try {
    // Reconocer al cliente si ya agendó antes con este barbero (para no pedir el nombre otra vez).
    const { data: known } = await supabase.from("customers")
      .select("name").eq("barber_id", barber.id).eq("phone_number", clientPhone).maybeSingle();
    const knownName: string | null = known?.name || null;
    const effectiveName = knownName || clientName;

    // Historial RECIENTE de la conversación (para contexto del LLM). Traemos los más
    // recientes (ascending:false) y los invertimos a orden cronológico. Si tomáramos los
    // más viejos, al pasar de 14 mensajes el agente dejaría de "ver" lo que el cliente
    // acaba de escribir y respondería en bucle el saludo inicial.
    const { data: recent } = await supabase
      .from("wa_messages")
      .select("direction, body, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(14);
    const history = (recent || []).reverse();

    // Idioma del cliente: si ya lo tenemos, úsalo; si no, detéctalo de su primer mensaje REAL
    // (ignorando el texto de activación pre-rellenado, que no son sus palabras) y guárdalo.
    const { data: sess } = await supabase.from("wa_sessions").select("lang").eq("id", sessionId).maybeSingle();
    if (sess?.lang) {
      lang = asLang(sess.lang);
    } else {
      const lastInbound = [...history].reverse().find((m) => m.direction === "inbound")?.body || "";
      const isActivation = /agendar[-_\s]*[A-Za-z0-9]{6}/i.test(lastInbound);
      if (!isActivation && lastInbound.trim().length >= 2) {
        lang = await detectLang(lastInbound);
        await supabase.from("wa_sessions").update({ lang }).eq("id", sessionId);
      }
    }

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [{ role: "system", content: buildSystemPrompt(barber, knownName) }];
    for (const m of history) {
      messages.push({ role: m.direction === "inbound" ? "user" : "assistant", content: m.body || "" });
    }

    let finalText: string | null = null;
    let offer: SlotOffer | null = null;
    const clientText = [...history].reverse().find((m) => m.direction === "inbound")?.body || "";

    let guardUsed = false;
    let timeGuardUsed = false;
    let availGuardUsed = false;
    let slotsChecked = false;
    let apptToolUsed = false;

    // Botón de hora tocado → la acción va DIRECTA, sin LLM (el LLM a veces anunciaba la cita
    // sin crearla). Reservar requiere nombre ya conocido; si no, sigue el LLM, que lo pide.
    if (buttonPayload && buttonPayload.startsWith("slot|") && knownName) {
      const [, date, time, service] = buttonPayload.split("|");
      const result = await executeTool(supabase, barber, sessionId, clientPhone, knownName, lang, "book_appointment", { date, time, client_name: knownName, service: service || undefined });
      if (JSON.parse(result).ok) {
        finalText = t("booking_pending", lang, { barber: barber.name });
      } else {
        messages.push({ role: "system", content: `El cliente tocó el botón de las ${time} del ${date}, pero esa hora ya no está disponible. Discúlpate en una línea y ofrécele otras horas con offer_slots.` });
      }
    } else if (buttonPayload && buttonPayload.startsWith("move|")) {
      const [, date, time] = buttonPayload.split("|");
      const result = await executeTool(supabase, barber, sessionId, clientPhone, effectiveName, lang, "reschedule_appointment", { date, time });
      apptToolUsed = true;
      messages.push({
        role: "system",
        content: JSON.parse(result).ok
          ? `El cliente tocó el botón de las ${time} del ${date} y su cita YA quedó movida a esa hora. Confírmaselo en una línea.`
          : `El cliente tocó el botón de las ${time} del ${date}, pero no se pudo mover su cita (${JSON.parse(result).reason}). Explícaselo en una línea y ofrécele otras horas con offer_slots (purpose 'reschedule').`,
      });
    }
    for (let i = 0; i < 5 && !finalText; i++) {
      const msg = await callLLM(messages);
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        let booked = false;
        for (const tc of msg.tool_calls) {
          let parsed = {};
          try {
            parsed = JSON.parse(tc.function.arguments || "{}");
          } catch { /* argumentos ilegibles: se maneja como tool vacío */ }
          if (tc.function.name === "offer_slots") {
            // La hora que escribió el cliente manda, aunque el LLM no la pase.
            // deno-lint-ignore no-explicit-any
            const p = parsed as any;
            const asked = extractClientTime(clientText);
            if (asked) {
              if (!p.near_time) p.near_time = asked.time;
              p.after_only = asked.afterOnly;
            }
          }
          const result = await executeTool(supabase, barber, sessionId, clientPhone, effectiveName, lang, tc.function.name, parsed);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          const r = JSON.parse(result);
          if (tc.function.name === "book_appointment" && r.ok) booked = true;
          if (tc.function.name === "offer_slots") slotsChecked = true;
          if (tc.function.name === "offer_slots" && r.ok) offer = r.offer;
          if (["get_my_appointment", "reschedule_appointment", "cancel_appointment"].includes(tc.function.name)) apptToolUsed = true;
        }
        // Texto FIJO al reservar: el LLM tendía a decir "confirmada/agendada" antes de que el
        // barbero acepte.
        if (booked) {
          finalText = t("booking_pending", lang, { barber: barber.name });
          offer = null;
          break;
        }
        if (offer) break;
        continue;
      }
      // Candado: el LLM no puede anunciar una cita que no creó en este turno.
      const text = msg.content || "";
      if (!apptToolUsed && BOOKING_CLAIM_RE.test(text)) {
        if (!guardUsed) {
          guardUsed = true;
          console.warn("[agent] candado: anunció cita sin book_appointment:", text.slice(0, 120));
          messages.push({ role: "assistant", content: text });
          messages.push({ role: "system", content: "ALERTA: escribiste que la cita está agendada/confirmada, pero NO llamaste a book_appointment en este turno, así que la cita NO existe. Si el cliente ya eligió una hora y sabes su nombre, llama book_appointment ahora. Si falta algo, pregúntalo. Nunca anuncies una cita sin llamar la herramienta." });
          continue;
        }
        finalText = t("booking_retry", lang);
        break;
      }
      // Candado de horas: el LLM copiaba del historial listas de horas (sin botones y sin
      // consultar la agenda). Una vez se le exige offer_slots; si insiste, es una mención legítima.
      if (!apptToolUsed && !timeGuardUsed && TIME_LIST_RE.test(text)) {
        timeGuardUsed = true;
        console.warn("[agent] candado de horas:", text.slice(0, 120));
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "system", content: "ALERTA: escribiste horas en el texto. Las horas NUNCA se escriben: pueden no estar libres y el cliente no las puede tocar. Si estás ofreciendo horas, llama offer_slots. Si mencionabas una hora por otra razón, reescribe tu respuesta sin horas." });
        continue;
      }
      if (!apptToolUsed && !slotsChecked && !availGuardUsed && AVAILABILITY_CLAIM_RE.test(text)) {
        availGuardUsed = true;
        console.warn("[agent] candado de disponibilidad:", text.slice(0, 120));
        messages.push({ role: "assistant", content: text });
        messages.push({ role: "system", content: "ALERTA: hablaste de disponibilidad sin consultar la agenda en este turno; lo que escribiste puede ser falso (no copies respuestas anteriores). Si el cliente pidió un día o una franja, llama offer_slots ahora. Si todavía no sabes qué día quiere, pregúntaselo sin hablar de disponibilidad." });
        continue;
      }
      finalText = text;
      break;
    }

    let logBody: string;
    if (offer) {
      await sendSlotButtons(clientPhone, offer);
      logBody = `${offer.message} (botones: ${offer.times.join(", ")} · ${offer.date})`;
    } else {
      if (!finalText || !finalText.trim()) finalText = t("err_retry", lang);
      await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), finalText);
      logBody = finalText;
    }
    await supabase.from("wa_messages").insert({
      session_id: sessionId,
      barber_id: barber.id,
      direction: "outbound",
      body: logBody,
    });
    await supabase.from("wa_sessions").update({ last_outbound_at: new Date().toISOString() }).eq("id", sessionId);
  } catch (err) {
    console.error("[agent] runAgent error:", err);
    try {
      await sendWhatsApp(
        formatPhoneForWhatsApp(clientPhone),
        t("err_technical", lang),
      );
    } catch { /* nada más que hacer */ }
  }
}
