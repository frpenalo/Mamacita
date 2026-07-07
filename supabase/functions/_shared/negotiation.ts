// _shared/negotiation.ts — negociación de cambio de cita barbero↔cliente (#4).
//
// Máquina de estados en la tabla `negotiations`:
//   barber_choosing  → el barbero tocó [Modificar]; la AI le mostró sus huecos, elige uno
//   client_deciding  → se propuso una hora al cliente; acepta o propone otra
//   barber_deciding  → el cliente contrapropuso; el barbero acepta o propone otra
//   done / cancelled
//
// ADITIVO: si el remitente no tiene negociación activa en su turno, tryHandleNegotiation
// devuelve false y el flujo normal (agente/comandos) sigue SIN cambios.

import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";
import { getAvailableSlots, rescheduleAppointment, type Barber } from "./appointments.ts";
import { formatPhoneForWhatsApp, sendWhatsApp } from "./whatsapp.ts";
import { formatApptEs } from "./barber.ts";
import { formatAppt, getClientLang, t } from "./i18n.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;
const MAX_ROUNDS = 6;
const DOW_FULL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const isBail = (t: string) => /\b(cancel(ar|a|o|é)?|olv[ií]dal[oa]|d[eé]jal[oa]|no\s*importa|never\s?mind)\b/i.test(t);
const isAccept = (t: string) => /(^|\s)(s[íi]|ok|okay|dale|listo|perfecto|va|acepto|confirmo|de acuerdo|me sirve|yes|sure|works|👍)(\s|$|\.|!)/i.test(` ${t} `);

const barberPhone = (b: Barber) => b.whatsapp_number || b.phone_number || null;
const normPhone = (p: string) => (p || "").replace(/\D/g, "").slice(-10);
const apptDurationMin = (a: { start_time: string; end_time: string }) =>
  Math.max(15, Math.round((new Date(a.end_time).getTime() - new Date(a.start_time).getTime()) / 60000));

/** Interpreta fecha+hora de un texto libre con el LLM (relativos + contexto barbería). */
export async function extractDateTime(text: string, tz: string): Promise<{ date: string | null; time: string } | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const base = new Date(`${todayStr}T12:00:00Z`).getTime();
  const refs: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(base + i * 86400000);
    const tag = i === 0 ? " (hoy)" : i === 1 ? " (mañana)" : "";
    refs.push(`${d.toISOString().slice(0, 10)}=${DOW_FULL[d.getUTCDay()]}${tag}`);
  }
  const sys = `Extrae la FECHA y HORA del mensaje para una BARBERÍA (horario diurno, ~7 AM a 9 PM). Referencia de fechas: ${refs.join(", ")}. Responde SOLO JSON {"date":"YYYY-MM-DD" o null,"time":"h:mm AM/PM" o null}. El mensaje puede venir en español, inglés o Spanglish (mezcla); interpreta ambos idiomas. Reglas: si dan una HORA pero NO el día, deja date=null (NO inventes el día). Si la hora resultante cae de madrugada (12 AM–6 AM) y no tiene sentido para una barbería, asume PM (ej. "12"→"12:00 PM", "12 am"→"12:00 PM"). Interpreta relativos en ES/EN ("mañana"/"tomorrow", "el jueves"/"(next) Thursday", "a las 3"/"at 3", "mediodía"/"noon"→"12:00 PM", "3pm", "11:30", "pa'l jueves", "this Friday"/"este viernes").`;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    const p = JSON.parse(data.choices[0].message.content || "{}");
    return p.time ? { date: p.date || null, time: p.time } : null;
  } catch {
    return null;
  }
}

/** Resuelve el hueco desde {date,time}. Sin día → busca el primer día disponible con esa hora. */
export async function resolveSlot(supabase: Supa, barber: Barber, tz: string, dt: { date: string | null; time: string }, durationMin: number) {
  if (dt.date) return await findSlot(supabase, barber, dt.date, dt.time, durationMin);
  const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const base = new Date(`${todayStr}T12:00:00Z`).getTime();
  for (let i = 0; i < 7; i++) {
    const dateStr = new Date(base + i * 86400000).toISOString().slice(0, 10);
    const s = await findSlot(supabase, barber, dateStr, dt.time, durationMin);
    if (s) return s;
  }
  return null;
}

/** Busca el hueco (fecha, etiqueta de hora) disponible del barbero con la duración de la cita. */
async function findSlot(supabase: Supa, barber: Barber, date: string, timeLabel: string, durationMin: number) {
  const slots = await getAvailableSlots(supabase, barber, date, durationMin);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/\./g, "").trim();
  return slots.find((s) => norm(s.label) === norm(timeLabel)) || null;
}

/** Texto con algunos huecos libres de los próximos días (para que el barbero elija). */
async function upcomingSlotsMsg(supabase: Supa, barber: Barber, tz: string, durationMin: number): Promise<string> {
  const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const base = new Date(`${todayStr}T12:00:00Z`).getTime();
  const lines: string[] = [];
  for (let i = 0; i < 7 && lines.length < 4; i++) {
    const dateStr = new Date(base + i * 86400000).toISOString().slice(0, 10);
    const slots = await getAvailableSlots(supabase, barber, dateStr, durationMin);
    if (slots.length === 0) continue;
    const dayLabel = i === 0 ? "hoy" : i === 1 ? "mañana" : DOW_FULL[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];
    lines.push(`${dayLabel}: ${slots.slice(0, 2).map((s) => s.label).join(", ")}`);
  }
  return lines.length ? `\nTus horas libres → ${lines.join(" · ")}` : "";
}

async function getAppt(supabase: Supa, id: string) {
  const { data } = await supabase.from("appointments").select("id, start_time, end_time, customer_id, status").eq("id", id).maybeSingle();
  return data;
}
async function getCust(supabase: Supa, id: string) {
  const { data } = await supabase.from("customers").select("name, phone_number").eq("id", id).maybeSingle();
  return data;
}
const setStatus = (supabase: Supa, id: string, patch: Record<string, unknown>) =>
  supabase.from("negotiations").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);

/** El barbero tocó [Modificar]: crea la negociación y le muestra sus huecos. */
export async function startNegotiation(
  supabase: Supa,
  barber: Barber,
  appt: { id: string; start_time: string; end_time: string; customer_id: string; customers?: { name?: string; phone_number?: string } },
): Promise<void> {
  const to = barberPhone(barber);
  if (!to) return;
  const cust = appt.customers || (await getCust(supabase, appt.customer_id));
  if (!cust?.phone_number) {
    await sendWhatsApp(formatPhoneForWhatsApp(to), "No pude iniciar el cambio: no tengo el teléfono del cliente.");
    return;
  }
  // Evitar duplicar: si ya hay una activa para esa cita, no crear otra.
  const { data: existing } = await supabase.from("negotiations").select("id").eq("appointment_id", appt.id).not("status", "in", "(done,cancelled)").maybeSingle();
  if (!existing) {
    await supabase.from("negotiations").insert({ appointment_id: appt.id, barber_id: barber.id, client_phone: cust.phone_number, status: "barber_choosing", rounds: 0 });
  }
  const tz = barber.timezone || "America/New_York";
  const slotsMsg = await upcomingSlotsMsg(supabase, barber, tz, apptDurationMin(appt));
  await sendWhatsApp(formatPhoneForWhatsApp(to),
    `Vamos a mover la cita de ${cust.name || "el cliente"} (${formatApptEs(appt.start_time, tz)}).\n¿A qué hora SÍ puedes?${slotsMsg}\nDime una hora, o "cancelar" para dejarla igual.`);
}

async function closeNegotiation(supabase: Supa, neg: any, barber: Barber, appt: any, cust: any, tz: string) {
  const r = await rescheduleAppointment(supabase, { appointmentId: appt.id, barberId: barber.id, newStartUtc: neg.proposed_start_utc, newEndUtc: neg.proposed_end_utc });
  const to = barberPhone(barber);
  const lang = await getClientLang(supabase, barber.id, cust?.phone_number || neg.client_phone);
  if (!r.ok) {
    await setStatus(supabase, neg.id, { status: "cancelled" });
    if (cust?.phone_number) await sendWhatsApp(formatPhoneForWhatsApp(cust.phone_number), t("nego_slot_taken", lang));
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "Ese horario se ocupó justo ahora; la cita quedó como estaba.");
    return;
  }
  await setStatus(supabase, neg.id, { status: "done" });
  if (cust?.phone_number) await sendWhatsApp(formatPhoneForWhatsApp(cust.phone_number), t("nego_moved", lang, { when: formatAppt(neg.proposed_start_utc, tz, lang) }));
  if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), `✅ Cita movida al ${formatApptEs(neg.proposed_start_utc, tz)} (${cust?.name || "cliente"}). Ambos avisados.`);
}

async function handleBarberTurn(supabase: Supa, neg: any, barber: Barber, text: string) {
  const tz = barber.timezone || "America/New_York";
  const to = barberPhone(barber);
  const appt = await getAppt(supabase, neg.appointment_id);
  if (!appt || appt.status === "cancelled") { await setStatus(supabase, neg.id, { status: "cancelled" }); return; }
  const cust = await getCust(supabase, appt.customer_id);
  const lang = await getClientLang(supabase, barber.id, cust?.phone_number || neg.client_phone);
  const durationMin = apptDurationMin(appt);

  if (isBail(text)) {
    await setStatus(supabase, neg.id, { status: "cancelled" });
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "Ok, dejo la cita como estaba. 👍");
    if (neg.status === "barber_deciding" && cust?.phone_number) await sendWhatsApp(formatPhoneForWhatsApp(cust.phone_number), t("nego_kept", lang));
    return;
  }
  // Volvió a tocar "Modificar" (quizás sobre otra cita): reinicia con la cita más reciente.
  if (/\bmodific/i.test(text)) {
    await setStatus(supabase, neg.id, { status: "cancelled" });
    const { data: recent } = await supabase.from("appointments")
      .select("id, start_time, end_time, customer_id, customers(name, phone_number)")
      .eq("barber_id", barber.id).eq("status", "confirmed")
      .gte("start_time", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recent) await startNegotiation(supabase, barber, recent as any);
    else if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "No tienes una cita próxima para modificar.");
    return;
  }
  if (neg.status === "barber_deciding" && isAccept(text) && neg.proposed_start_utc) {
    await closeNegotiation(supabase, neg, barber, appt, cust, tz);
    return;
  }
  const dt = await extractDateTime(text, tz);
  const slot = dt ? await resolveSlot(supabase, barber, tz, dt, durationMin) : null;
  if (!slot) {
    const msg = await upcomingSlotsMsg(supabase, barber, tz, durationMin);
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), `No pude tomar esa hora.${msg}\nDime una de esas horas, o "cancelar".`);
    return;
  }
  await setStatus(supabase, neg.id, { status: "client_deciding", proposed_start_utc: slot.startUtc, proposed_end_utc: slot.endUtc });
  if (cust?.phone_number) await sendWhatsApp(formatPhoneForWhatsApp(cust.phone_number),
    t("nego_propose", lang, { name: cust.name ? " " + cust.name : "", barber: barber.name, when: formatAppt(slot.startUtc, tz, lang) }));
  if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), `Le propuse ${formatApptEs(slot.startUtc, tz)} al cliente. Te aviso qué dice. ⏳`);
}

async function handleClientTurn(supabase: Supa, neg: any, barber: Barber, text: string, clientPhone: string) {
  const tz = barber.timezone || "America/New_York";
  const to = barberPhone(barber);
  const appt = await getAppt(supabase, neg.appointment_id);
  if (!appt || appt.status === "cancelled") { await setStatus(supabase, neg.id, { status: "cancelled" }); return; }
  const cust = await getCust(supabase, appt.customer_id);
  const lang = await getClientLang(supabase, barber.id, clientPhone);
  const durationMin = apptDurationMin(appt);

  if (isBail(text)) {
    await setStatus(supabase, neg.id, { status: "cancelled" });
    await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), t("nego_bail", lang));
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "El cliente prefiere dejar la cita como estaba.");
    return;
  }
  if (isAccept(text) && neg.proposed_start_utc) {
    await closeNegotiation(supabase, neg, barber, appt, cust, tz);
    return;
  }
  if ((neg.rounds || 0) >= MAX_ROUNDS) {
    await setStatus(supabase, neg.id, { status: "cancelled" });
    await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), t("nego_max_rounds", lang));
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "No lograron coincidir; la cita queda como estaba.");
    return;
  }
  const dt = await extractDateTime(text, tz);
  const slot = dt ? await resolveSlot(supabase, barber, tz, dt, durationMin) : null;
  if (!slot) { await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), t("nego_counter_fail", lang)); return; }
  await setStatus(supabase, neg.id, { status: "barber_deciding", proposed_start_utc: slot.startUtc, proposed_end_utc: slot.endUtc, rounds: (neg.rounds || 0) + 1 });
  if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), `El cliente prefiere el ${formatApptEs(slot.startUtc, tz)}. ¿Puedes? Responde *SÍ*, u ofrécele otra hora.`);
  await sendWhatsApp(formatPhoneForWhatsApp(clientPhone), t("nego_asking_barber", lang));
}

export interface NegotiationCtx {
  // deno-lint-ignore no-explicit-any
  neg: any;
  role: "barber" | "client";
  barber: Barber;
  clientPhone?: string;
}

/**
 * CHEQUEO RÁPIDO (sin LLM): ¿el remitente tiene una negociación activa en su turno?
 * `barberSender` = el barbero si el remitente lo es (ya resuelto por whatsapp-inbound).
 * Devuelve el contexto para manejar, o null (→ flujo normal). No manda mensajes.
 */
export async function checkNegotiation(supabase: Supa, senderPhone: string, barberSender: Barber | null): Promise<NegotiationCtx | null> {
  const phone = senderPhone.replace(/^whatsapp:/, "");
  const sN = normPhone(phone);
  // Ignora negociaciones atascadas (sin actividad en >3h): así un "Modificar" nuevo arranca limpio.
  const fresh = (n: any) => Date.now() - new Date(n.updated_at || n.created_at).getTime() < 3 * 3600 * 1000;
  try {
    // ¿Es el CLIENTE respondiendo (client_deciding)?
    const { data: cNegs } = await supabase.from("negotiations").select("*").eq("status", "client_deciding");
    const cNeg = (cNegs || []).find((n: any) => fresh(n) && normPhone(n.client_phone) === sN);
    if (cNeg) {
      const { data: barber } = await supabase.from("barbers").select("*").eq("id", cNeg.barber_id).maybeSingle();
      if (barber) return { neg: cNeg, role: "client", barber: barber as Barber, clientPhone: phone };
    }
    // ¿Es el BARBERO (barber_choosing / barber_deciding)?
    if (barberSender) {
      const { data: bNegs } = await supabase.from("negotiations").select("*").eq("barber_id", barberSender.id).in("status", ["barber_choosing", "barber_deciding"]);
      const bNeg = (bNegs || []).filter(fresh)[0];
      if (bNeg) return { neg: bNeg, role: "barber", barber: barberSender };
    }
  } catch (e) {
    console.error("[negotiation] check error:", e);
  }
  return null;
}

/** Maneja el turno (puede tardar: usa LLM). Correr en background. */
export async function handleNegotiationTurn(supabase: Supa, ctx: NegotiationCtx, text: string): Promise<void> {
  try {
    if (ctx.role === "client") await handleClientTurn(supabase, ctx.neg, ctx.barber, text, ctx.clientPhone!);
    else await handleBarberTurn(supabase, ctx.neg, ctx.barber, text);
  } catch (e) {
    console.error("[negotiation] turn error:", e);
  }
}
