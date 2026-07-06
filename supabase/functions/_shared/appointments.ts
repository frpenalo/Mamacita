// _shared/appointments.ts — disponibilidad + agendado atómico (Bloque 3).
//
// Reutiliza la MISMA lógica de src/lib/slots.ts (el motor del dashboard), adaptada al
// backend:
//   - timezone-aware: el barbero tiene su zona (barbers.timezone); el edge corre en UTC.
//   - working_days en abreviaturas ES (lun/mar/mie/jue/vie/sab/dom, ver Onboarding.tsx).
//   - reserva atómica REAL: el INSERT confía en la restricción appointments_no_overlap
//     (migración 20260630000002). No usa el "hold" optimista del dashboard.
//
// Estas funciones son las "herramientas" que el agente LLM (Bloque 4) invoca.

import { fromZonedTime, formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";
import { cancelReminders, scheduleReminders } from "./reminders.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface Barber {
  id: string;
  name: string;
  timezone: string | null;
  working_days: string[] | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  appointment_duration: number | null;
  whatsapp_number?: string | null;
  phone_number?: string | null;
  address?: string | null;
  services?: { name: string; price: number; duration_min: number }[] | null;
  surcharge_after?: string | null;
  surcharge_amount?: number | null;
  working_hours?: Record<string, { start: string; end: string }> | null;
}

export interface Slot {
  startUtc: string;
  endUtc: string;
  label: string; // "3:00 PM" en la zona del barbero
}

// getUTCDay(): 0=domingo … 6=sábado. working_days del onboarding usa estas abreviaturas ES.
const DOW_ES = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 6): string {
  let c = "";
  for (let i = 0; i < len; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && aE > bS;

/**
 * Huecos disponibles de un barbero para una fecha (YYYY-MM-DD), en su zona horaria.
 * Filtra: fuera de días laborables, pasados, con cita activa, con tiempo bloqueado.
 */
export async function getAvailableSlots(supabase: Supa, barber: Barber, dateStr: string, durationOverride?: number | null): Promise<Slot[]> {
  const tz = barber.timezone || "America/New_York";
  const duration = durationOverride || barber.appointment_duration || 45;

  // Día de la semana (weekday civil, no depende de la zona).
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const dowKey = DOW_ES[dow];

  // Horario del día: si hay working_hours (por día), manda; si no, legacy (working_days + fijo).
  let workStart: string;
  let workEnd: string;
  const wh = barber.working_hours;
  if (wh && Object.keys(wh).length > 0) {
    const dh = wh[dowKey];
    if (!dh || !dh.start || !dh.end) return []; // ese día no trabaja
    workStart = String(dh.start).slice(0, 5);
    workEnd = String(dh.end).slice(0, 5);
  } else {
    if (barber.working_days && barber.working_days.length > 0 && !barber.working_days.includes(dowKey)) return [];
    workStart = (barber.working_hours_start || "09:00:00").slice(0, 5);
    workEnd = (barber.working_hours_end || "18:00:00").slice(0, 5);
  }

  // Generar los slots en la zona del barbero, como instantes UTC.
  const startBoundary = fromZonedTime(`${dateStr}T${workStart}:00`, tz).getTime();
  const endBoundary = fromZonedTime(`${dateStr}T${workEnd}:00`, tz).getTime();
  const durationMs = duration * 60000;

  const slots: Slot[] = [];
  for (let cursor = startBoundary; cursor + durationMs <= endBoundary; cursor += durationMs) {
    const s = new Date(cursor);
    slots.push({
      startUtc: s.toISOString(),
      endUtc: new Date(cursor + durationMs).toISOString(),
      label: formatInTimeZone(s, tz, "h:mm a"),
    });
  }
  if (slots.length === 0) return [];

  // Rango del día completo (UTC) para las consultas.
  const dayStart = fromZonedTime(`${dateStr}T00:00:00`, tz).toISOString();
  const dayEnd = fromZonedTime(`${dateStr}T23:59:59`, tz).toISOString();

  const [apptRes, blockRes] = await Promise.all([
    supabase.from("appointments").select("start_time, end_time")
      .eq("barber_id", barber.id).in("status", ["confirmed", "rescheduled"])
      .gte("start_time", dayStart).lte("start_time", dayEnd),
    supabase.from("blocked_times").select("start_time, end_time")
      .eq("barber_id", barber.id).lte("start_time", dayEnd).gte("end_time", dayStart),
  ]);
  const appts = apptRes.data || [];
  const blocked = blockRes.data || [];
  const now = Date.now();

  return slots.filter((slot) => {
    const sS = new Date(slot.startUtc).getTime();
    const sE = new Date(slot.endUtc).getTime();
    if (sS < now) return false; // pasado
    // deno-lint-ignore no-explicit-any
    if (appts.some((a: any) => overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), sS, sE))) return false;
    // deno-lint-ignore no-explicit-any
    if (blocked.some((b: any) => overlaps(new Date(b.start_time).getTime(), new Date(b.end_time).getTime(), sS, sE))) return false;
    return true;
  });
}

/** Encuentra al cliente por teléfono dentro del barbero, o lo crea. */
export async function findOrCreateCustomer(
  supabase: Supa,
  barberId: string,
  phone: string,
  name: string | null,
): Promise<string | null> {
  const { data: existing } = await supabase.from("customers")
    .select("id").eq("barber_id", barberId).eq("phone_number", phone).maybeSingle();
  if (existing) return existing.id;

  // NO seteamos shop_id: el producto de citas vive en el mundo `barbers`. Ponerlo =barberId
  // rompía para barberos individuales sin fila en `shops` (FK customers_shop_id_fkey, 23503).
  // shop_id es nullable y el flujo de citas nunca lo usa.
  const { data: created, error } = await supabase.from("customers")
    .insert({ barber_id: barberId, name: name || "Cliente", phone_number: phone })
    .select("id").single();
  if (error) {
    console.error("[appointments] create customer failed:", error);
    return null;
  }
  return created.id;
}

export interface BookResult {
  ok: boolean;
  reason?: "slot_taken" | "error";
  appointmentId?: string;
  code?: string;
}

/**
 * Agenda una cita de forma ATÓMICA. Si el hueco fue tomado entre la oferta y la
 * confirmación, el INSERT viola appointments_no_overlap (23P01) y devolvemos slot_taken.
 */
export async function bookAppointment(
  supabase: Supa,
  args: { barberId: string; customerId: string; startUtc: string; endUtc: string },
): Promise<BookResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = genCode();
    const { data, error } = await supabase.from("appointments").insert({
      barber_id: args.barberId,
      customer_id: args.customerId,
      start_time: args.startUtc,
      end_time: args.endUtc,
      appointment_code: code,
      status: "confirmed",
    }).select("id").single();

    if (!error && data) {
      // Incrementar visitas del cliente (best-effort).
      const { data: c } = await supabase.from("customers").select("total_visits").eq("id", args.customerId).single();
      if (c) await supabase.from("customers").update({ total_visits: (c.total_visits || 0) + 1 }).eq("id", args.customerId);
      return { ok: true, appointmentId: data.id, code };
    }
    if (error?.code === "23P01") return { ok: false, reason: "slot_taken" }; // hueco ya tomado
    if (error?.code === "23505") continue; // colisión de appointment_code → reintentar
    console.error("[appointments] book failed:", error);
    return { ok: false, reason: "error" };
  }
  return { ok: false, reason: "error" };
}

// Estados que ocupan un hueco (activos). Un cancelado libera el hueco.
const ACTIVE_STATUSES = ["confirmed", "rescheduled"];

export interface UpcomingAppt {
  id: string;
  startUtc: string;
  endUtc: string;
  code: string | null;
}

/** La próxima cita activa (futura) de un cliente con ese barbero. */
export async function getUpcomingAppointment(
  supabase: Supa,
  barberId: string,
  clientPhone: string,
): Promise<UpcomingAppt | null> {
  const { data: cust } = await supabase.from("customers")
    .select("id").eq("barber_id", barberId).eq("phone_number", clientPhone).maybeSingle();
  if (!cust) return null;

  const { data: appt } = await supabase.from("appointments")
    .select("id, start_time, end_time, appointment_code")
    .eq("barber_id", barberId).eq("customer_id", cust.id).in("status", ACTIVE_STATUSES)
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!appt) return null;
  return { id: appt.id, startUtc: appt.start_time, endUtc: appt.end_time, code: appt.appointment_code };
}

/** Cancela una cita (libera el hueco) y sus recordatorios pendientes. */
export async function cancelAppointment(supabase: Supa, appointmentId: string): Promise<void> {
  await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appointmentId);
  await cancelReminders(supabase, appointmentId);
}

/** Mueve una cita a otro hueco (atómico) y reprograma sus recordatorios. */
export async function rescheduleAppointment(
  supabase: Supa,
  args: { appointmentId: string; barberId: string; newStartUtc: string; newEndUtc: string },
): Promise<{ ok: boolean; reason?: string }> {
  const { error } = await supabase.from("appointments")
    .update({ start_time: args.newStartUtc, end_time: args.newEndUtc })
    .eq("id", args.appointmentId).select("id").single();
  if (error) {
    if (error.code === "23P01") return { ok: false, reason: "slot_taken" }; // el nuevo hueco choca
    console.error("[appointments] reschedule failed:", error);
    return { ok: false, reason: "error" };
  }
  await cancelReminders(supabase, args.appointmentId);
  await scheduleReminders(supabase, { appointmentId: args.appointmentId, barberId: args.barberId, startUtc: args.newStartUtc });
  return { ok: true };
}
