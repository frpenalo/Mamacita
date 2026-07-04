// send-reminders — drenador de la cola de recordatorios (Bloque 6).
// Invocado por pg_cron cada 5 min. Envía los recordatorios vencidos (fire_at <= now,
// status 'pending') de citas que SIGAN confirmadas, y los marca 'sent'. Si la cita se
// canceló/movió, marca 'skipped'.
//
// Auth: FUNCTION_SECRET (Bearer), igual que send-whatsapp-queue-notification.
//
// Nota de entrega: los recordatorios son "iniciados por el negocio" y suelen caer FUERA
// de la ventana de 24h de WhatsApp, así que en producción requieren PLANTILLAS aprobadas
// por Meta (reminder_24h / reminder_2h, es/en). Aquí se envían freeform; sirve para la
// prueba (ventana abierta) y el cambio a plantilla es acotado (ver reporte del Bloque 6).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";
import { formatPhoneForWhatsApp, sendWhatsApp, sendTemplate } from "../_shared/whatsapp.ts";
import { formatApptEs } from "../_shared/barber.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function reminderText(
  kind: string,
  lang: string,
  name: string,
  barberName: string,
  when: string,
  time: string,
): string {
  const isEn = lang === "en";
  if (kind === "24h") {
    return isEn
      ? `Hi ${name} 👋 Reminder: your appointment with ${barberName} is on ${when}. See you! 💈`
      : `Hola ${name} 👋 Te recordamos tu cita con ${barberName} el ${when}. ¡Te esperamos! 💈`;
  }
  return isEn
    ? `Hi ${name} 👋 Your appointment with ${barberName} is today at ${time} (in ~2 hours). See you soon! 💈`
    : `Hola ${name} 👋 Tu cita con ${barberName} es hoy a las ${time} (en ~2 horas). ¡Nos vemos! 💈`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  const secret = Deno.env.get("FUNCTION_SECRET");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authorized =
    (secret && authHeader === `Bearer ${secret}`) ||
    (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const nowIso = new Date().toISOString();

    const { data: due } = await supabase
      .from("reminders")
      .select("id, kind, appointment_id, barber_id")
      .eq("status", "pending")
      .lte("fire_at", nowIso)
      .limit(200);

    let sent = 0;
    for (const r of due || []) {
      const { data: appt } = await supabase
        .from("appointments")
        .select("start_time, status, customers(name, phone_number)")
        .eq("id", r.appointment_id)
        .maybeSingle();

      // deno-lint-ignore no-explicit-any
      const cust = (appt as any)?.customers;
      if (!appt || appt.status !== "confirmed" || !cust?.phone_number) {
        await supabase.from("reminders").update({ status: "skipped" }).eq("id", r.id);
        continue;
      }
      // No recordar citas que ya pasaron (si la cola se atrasó, no mandamos avisos viejos).
      if (new Date(appt.start_time).getTime() <= Date.now()) {
        await supabase.from("reminders").update({ status: "skipped" }).eq("id", r.id);
        continue;
      }

      const { data: barber } = await supabase.from("barbers").select("name, timezone").eq("id", r.barber_id).maybeSingle();
      const tz = barber?.timezone || "America/New_York";

      const { data: sess } = await supabase
        .from("wa_sessions")
        .select("language")
        .eq("barber_id", r.barber_id)
        .eq("client_phone", cust.phone_number)
        .maybeSingle();
      const lang = sess?.language || "es";

      const name = cust.name || "";
      const barberName = barber?.name || "tu barbero";
      const to = formatPhoneForWhatsApp(cust.phone_number);
      const time = formatInTimeZone(appt.start_time, tz, "h:mm a");
      const when = formatApptEs(appt.start_time, tz);

      // 1) Plantilla aprobada por Meta (business-initiated → llega fuera de la ventana de 24h).
      const tplSid = r.kind === "24h"
        ? (lang === "en" ? Deno.env.get("TWILIO_TPL_REMINDER_24H_EN") : Deno.env.get("TWILIO_TPL_REMINDER_24H"))
        : (lang === "en" ? Deno.env.get("TWILIO_TPL_REMINDER_2H_EN") : Deno.env.get("TWILIO_TPL_REMINDER_2H"));
      const tplVars = r.kind === "24h"
        ? { "1": name, "2": barberName, "3": when }
        : { "1": name, "2": barberName, "3": time };

      // 2) Fallback freeform (solo llega si la ventana de 24h sigue abierta; útil mientras la plantilla se aprueba).
      let okSid: string | null = null;
      if (tplSid) okSid = await sendTemplate(to, tplSid, tplVars);
      if (!okSid) {
        const msg = reminderText(r.kind, lang, name, barberName, when, time);
        okSid = await sendWhatsApp(to, msg);
      }
      await supabase.from("reminders").update({ status: okSid ? "sent" : "skipped", sent_at: nowIso }).eq("id", r.id);
      if (okSid) sent++;
    }

    return new Response(JSON.stringify({ ok: true, processed: (due || []).length, sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[send-reminders] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
