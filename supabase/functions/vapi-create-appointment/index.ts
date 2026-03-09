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

function parseTimeString(input: string): { hours: number; minutes: number } | null {
  const timeMatch = input.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const ampm = timeMatch[3].toUpperCase();

  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;

  return { hours, minutes };
}

function parseStartTime(startTimeInput: string, tz: string): Date {
  if (!startTimeInput) {
    throw new Error("startTimeInput is null or empty");
  }

  const cleanedInput = String(startTimeInput).trim();
  console.log("[create-appt] Parsing start_time cleaned:", cleanedInput);

  // ✅ Try "YYYY-MM-DD H:MM AM/PM" format first (local time, NOT UTC)
  const localMatch = cleanedInput.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
  if (localMatch) {
    const year = parseInt(localMatch[1], 10);
    const month = parseInt(localMatch[2], 10);
    const day = parseInt(localMatch[3], 10);
    let hours = parseInt(localMatch[4], 10);
    const minutes = parseInt(localMatch[5], 10);
    const ampm = localMatch[6].toUpperCase();
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    const result = wallClockToUTC(year, month, day, hours, minutes, tz);
    console.log("[create-appt] Parsed YYYY-MM-DD H:MM AM/PM as local →", result.toISOString());
    return result;
  }

  // ✅ Try strict ISO
  const isoDate = new Date(cleanedInput);
  if (!isNaN(isoDate.getTime())) {
    console.log("[create-appt] Parsed as ISO:", isoDate.toISOString());
    return isoDate;
  }

  // ✅ Try time-only formats
  const timeParsed = parseTimeString(cleanedInput);
  if (!timeParsed) {
    throw new Error(`Cannot parse start_time format: ${cleanedInput}`);
  }

  const now = new Date();
  const nowParts = getDatePartsInTZ(now, tz);

  const result = wallClockToUTC(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    timeParsed.hours,
    timeParsed.minutes,
    tz
  );

  if (!result || isNaN(result.getTime())) {
    throw new Error(`Wall-clock conversion failed for: ${cleanedInput}`);
  }

  console.log("[create-appt] Parsed wall-clock → UTC:", result.toISOString());
  return result;
}


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

  let vapiSecret = req.headers.get("x-vapi-secret");
  const expected = Deno.env.get("VAPI_WEBHOOK_SECRET");
  // Strip "Bearer " prefix if present
  if (vapiSecret?.startsWith("Bearer ")) {
    vapiSecret = vapiSecret.substring(7);
  }
  if (expected && (!vapiSecret || vapiSecret.trim() !== expected.trim())) {
    return new Response("Unauthorized", { status: 401 });
  }

  let supabase: any = null;

  try {
    const body = await req.json();
    console.log("========== RAW REQUEST BODY ==========");
    console.log(JSON.stringify(body));
    console.log("======================================");

    let args =
      body?.message?.toolCallList?.[0]?.function?.arguments ||
      body;

    if (typeof args === "string") {
      try {
        console.log("[create-appt] Parsing string arguments...");
        args = JSON.parse(args);
      } catch (e) {
        console.error("[create-appt] Failed to parse arguments:", args);
        throw new Error("Invalid tool arguments format");
      }
    }

    console.log("[create-appt] Extracted args:", JSON.stringify(args));

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

    // ✅ VERIFICACIÓN DE DUPLICADOS
    const { data: existingAppt } = await supabase
      .from("appointments")
      .select("id")
      .eq("barber_id", barber_id)
      .eq("start_time", startIso)
      .in("status", ["confirmed", "rescheduled"])
      .maybeSingle();

    if (existingAppt) throw new Error("Slot already booked");

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

    console.log("[create-appt] Appointment confirmed:", appointmentCode);

    // ✅ SEND WHATSAPP CONFIRMATION
    try {
      const { data: barberInfo } = await supabase
        .from("barbers")
        .select("name, shop_name, phone_number, whatsapp_number")
        .eq("id", barber_id)
        .maybeSingle();

      const functionSecret = Deno.env.get("FUNCTION_SECRET");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");

      const whatsappRes = await fetch(
        `${supabaseUrl}/functions/v1/send-whatsapp-confirmation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${functionSecret}`,
          },
          body: JSON.stringify({
            customer_phone,
            customer_name,
            shop_name: barberInfo?.shop_name || "",
            barber_name: barberInfo?.name || "",
            barber_phone: barberInfo?.whatsapp_number || barberInfo?.phone_number || "",
            start_time: startIso,
            appointment_code: appointmentCode,
          }),
        }
      );

      const whatsappData = await whatsappRes.json();
      console.log("[create-appt] WhatsApp result:", JSON.stringify(whatsappData));
    } catch (whatsappErr) {
      console.error("[create-appt] WhatsApp notification failed (non-blocking):", whatsappErr);
    }

    const toolCallId = body?.message?.toolCallList?.[0]?.id;

    return new Response(
      JSON.stringify({
        results: [{
          toolCallId: toolCallId,
          result: `Appointment confirmed. Code: ${appointmentCode}`
        }]
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-create-appointment error:", err);

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
