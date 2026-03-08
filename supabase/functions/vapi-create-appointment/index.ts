import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret",
};

const SLOT_DURATION = 45; // minutes

function getDatePartsInTZ(date: Date, tz: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hours: get("hour") === 24 ? 0 : get("hour"),
    minutes: get("minute"),
  };
}

function wallClockToUTC(year: number, month: number, day: number, hours: number, minutes: number, tz: string): Date {
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  const testDate = new Date(dateStr + "Z");
  const inTZ = getDatePartsInTZ(testDate, tz);
  const wantedMinutes = hours * 60 + minutes;
  const gotMinutes = inTZ.hours * 60 + inTZ.minutes;
  let offsetMinutes = gotMinutes - wantedMinutes;
  if (offsetMinutes > 720) offsetMinutes -= 1440;
  if (offsetMinutes < -720) offsetMinutes += 1440;
  return new Date(testDate.getTime() - offsetMinutes * 60000);
}

/**
 * Parse start_time from Vapi which can be:
 * - ISO 8601: "2026-03-08T15:00:00Z"
 * - Time only: "3:00 PM"
 * - Relative: "today at 3:00 PM", "tomorrow at 3:00 PM", "mañana a las 3:00 PM"
 */
function parseStartTime(raw: string, tz: string): Date | null {
  // 1. Try ISO 8601 directly
  const isoDate = new Date(raw);
  if (!isNaN(isoDate.getTime()) && (raw.includes("T") || raw.includes("Z") || /^\d{4}-\d{2}-\d{2}/.test(raw))) {
    return isoDate;
  }

  // 2. Extract time portion (e.g. "3:00 PM" from various formats)
  const timeMatch = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const ampm = timeMatch[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  // 3. Determine date offset (today vs tomorrow)
  const nowUTC = new Date();
  const nowParts = getDatePartsInTZ(nowUTC, tz);
  let targetYear = nowParts.year;
  let targetMonth = nowParts.month;
  let targetDay = nowParts.day;

  const lower = raw.toLowerCase();
  if (lower.includes("tomorrow") || lower.includes("mañana")) {
    // Add one day
    const todayNoon = wallClockToUTC(targetYear, targetMonth, targetDay, 12, 0, tz);
    const tomorrowNoon = new Date(todayNoon.getTime() + 24 * 60 * 60 * 1000);
    const tmParts = getDatePartsInTZ(tomorrowNoon, tz);
    targetYear = tmParts.year;
    targetMonth = tmParts.month;
    targetDay = tmParts.day;
  }

  return wallClockToUTC(targetYear, targetMonth, targetDay, hours, minutes, tz);
}
const HOLD_EXPIRATION_MINUTES = 10;

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function detectLanguage(body: any): "en" | "es" {
  const text =
    body?.message?.conversation?.[1]?.content?.toLowerCase() || "";

  if (text.includes("hola") || text.includes("mañana") || text.includes("cita")) {
    return "es";
  }
  return "en";
}

function formatTimeInTZ(date: Date, tz: string, lang: "en" | "es") {
  return new Intl.DateTimeFormat(
    lang === "es" ? "es-US" : "en-US",
    {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }
  ).format(date);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let supabase: any = null;
  let barberIdForRollback: string | null = null;
  let startIsoForRollback: string | null = null;
  let slotHeld = false;

  try {
    const body = await req.json();
    const args =
      body?.message?.toolCallList?.[0]?.function?.arguments ||
      body;
    const { barber_id, customer_name, customer_phone, start_time } = args;

    // ✅ LOG EXACTO antes de parsear
    console.log("[create-appt] Raw start_time from agent:", start_time);

    if (!barber_id || !customer_name || !customer_phone || !start_time) {
      throw new Error("Missing required fields");
    }

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: barber } = await supabase
      .from("barbers")
      .select("timezone")
      .eq("id", barber_id)
      .maybeSingle();

    const tz = barber?.timezone || "America/New_York";

    // ✅ LOG ULTRA DETALLADO
    console.log("[create-appt] start_time raw value:", start_time);
    console.log("[create-appt] start_time type:", typeof start_time);

    // ✅ VALIDACIÓN PREVIA
    if (!start_time || typeof start_time !== "string") {
      throw new Error(`Invalid start_time received: ${JSON.stringify(start_time)}`);
    }

    let startDate: Date;
    try {
      startDate = parseStartTime(start_time, tz);
    } catch (parseErr) {
      console.error("[create-appt] parseStartTime threw error:", parseErr);
      throw new Error(`Failed to parse start_time: ${start_time}`);
    }

    // ✅ VALIDAR QUE SEA DATE REAL
    if (!startDate || isNaN(startDate.getTime())) {
      console.error("[create-appt] startDate invalid after parsing:", startDate);
      throw new Error(`Parsed start_time is invalid: ${start_time}`);
    }

    const endDate = new Date(startDate.getTime() + SLOT_DURATION * 60000);
    console.log("[create-appt] Parsed UTC start:", startDate.toISOString());

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    barberIdForRollback = barber_id;
    startIsoForRollback = startIso;

    // ✅ HOLD ATÓMICO
    const { data: heldSlot, error: holdErr } = await supabase
      .from("availability_slots")
      .update({ status: "held" })
      .eq("barber_id", barber_id)
      .eq("start_time", startIso)
      .eq("status", "available")
      .select()
      .maybeSingle();

    if (holdErr) throw holdErr;
    if (!heldSlot) throw new Error("Slot not available");

    slotHeld = true;

    // ✅ CUSTOMER
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("*")
      .eq("barber_id", barber_id)
      .eq("phone_number", customer_phone)
      .maybeSingle();

    let customerId: string;

    if (existingCustomer) {
      customerId = existingCustomer.id;
      await supabase
        .from("customers")
        .update({ total_visits: (existingCustomer.total_visits || 0) + 1 })
        .eq("id", customerId);
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from("customers")
        .insert({
          barber_id,
          name: customer_name,
          phone_number: customer_phone,
          total_visits: 1,
        })
        .select()
        .single();

      if (custErr || !newCustomer) throw custErr;
      customerId = newCustomer.id;
    }

    const appointmentCode = generateCode();

    // ✅ CREATE APPOINTMENT
    const { data: appointment, error: apptErr } = await supabase
      .from("appointments")
      .insert({
        barber_id,
        customer_id: customerId,
        start_time: startIso,
        end_time: endIso,
        status: "confirmed",
        appointment_code: appointmentCode,
      })
      .select()
      .single();

    if (apptErr || !appointment) throw apptErr;

    // ✅ CONFIRM SLOT
    const { error: confirmErr } = await supabase
      .from("availability_slots")
      .update({ status: "confirmed" })
      .eq("barber_id", barber_id)
      .eq("start_time", startIso)
      .eq("status", "held");

    if (confirmErr) throw confirmErr;

    slotHeld = false;

    console.log("[create-appt] Appointment confirmed:", appointmentCode);

    return new Response(
      JSON.stringify({
        success: true,
        appointment_code: appointmentCode,
        appointment_id: appointment.id,
        customer_id: customerId,
        start_time: startIso,
        end_time: endIso,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-create-appointment error:", err);

    // ✅ ROLLBACK AUTOMÁTICO
    if (supabase && slotHeld && barberIdForRollback && startIsoForRollback) {
      await supabase
        .from("availability_slots")
        .update({ status: "available" })
        .eq("barber_id", barberIdForRollback)
        .eq("start_time", startIsoForRollback)
        .eq("status", "held");

      console.log("[create-appt] Slot released:", startIsoForRollback);
    }

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
