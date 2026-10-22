// barber-appointment-action — acciones del barbero sobre SUS citas desde el dashboard/app.
//
// POST { action: 'confirm'|'cancel'|'reschedule'|'complete'|'no_show', appointment_id,
//        start_time?, end_time? (ISO UTC, solo reschedule) }
// Auth: JWT del barbero logueado (Authorization: Bearer <access_token>, lo manda
// supabase.functions.invoke). Se verifica con auth.getUser y que la cita sea de SU barbero.
// La lógica (avisos al cliente, recordatorios, reserva atómica) es la misma que usan los
// comandos de WhatsApp: _shared/appointment-actions.ts.
//
// Respuestas: 200 { ok: true, already? } · 400 datos inválidos · 401 sin sesión ·
//             404 cita no encontrada · 409 { reason: 'slot_taken' } · 500 error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Barber } from "../_shared/appointments.ts";
import {
  type BarberAppt,
  cancelByBarber,
  confirmByBarber,
  markOutcome,
  rescheduleByBarber,
} from "../_shared/appointment-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ACTIVE = ["confirmed", "rescheduled"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: userData } = jwt ? await supabase.auth.getUser(jwt) : { data: null };
  const user = userData?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body?.action || "");
  const appointmentId = String(body?.appointment_id || "");
  if (!["confirm", "cancel", "reschedule", "complete", "no_show"].includes(action) || !appointmentId) {
    return json({ error: "Invalid action or appointment_id" }, 400);
  }

  const { data: barber } = await supabase.from("barbers").select("*").eq("user_id", user.id).maybeSingle();
  if (!barber) return json({ error: "Barber not found" }, 404);

  const { data: appt } = await supabase.from("appointments")
    .select("id, start_time, end_time, status, customer_id, customers(name, phone_number)")
    .eq("id", appointmentId).eq("barber_id", barber.id).maybeSingle();
  if (!appt) return json({ error: "Appointment not found" }, 404);
  if (!ACTIVE.includes(appt.status)) return json({ error: `Appointment is ${appt.status}` }, 400);

  const b = barber as Barber;
  const a = appt as BarberAppt;
  try {
    if (action === "confirm") return json(await confirmByBarber(supabase, b, a, "app"));
    if (action === "cancel") {
      const r = await cancelByBarber(supabase, b, a);
      return json(r, r.ok ? 200 : 500);
    }
    if (action === "complete" || action === "no_show") {
      const r = await markOutcome(supabase, a, action === "complete" ? "completed" : "no_show");
      return json(r, r.ok ? 200 : 500);
    }
    // reschedule
    const start = new Date(String(body.start_time || ""));
    const end = new Date(String(body.end_time || ""));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return json({ error: "Invalid start_time/end_time" }, 400);
    }
    if (start.getTime() < Date.now()) return json({ error: "start_time is in the past" }, 400);
    const r = await rescheduleByBarber(supabase, b, a, start.toISOString(), end.toISOString());
    if (r.ok) return json({ ok: true });
    return json({ ok: false, reason: r.reason }, r.reason === "slot_taken" ? 409 : 500);
  } catch (err) {
    console.error("[barber-appointment-action] error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
