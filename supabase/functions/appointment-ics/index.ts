// appointment-ics — devuelve el archivo .ics de una cita para "Agregar al calendario".
// Público (Twilio lo descarga como media adjunta al WhatsApp del cliente). La cita se
// identifica por su UUID (?id=), que es la capacidad de acceso. verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Escapa texto para un campo de iCalendar (RFC 5545).
function esc(s: string): string {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
// ISO UTC → formato iCal (YYYYMMDDTHHMMSSZ).
function ical(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: appt } = await supabase
    .from("appointments")
    .select("id, start_time, end_time, appointment_code, status, barber_id")
    .eq("id", id)
    .maybeSingle();
  if (!appt) return new Response("not found", { status: 404 });

  const { data: barber } = await supabase
    .from("barbers")
    .select("name, shop_name, address")
    .eq("id", appt.barber_id)
    .maybeSingle();

  const shop = barber?.shop_name || barber?.name || "la barbería";
  const summary = `Cita en ${shop}`;
  const location = barber?.address || "";
  const desc = `Tu cita con ${barber?.name || shop}.${appt.appointment_code ? ` Código: ${appt.appointment_code}.` : ""}`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mamacita//Citas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appt.id}@mamacita`,
    `DTSTAMP:${ical(new Date().toISOString())}`,
    `DTSTART:${ical(appt.start_time)}`,
    `DTEND:${ical(appt.end_time)}`,
    `SUMMARY:${esc(summary)}`,
    location ? `LOCATION:${esc(location)}` : "",
    `DESCRIPTION:${esc(desc)}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(summary)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cita.ics"',
      "Access-Control-Allow-Origin": "*",
    },
  });
});
