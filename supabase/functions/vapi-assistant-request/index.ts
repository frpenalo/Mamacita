import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLOT_DURATION = 45; // minutes

/**
 * Get current date/time in a specific IANA timezone using Intl.DateTimeFormat.
 * Returns { year, month, day, hours, minutes, seconds } in that timezone.
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
    month: get("month"), // 1-indexed
    day: get("day"),
    hours: get("hour") === 24 ? 0 : get("hour"),
    minutes: get("minute"),
    seconds: get("second"),
  };
}

/**
 * Create a UTC Date that represents a specific wall-clock time in a timezone.
 * E.g., "9:00 AM EST" → the UTC instant when it's 9:00 in EST.
 */
function wallClockToUTC(year: number, month: number, day: number, hours: number, minutes: number, tz: string): Date {
  // Create a date string and use the timezone to find the UTC offset
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  // Use a trick: format a known UTC date in the target TZ to find the offset
  const testDate = new Date(dateStr + "Z"); // treat as UTC first
  const inTZ = getDatePartsInTZ(testDate, tz);
  // The difference between what we wanted and what we got tells us the offset
  const wantedMinutes = hours * 60 + minutes;
  const gotMinutes = inTZ.hours * 60 + inTZ.minutes;
  let offsetMinutes = gotMinutes - wantedMinutes;
  // Handle day boundary
  if (offsetMinutes > 720) offsetMinutes -= 1440;
  if (offsetMinutes < -720) offsetMinutes += 1440;
  return new Date(testDate.getTime() - offsetMinutes * 60000);
}

function formatTimeAMPM(date: Date, tz: string): string {
  const parts = getDatePartsInTZ(date, tz);
  let hours = parts.hours;
  const minutes = parts.minutes;
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minStr} ${ampm}`;
}

function formatWorkHour(time: string): string {
  const [h, m] = time.split(":");
  let hours = parseInt(h, 10);
  const minutes = m || "00";
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

const DAY_LABELS: Record<string, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

const MONTH_LABELS: string[] = [
  "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Maps JS getDay() (0=Sun) to working_days keys
const JS_DAY_TO_KEY: Record<number, string> = {
  0: "dom",
  1: "lun",
  2: "mar",
  3: "mie",
  4: "jue",
  5: "vie",
  6: "sab",
};

function getDayOfWeekInTZ(year: number, month: number, day: number, tz: string): number {
  const d = wallClockToUTC(year, month, day, 12, 0, tz);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const wd = formatter.format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

function formatWorkingDays(days: string[] | null): string {
  if (!days || days.length === 0) return "No configurado";
  return days.map((d) => DAY_LABELS[d] || d).join(", ");
}

function getTimezoneOffsetString(date: Date, tz: string): string {
  const localParts = getDatePartsInTZ(date, tz);
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  let offsetMinutes = (localParts.hours * 60 + localParts.minutes) - (utcHours * 60 + utcMinutes);
  if (offsetMinutes > 720) offsetMinutes -= 1440;
  if (offsetMinutes < -720) offsetMinutes += 1440;
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offH = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offM = String(absOffset % 60).padStart(2, "0");
  return `${sign}${offH}:${offM}`;
}

function formatISOWithOffset(date: Date, tz: string): string {
  const parts = getDatePartsInTZ(date, tz);
  const offset = getTimezoneOffsetString(date, tz);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}:00${offset}`;
}

function formatSlotWithISO(date: Date, tz: string): string {
  return `${formatTimeAMPM(date, tz)} [${formatISOWithOffset(date, tz)}]`;
}

function getSlotsForDate(
  year: number,
  month: number,
  day: number,
  workStart: string,
  workEnd: string,
  appointments: any[],
  blockedTimes: any[],
  heldSlots: any[],
  nowUTC: Date,
  tz: string
): string[] {
  const parseTime = (t: string) => {
    const parts = t.split(":");
    return { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) };
  };

  const start = parseTime(workStart);
  const end = parseTime(workEnd);

  // Convert wall-clock work hours to UTC instants
  const dayStartUTC = wallClockToUTC(year, month, day, start.hours, start.minutes, tz);
  const dayEndUTC = wallClockToUTC(year, month, day, end.hours, end.minutes, tz);

  const slots: { startUTC: Date; endUTC: Date }[] = [];
  let cursor = dayStartUTC.getTime();
  const slotMs = SLOT_DURATION * 60000;
  while (cursor + slotMs <= dayEndUTC.getTime()) {
    slots.push({
      startUTC: new Date(cursor),
      endUTC: new Date(cursor + slotMs),
    });
    cursor += slotMs;
  }

  const available: string[] = [];
  const nowMs = nowUTC.getTime();

  for (const slot of slots) {
    const sStart = slot.startUTC.getTime();
    const sEnd = slot.endUTC.getTime();

    if (sStart < nowMs) continue;

    const hasAppt = appointments.some((a: any) => {
      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      return aStart < sEnd && aEnd > sStart;
    });
    if (hasAppt) continue;

    const isBlocked = blockedTimes.some((b: any) => {
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      return bStart < sEnd && bEnd > sStart;
    });
    if (isBlocked) continue;

    const isHeld = heldSlots.some((h: any) => {
      if (h.hold_expires_at && new Date(h.hold_expires_at).getTime() < nowMs) return false;
      const hStart = new Date(h.start_time).getTime();
      const hEnd = new Date(h.end_time).getTime();
      return hStart < sEnd && hEnd > sStart;
    });
    if (isHeld) continue;

    available.push(formatSlotWithISO(slot.startUTC, tz));
  }

  return available;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }


  try {
    const body = await req.json();
    const messageType = body?.message?.type;

    if (messageType !== "assistant-request") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calledNumber =
      body?.message?.phoneNumber?.number ||
      body?.message?.call?.to ||
      body?.message?.call?.phoneNumber?.number ||
      null;

    if (!calledNumber) {
      console.error("Cannot determine called number. Full body:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "Cannot determine called number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: barber, error: barberError } = await supabase
      .from("barbers")
      .select("*")
      .eq("phone_number", calledNumber)
      .maybeSingle();

    if (barberError || !barber) {
      return new Response(JSON.stringify({ error: "Barber not found for number: " + calledNumber }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const workStart = barber.working_hours_start || "09:00";
    const workEnd = barber.working_hours_end || "18:00";
    const tz = barber.timezone || "America/New_York";

    const nowUTC = new Date();
    const nowParts = getDatePartsInTZ(nowUTC, tz);

    const todayYear = nowParts.year;
    const todayMonth = nowParts.month;
    const todayDay = nowParts.day;

    // Build list of next 7 days (date parts in barber's TZ)
    const daysToCheck: { year: number; month: number; day: number; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const dateUTC = new Date(wallClockToUTC(todayYear, todayMonth, todayDay, 12, 0, tz).getTime() + i * 24 * 60 * 60 * 1000);
      const parts = getDatePartsInTZ(dateUTC, tz);
      const dow = getDayOfWeekInTZ(parts.year, parts.month, parts.day, tz);
      const dayKey = JS_DAY_TO_KEY[dow];

      // Skip days not in working_days
      if (barber.working_days && barber.working_days.length > 0 && !barber.working_days.includes(dayKey)) {
        continue;
      }

      const label = i === 0 ? "Hoy" : i === 1 ? "Mañana" : `${DAY_LABELS[dayKey] || dayKey} ${parts.day} de ${MONTH_LABELS[parts.month]}`;
      daysToCheck.push({ year: parts.year, month: parts.month, day: parts.day, label });
    }

    // Query range: start of today to end of last day to check
    const lastDay = daysToCheck.length > 0 ? daysToCheck[daysToCheck.length - 1] : { year: todayYear, month: todayMonth, day: todayDay };
    const queryStartUTC = wallClockToUTC(todayYear, todayMonth, todayDay, 0, 0, tz).toISOString();
    const queryEndUTC = wallClockToUTC(lastDay.year, lastDay.month, lastDay.day, 23, 59, tz).toISOString();

    console.log(`[assistant-request] TZ: ${tz}, Now UTC: ${nowUTC.toISOString()}`);
    console.log(`[assistant-request] Today (in TZ): ${todayYear}-${todayMonth}-${todayDay}`);
    console.log(`[assistant-request] Days to check: ${JSON.stringify(daysToCheck.map(d => d.label))}`);
    console.log(`[assistant-request] Query range: ${queryStartUTC} → ${queryEndUTC}`);
    console.log(`[assistant-request] Work hours: ${workStart} - ${workEnd}, Working days: ${JSON.stringify(barber.working_days)}`);

    // Fetch appointments
    const { data: appointments } = await supabase
      .from("appointments")
      .select("start_time, end_time, status")
      .eq("barber_id", barber.id)
      .in("status", ["confirmed", "rescheduled"])
      .lte("start_time", queryEndUTC)
      .gte("end_time", queryStartUTC);

    console.log(`[assistant-request] Found ${appointments?.length || 0} appointments`);

    // Fetch blocked times
    const { data: blockedTimes } = await supabase
      .from("blocked_times")
      .select("start_time, end_time")
      .eq("barber_id", barber.id)
      .lte("start_time", queryEndUTC)
      .gte("end_time", queryStartUTC);

    console.log(`[assistant-request] Found ${blockedTimes?.length || 0} blocked times`);

    // Fetch held slots
    const { data: heldSlots } = await supabase
      .from("availability_slots")
      .select("start_time, end_time, hold_expires_at, held_by_session_id")
      .eq("barber_id", barber.id)
      .eq("status", "held")
      .gte("start_time", queryStartUTC)
      .lte("start_time", queryEndUTC);

    console.log(`[assistant-request] Found ${heldSlots?.length || 0} held slots`);

    // Find slots across all 7 days
    const dayResults: { label: string; slots: string[] }[] = [];

    for (const d of daysToCheck) {
      const slots = getSlotsForDate(d.year, d.month, d.day, workStart, workEnd, appointments || [], blockedTimes || [], heldSlots || [], nowUTC, tz);
      console.log(`[assistant-request] Day ${d.label} (${d.year}-${d.month}-${d.day}): ${slots.length} slots available`);
      if (slots.length > 0) {
        dayResults.push({ label: d.label, slots });
      }
    }

    let availableStr = "";
    if (dayResults.length > 0) {
      availableStr = dayResults.map(r => `${r.label}: ${r.slots.join(", ")}`).join(". ");
    } else {
      availableStr = "No hay horarios disponibles en los próximos 7 días";
    }

    console.log(`[assistant-request] Available slots: ${availableStr}`);

    const vapiAssistantId = barber.vapi_assistant_id;

    const variableValues = {
      shop_name: barber.shop_name,
      barber_name: barber.name,
      barber_id: barber.id,
      address: barber.address || "",
      working_hours_start: formatWorkHour(workStart),
      working_hours_end: formatWorkHour(workEnd),
      working_days: formatWorkingDays(barber.working_days),
      available_slots: availableStr,
    };

    const response: any = {};

    if (vapiAssistantId) {
      response.assistantId = vapiAssistantId;
      response.assistantOverrides = {
        variableValues,
      };
    } else {
      response.assistant = {
        firstMessage: `Hola, gracias por llamar a ${barber.shop_name}. ¿Te gustaría agendar una cita?`,
        variableValues,
      };
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vapi-assistant-request error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
