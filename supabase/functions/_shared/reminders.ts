// _shared/reminders.ts — cola de recordatorios (24h + 2h) de una cita (Bloque 6).
// Programa/cancela filas en la tabla `reminders`; el envío lo hace la edge function
// send-reminders, drenada por pg_cron.

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Programa los recordatorios 24h y 2h antes de la cita (solo los que aún están en el futuro). */
export async function scheduleReminders(
  supabase: Supa,
  info: { appointmentId: string; barberId: string; startUtc: string },
): Promise<void> {
  const start = new Date(info.startUtc).getTime();
  const now = Date.now();
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  const t24 = start - 24 * 3600 * 1000;
  const t2 = start - 2 * 3600 * 1000;
  if (t24 > now) rows.push({ appointment_id: info.appointmentId, barber_id: info.barberId, kind: "24h", fire_at: new Date(t24).toISOString() });
  if (t2 > now) rows.push({ appointment_id: info.appointmentId, barber_id: info.barberId, kind: "2h", fire_at: new Date(t2).toISOString() });
  if (rows.length === 0) return;

  const { error } = await supabase.from("reminders").upsert(rows, { onConflict: "appointment_id,kind", ignoreDuplicates: true });
  if (error) console.error("[reminders] schedule failed:", error);
}

/** Cancela los recordatorios pendientes de una cita (al cancelar/reprogramar). */
export async function cancelReminders(supabase: Supa, appointmentId: string): Promise<void> {
  await supabase.from("reminders").update({ status: "cancelled" }).eq("appointment_id", appointmentId).eq("status", "pending");
}
