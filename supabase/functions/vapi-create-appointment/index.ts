import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLOT_DURATION = 45; // minutes

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Get date parts in a specific timezone.
 */
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
    seconds: get("second"),
  };
}

/**
 * Convert wall-clock time in a timezone to a UTC Date.
 */
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
 * Parse a time string like "2:00 PM", "14:00", "2:00PM" into hours and minutes.
 */
function parseTimeString(timeStr: string): { hours: number; minutes: number } | null {
  // Try "H:MM AM/PM" format
  const ampmMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const period = ampmMatch[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return { hours, minutes };
  }

  // Try 24h format "HH:MM"
  const h24Match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (h24Match) {
    return { hours: parseInt(h24Match[1], 10), minutes: parseInt(h24Match[2], 10) };
  }

  return null;
}

/**
 * Parse the start_time from Vapi which could be:
 * - An ISO string like "2026-03-05T14:00:00Z" or "2026-03-05T14:00:00"
 * - A time like "2:00 PM" (relative to today in barber's timezone)
 * - A date+time like "March 5 2:00 PM" or "tomorrow 2:00 PM"
 */
function parseStartTime(startTimeInput: string, tz: string): Date {
  console.log(`[create-appt] Parsing start_time: "${startTimeInput}"`);

  // First, try parsing as a full ISO date
  const isoDate = new Date(startTimeInput);
  if (!isNaN(isoDate.getTime())) {
    // Check if the year is reasonable (within 1 year of now)
    const now = new Date();
    const yearDiff = Math.abs(isoDate.getFullYear() - now.getFullYear());
    if (yearDiff <= 1) {
      console.log(`[create-appt] Parsed as ISO: ${isoDate.toISOString()}`);
      return isoDate;
    }
    console.log(`[create-appt] ISO parse gave unreasonable year: ${isoDate.getFullYear()}, falling through`);
  }

  // Extract time from the string
  const timeParsed = parseTimeString(startTimeInput);
  if (!timeParsed) {
    console.error(`[create-appt] Could not parse time from: "${startTimeInput}"`);
    throw new Error(`Cannot parse start_time: ${startTimeInput}`);
  }

  // Determine the date (today or tomorrow in barber's timezone)
  const now = new Date();
  const nowParts = getDatePartsInTZ(now, tz);

  let targetYear = nowParts.year;
  let targetMonth = nowParts.month;
  let targetDay = nowParts.day;

  // Check if "tomorrow" or "mañana" is mentioned
  const lowerInput = startTimeInput.toLowerCase();
  if (lowerInput.includes("tomorrow") || lowerInput.includes("mañana")) {
    const tomorrowUTC = new Date(wallClockToUTC(targetYear, targetMonth, targetDay, 12, 0, tz).getTime() + 24 * 60 * 60 * 1000);
    const tomorrowParts = getDatePartsInTZ(tomorrowUTC, tz);
    targetYear = tomorrowParts.year;
    targetMonth = tomorrowParts.month;
    targetDay = tomorrowParts.day;
  } else {
    // If the time has already passed today, assume tomorrow
    const slotUTC = wallClockToUTC(targetYear, targetMonth, targetDay, timeParsed.hours, timeParsed.minutes, tz);
    if (slotUTC.getTime() < now.getTime()) {
      const tomorrowUTC = new Date(wallClockToUTC(targetYear, targetMonth, targetDay, 12, 0, tz).getTime() + 24 * 60 * 60 * 1000);
      const tomorrowParts = getDatePartsInTZ(tomorrowUTC, tz);
      targetYear = tomorrowParts.year;
      targetMonth = tomorrowParts.month;
      targetDay = tomorrowParts.day;
    }
  }

  const result = wallClockToUTC(targetYear, targetMonth, targetDay, timeParsed.hours, timeParsed.minutes, tz);
  console.log(`[create-appt] Parsed as wall-clock ${timeParsed.hours}:${String(timeParsed.minutes).padStart(2, "0")} in ${tz} on ${targetYear}-${targetMonth}-${targetDay} → UTC: ${result.toISOString()}`);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Public endpoint — Vapi calls this directly without auth headers

  try {
    const body = await req.json();

    // Support both direct body params and Vapi tool-call structure
    const args =
      body?.message?.toolCallList?.[0]?.function?.arguments ||
      body;

    const { barber_id, customer_name, customer_phone, start_time } = args;

    console.log(`[create-appt] Received args:`, JSON.stringify({ barber_id, customer_name, customer_phone, start_time }));

    if (!barber_id || !customer_name || !customer_phone || !start_time) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: barber_id, customer_name, customer_phone, start_time" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get barber's timezone
    const { data: barber } = await supabase
      .from("barbers")
      .select("timezone")
      .eq("id", barber_id)
      .maybeSingle();

    const tz = barber?.timezone || "America/New_York";

    // Parse start_time with timezone awareness
    const startDate = parseStartTime(String(start_time), tz);
    const endDate = new Date(startDate.getTime() + SLOT_DURATION * 60000);

    console.log(`[create-appt] Final times: ${startDate.toISOString()} → ${endDate.toISOString()}`);

    // 1. Find or create customer
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

      if (custErr || !newCustomer) {
        console.error("[create-appt] Customer creation error:", custErr);
        return new Response(
          JSON.stringify({ error: "Failed to create customer" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      customerId = newCustomer.id;
    }

    // 2. Generate unique appointment code
    const appointmentCode = generateCode();

    // 3. Create appointment
    const { data: appointment, error: apptErr } = await supabase
      .from("appointments")
      .insert({
        barber_id,
        customer_id: customerId,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        status: "confirmed",
        appointment_code: appointmentCode,
      })
      .select()
      .single();

    if (apptErr || !appointment) {
      console.error("[create-appt] Appointment creation error:", apptErr);
      return new Response(
        JSON.stringify({ error: "Failed to create appointment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Update availability_slot if exists
    await supabase
      .from("availability_slots")
      .update({ status: "confirmed" })
      .eq("barber_id", barber_id)
      .eq("start_time", startDate.toISOString())
      .eq("status", "held");

    console.log(`[create-appt] Appointment created: ${appointmentCode} at ${startDate.toISOString()}`);

    // 5. Send WhatsApp confirmations
    try {
      const { data: barberData } = await supabase
        .from("barbers")
        .select("name, shop_name, whatsapp_number, phone_number")
        .eq("id", barber_id)
        .maybeSingle();

      const barberPhone = barberData?.whatsapp_number || barberData?.phone_number || null;

      const whatsappPayload = {
        customer_phone,
        customer_name,
        shop_name: barberData?.shop_name || "",
        barber_name: barberData?.name || "",
        barber_phone: barberPhone,
        start_time: startDate.toISOString(),
        appointment_code: appointmentCode,
      };

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const functionSecret = Deno.env.get("FUNCTION_SECRET")!;

      const waRes = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-confirmation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${functionSecret}`,
        },
        body: JSON.stringify(whatsappPayload),
      });

      const waData = await waRes.json();
      console.log(`[create-appt] WhatsApp result:`, JSON.stringify(waData));
    } catch (waErr) {
      console.error(`[create-appt] WhatsApp notification failed (non-blocking):`, waErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        appointment_code: appointmentCode,
        appointment_id: appointment.id,
        customer_id: customerId,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-create-appointment error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
