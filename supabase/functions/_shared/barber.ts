// _shared/barber.ts — gestión del lado BARBERO (Bloque 5):
//   - detectar si quien escribe es un barbero (por su teléfono)
//   - avisarle de cada cita nueva
//   - procesar sus comandos: CONFIRMAR / CANCELAR (por texto o por botón-tap)
//
// En la opción A (confirmación instantánea), la cita nace 'confirmed'. Por eso CONFIRMAR
// es un acuse; CANCELAR es la acción real (libera el hueco + avisa al cliente).

import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";
import { formatPhoneForWhatsApp, sendTemplate, sendWhatsApp } from "./whatsapp.ts";
import { cancelReminders } from "./reminders.ts";
import type { Barber } from "./appointments.ts";
import { startNegotiation } from "./negotiation.ts";
import { formatAppt, getClientLang, t } from "./i18n.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;

const DOW_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MON_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function barberPhone(barber: Barber): string | null {
  return barber.whatsapp_number || barber.phone_number || null;
}

/** "sáb 5 jul, 3:00 PM" en la zona del barbero. */
export function formatApptEs(startUtc: string, tz: string): string {
  const ds = formatInTimeZone(startUtc, tz, "yyyy-MM-dd");
  const time = formatInTimeZone(startUtc, tz, "h:mm a");
  const parts = ds.split("-").map(Number);
  const mo = parts[1];
  const da = parts[2];
  const dow = new Date(`${ds}T12:00:00Z`).getUTCDay();
  return `${DOW_SHORT[dow]} ${da} ${MON_SHORT[mo - 1]}, ${time}`;
}

/** ¿El teléfono pertenece a un barbero? (comparación normalizada por RPC). */
export async function findBarberByPhone(supabase: Supa, phone: string): Promise<Barber | null> {
  const { data, error } = await supabase.rpc("find_barber_by_phone", { p_phone: phone });
  if (error) {
    console.error("[barber] lookup failed:", error);
    return null;
  }
  return data && data.length ? (data[0] as Barber) : null;
}

/** Avisa al barbero de una cita recién agendada, con instrucciones para confirmar/cancelar. */
export async function notifyBarberNewAppointment(
  supabase: Supa,
  barber: Barber,
  info: { clientName: string | null; code: string; startUtc: string },
): Promise<void> {
  const to = barberPhone(barber);
  if (!to) return;
  const tz = barber.timezone || "America/New_York";
  const when = formatApptEs(info.startUtc, tz);

  // Si la plantilla con botones ya está aprobada (SID en secret), usarla: llega SIEMPRE
  // (fuera de la ventana de 24h) y con botones Confirmar/Cancelar.
  const tplSid = Deno.env.get("TWILIO_TPL_CITA_NUEVA_BARBERO_V2") || Deno.env.get("TWILIO_TPL_CITA_NUEVA_BARBERO");
  if (tplSid) {
    const sent = await sendTemplate(formatPhoneForWhatsApp(to), tplSid, {
      "1": info.clientName || "Cliente",
      "2": when,
      "3": info.code,
    });
    if (sent) return; // plantilla OK; si falló (p.ej. aún no aprobada por Meta), cae al freeform
  }

  // Fallback freeform (solo dentro de la ventana de 24h) mientras la plantilla no esté lista.
  const body =
    `📅 Nueva cita en tu agenda\n` +
    `Cliente: ${info.clientName || "Cliente"}\n` +
    `Cuándo: ${when}\n` +
    `Código: ${info.code}\n\n` +
    `Si tienes un imprevisto, responde *CANCELAR ${info.code}* y aviso al cliente. Para confirmar, responde *CONFIRMAR ${info.code}*.`;
  await sendWhatsApp(formatPhoneForWhatsApp(to), body);
}

/** Procesa un comando del barbero: CONFIRMAR (acuse) o CANCELAR (cancela + avisa cliente). */
export async function handleBarberCommand(supabase: Supa, barber: Barber, text: string): Promise<void> {
  const to = barberPhone(barber);
  const lower = text.toLowerCase();
  const isCancel = /\b(cancel(ar|a|o)?|rechaz(ar|a|o)|reject)\b/.test(lower);
  const isModify = /\b(modific(ar|a|o|ación)?|cambiar|mover)\b/.test(lower);
  const isConfirm = !isModify && /\b(acept(ar|o|a)?|confirm(ar|o|a)?|s[ií]|ok|dale|listo)\b/.test(lower);
  const codeMatch = text.toUpperCase().match(/\b([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})\b/);

  if (!isCancel && !isConfirm && !isModify) {
    if (to) {
      await sendWhatsApp(
        formatPhoneForWhatsApp(to),
        "Para gestionar una cita responde *Aceptar*, *Modificar* o *Cancelar*.",
      );
    }
    return;
  }

  // Localizar la cita: por código si lo dieron; si no, la próxima cita futura más reciente.
  let query = supabase
    .from("appointments")
    .select("id, start_time, end_time, status, customer_id, customers(name, phone_number)")
    .eq("barber_id", barber.id)
    .eq("status", "confirmed");
  if (codeMatch) {
    query = query.eq("appointment_code", codeMatch[1]);
  } else {
    query = query.gte("start_time", new Date().toISOString()).order("created_at", { ascending: false });
  }
  const { data: appts } = await query.limit(1);
  const appt = appts && appts.length ? appts[0] : null;

  if (!appt) {
    if (to) await sendWhatsApp(formatPhoneForWhatsApp(to), "No encontré una cita pendiente para gestionar 🤔.");
    return;
  }

  const tz = barber.timezone || "America/New_York";
  const when = formatApptEs(appt.start_time, tz); // para los avisos al BARBERO (siempre español)
  // deno-lint-ignore no-explicit-any
  const cust = (appt as any).customers;
  // Idioma del cliente para localizar SOLO lo que le llega a él.
  const lang = cust?.phone_number ? await getClientLang(supabase, barber.id, cust.phone_number) : "es";
  const whenClient = formatAppt(appt.start_time, tz, lang);

  // MODIFICAR → arranca la negociación de cambio de hora (barbero ↔ cliente).
  if (isModify) {
    await startNegotiation(supabase, barber, appt as any);
    return;
  }

  if (isCancel) {
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
    await cancelReminders(supabase, appt.id);
    if (cust?.phone_number) {
      await sendWhatsApp(
        formatPhoneForWhatsApp(cust.phone_number),
        t("client_cancelled", lang, { barber: barber.name, when: whenClient }),
      );
    }
    if (to) {
      await sendWhatsApp(
        formatPhoneForWhatsApp(to),
        `❌ Cita cancelada (${cust?.name || "cliente"}, ${when}). Ya avisé al cliente.`,
      );
    }
    return;
  }

  // CONFIRMAR = acuse al barbero + avisar al cliente con la DIRECCIÓN (opción A: ya nace confirmada).
  const address = (barber.address || "").trim();
  if (cust?.phone_number && address) {
    await sendWhatsApp(
      formatPhoneForWhatsApp(cust.phone_number),
      t("client_confirmed", lang, { barber: barber.name, when: whenClient, address }),
    );
  }
  if (to) {
    await sendWhatsApp(formatPhoneForWhatsApp(to), `✅ Confirmada: ${cust?.name || "cliente"} — ${when}. ¡Listo!`);
  }
}

/** Avisa al barbero cuando el CLIENTE cancela o mueve su cita (Bloque 7). */
export async function notifyBarberChange(
  supabase: Supa,
  barber: Barber,
  info: { clientName: string | null; action: "cancel" | "reschedule"; startUtc: string; newStartUtc?: string },
): Promise<void> {
  const to = barberPhone(barber);
  if (!to) return;
  const tz = barber.timezone || "America/New_York";
  const who = info.clientName || "Un cliente";
  const body = info.action === "cancel"
    ? `🔔 ${who} canceló su cita del ${formatApptEs(info.startUtc, tz)}.`
    : `🔔 ${who} movió su cita del ${formatApptEs(info.startUtc, tz)} al ${formatApptEs(info.newStartUtc!, tz)}.`;
  await sendWhatsApp(formatPhoneForWhatsApp(to), body);
}
