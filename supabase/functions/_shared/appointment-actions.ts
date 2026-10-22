// _shared/appointment-actions.ts — acciones del BARBERO sobre una cita, en un solo lugar.
//
// Las usan los comandos de WhatsApp del barbero (_shared/barber.ts) y la app/dashboard
// (función barber-appointment-action). Antes el dashboard escribía directo en la tabla: el
// cliente no se enteraba y los recordatorios no se cancelaban ni se movían.
// Solo los mensajes al CLIENTE salen de aquí (en su idioma); el acuse al barbero lo da quien llama.

import { rescheduleAppointment, type Barber } from "./appointments.ts";
import { cancelReminders } from "./reminders.ts";
import { formatPhoneForWhatsApp, sendWhatsApp } from "./whatsapp.ts";
import { formatAppt, getClientLang, t } from "./i18n.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface BarberAppt {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  customer_id: string;
  customers?: { name?: string | null; phone_number?: string | null } | null;
}

async function clientCtx(supabase: Supa, barber: Barber, appt: BarberAppt, startUtc: string) {
  const phone = appt.customers?.phone_number || null;
  const lang = phone ? await getClientLang(supabase, barber.id, phone) : "es";
  return { phone, lang, when: formatAppt(startUtc, barber.timezone || "America/New_York", lang) };
}

/** ACEPTAR: registra el acuse y avisa al cliente (dirección + "toca la fecha"). Idempotente:
 *  si ya estaba aceptada no se le repite el mensaje al cliente. */
export async function confirmByBarber(
  supabase: Supa,
  barber: Barber,
  appt: BarberAppt,
  via: "whatsapp" | "app",
): Promise<{ ok: boolean; already?: boolean }> {
  const { data: updated } = await supabase.from("appointments")
    .update({ barber_confirmed_at: new Date().toISOString(), confirmed_via: via })
    .eq("id", appt.id).is("barber_confirmed_at", null)
    .select("id");
  if (!updated || updated.length === 0) return { ok: true, already: true };

  // Al agendar se le dijo al cliente que este mensaje llegaría: sale aunque no haya dirección.
  // Calendario: WhatsApp convierte la fecha en link "Add to calendar"; el texto solo lo indica.
  const c = await clientCtx(supabase, barber, appt, appt.start_time);
  const address = (barber.address || "").trim();
  if (c.phone) {
    await sendWhatsApp(
      formatPhoneForWhatsApp(c.phone),
      address
        ? t("client_confirmed", c.lang, { barber: barber.name, when: c.when, address })
        : t("client_confirmed_noaddr", c.lang, { barber: barber.name, when: c.when }),
    );
  }
  return { ok: true };
}

/** CANCELAR (imprevisto del barbero): libera el hueco, cancela recordatorios y avisa al cliente. */
export async function cancelByBarber(supabase: Supa, barber: Barber, appt: BarberAppt): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
  if (error) {
    console.error("[appt-actions] cancel failed:", error);
    return { ok: false };
  }
  await cancelReminders(supabase, appt.id);
  const c = await clientCtx(supabase, barber, appt, appt.start_time);
  if (c.phone) {
    await sendWhatsApp(formatPhoneForWhatsApp(c.phone), t("client_cancelled", c.lang, { barber: barber.name, when: c.when }));
  }
  return { ok: true };
}

/** MOVER: reserva atómica del nuevo hueco (sigue 'confirmed'), reprograma recordatorios y avisa al cliente. */
export async function rescheduleByBarber(
  supabase: Supa,
  barber: Barber,
  appt: BarberAppt,
  newStartUtc: string,
  newEndUtc: string,
): Promise<{ ok: boolean; reason?: string }> {
  const r = await rescheduleAppointment(supabase, { appointmentId: appt.id, barberId: barber.id, newStartUtc, newEndUtc });
  if (!r.ok) return r;
  const c = await clientCtx(supabase, barber, appt, newStartUtc);
  if (c.phone) {
    await sendWhatsApp(formatPhoneForWhatsApp(c.phone), t("client_moved_by_barber", c.lang, { barber: barber.name, when: c.when }));
  }
  return { ok: true };
}

/** COMPLETADA / NO SHOW: cierra la cita y cancela los recordatorios que queden. Sin aviso al cliente. */
export async function markOutcome(supabase: Supa, appt: BarberAppt, status: "completed" | "no_show"): Promise<{ ok: boolean }> {
  const { error } = await supabase.from("appointments").update({ status }).eq("id", appt.id);
  if (error) {
    console.error("[appt-actions] outcome failed:", error);
    return { ok: false };
  }
  await cancelReminders(supabase, appt.id);
  return { ok: true };
}
