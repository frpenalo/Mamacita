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
} from "./appointments.ts";
import { formatPhoneForWhatsApp, sendWhatsApp } from "./whatsapp.ts";
import { notifyBarberChange, notifyBarberNewAppointment } from "./barber.ts";
import { scheduleReminders } from "./reminders.ts";

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
      name: "get_available_slots",
      description:
        "Consulta los horarios REALES disponibles del barbero para una fecha. Úsala SIEMPRE antes de ofrecer horas; nunca inventes disponibilidad.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
          service: { type: "string", description: "Opcional: nombre del servicio que eligió el cliente (de la lista de Servicios y precios), para usar su duración. Omítelo si aún no eligió." },
        },
        required: ["date"],
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
          time: { type: "string", description: "La hora elegida EXACTAMENTE como apareció en get_available_slots, ej '3:00 PM'" },
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
          time: { type: "string", description: "Nueva hora, EXACTAMENTE como apareció en get_available_slots" },
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

function buildSystemPrompt(barber: Barber, knownName: string | null): string {
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
    pricingBlock += `- Si el cliente pregunta precios, respóndelos desde esta lista.\n- Cuando el cliente elija un servicio, pásalo en el parámetro "service" de get_available_slots y book_appointment (para usar su duración).\n- Antes de confirmar, dile el precio del servicio (súmale el recargo si la hora aplica).\n`;
  }
  const knownBlock = knownName
    ? `\nEste cliente YA es conocido: se llama ${knownName}. Salúdalo por su nombre ("¡Hola de nuevo, ${knownName}!") y NO le pidas el nombre — ya lo tienes, úsalo directo al agendar.\n`
    : "";
  return `Eres el asistente de citas de ${barber.name} por WhatsApp. Atiendes a sus clientes para AGENDAR CITAS a hora fija.

${buildDateContext(tz)}
Cada cita dura ${duration} minutos por defecto (algunos servicios tienen su propia duración).
${pricingBlock}${knownBlock}
Cómo trabajas:
1. Saluda cordialmente como el asistente de ${barber.name}.
2. Averigua qué día y en qué franja quiere venir el cliente.
3. Llama SIEMPRE a get_available_slots antes de ofrecer horas. Nunca inventes disponibilidad.
4. Ofrece SOLO 3-4 opciones bien espaciadas (p.ej. una en la mañana, una al mediodía, una en la tarde) — NUNCA listes todas las horas disponibles, abrumas al cliente. Si el cliente pidió una franja ("en la tarde"), ofrece opciones de esa franja. Si no hay ninguna, dilo y propón otro día.
5. Pide el nombre del cliente SOLO si aún no lo sabes.
6. Cuando el cliente elija una hora y tengas su nombre, confirma con book_appointment.
7. Al quedar agendada, confírmala con alegría: día, hora y que lo esperan.
8. Si el cliente quiere VER, MOVER o CANCELAR una cita existente: usa get_my_appointment para consultarla y luego reschedule_appointment o cancel_appointment. Confirma con el cliente antes de cancelar.

Reglas:
- Responde en el IDIOMA del cliente (español o inglés), siguiéndolo.
- Sé breve y cálido, estilo WhatsApp: 1-3 líneas, algún emoji.
- Interpreta fechas relativas ("mañana", "el sábado") con las fechas de referencia de arriba.
- El primer mensaje puede ser un código de activación (ej. "agendar-XXXXXX"): ignóralo como texto, saluda y pregunta para cuándo quiere su cita.
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

async function executeTool(
  supabase: Supa,
  barber: Barber,
  sessionId: string,
  clientPhone: string,
  fallbackName: string | null,
  name: string,
  // deno-lint-ignore no-explicit-any
  args: any,
): Promise<string> {
  const tz = barber.timezone || "America/New_York";

  if (name === "get_available_slots") {
    const svc = resolveService(barber, args.service);
    const slots = await getAvailableSlots(supabase, barber, args.date, svc?.duration_min);
    if (slots.length === 0) {
      return JSON.stringify({ date: args.date, available: [], note: "No hay horarios disponibles ese día." });
    }
    return JSON.stringify({ date: args.date, available: slots.map((s) => s.label) });
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
      return JSON.stringify({ ok: true, date: args.date, time: slot.label, code: result.code, service: svc?.name, price });
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
  ctx: { barber: Barber; sessionId: string; clientPhone: string; clientName: string | null },
): Promise<void> {
  const { barber, sessionId, clientPhone, clientName } = ctx;
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

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [{ role: "system", content: buildSystemPrompt(barber, knownName) }];
    for (const m of history) {
      messages.push({ role: m.direction === "inbound" ? "user" : "assistant", content: m.body || "" });
    }

    let finalText: string | null = null;
    for (let i = 0; i < 5; i++) {
      const msg = await callLLM(messages);
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let parsed = {};
          try {
            parsed = JSON.parse(tc.function.arguments || "{}");
          } catch { /* argumentos ilegibles: se maneja como tool vacío */ }
          const result = await executeTool(supabase, barber, sessionId, clientPhone, effectiveName, tc.function.name, parsed);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }
      finalText = msg.content;
      break;
    }

    if (!finalText || !finalText.trim()) {
      finalText = "Disculpa, tuve un pequeño problema. ¿Me repites, por favor?";
    }

    await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), finalText);
    await supabase.from("wa_messages").insert({
      session_id: sessionId,
      barber_id: barber.id,
      direction: "outbound",
      body: finalText,
    });
    await supabase.from("wa_sessions").update({ last_outbound_at: new Date().toISOString() }).eq("id", sessionId);
  } catch (err) {
    console.error("[agent] runAgent error:", err);
    try {
      await sendWhatsApp(
        formatPhoneForWhatsApp(clientPhone),
        "Disculpa, estoy teniendo un problema técnico. Intenta de nuevo en un momento. 🙏",
      );
    } catch { /* nada más que hacer */ }
  }
}
