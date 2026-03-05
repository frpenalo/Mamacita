import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLOT_DURATION = 45; // minutes

function formatTimeAMPM(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
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

function formatWorkingDays(days: string[] | null): string {
  if (!days || days.length === 0) return "No configurado";
  return days.map((d) => DAY_LABELS[d] || d).join(", ");
}

function getSlotsForDate(
  date: Date,
  workStart: string,
  workEnd: string,
  appointments: any[],
  blockedTimes: any[],
  heldSlots: any[],
  now: Date
): string[] {
  const parseTime = (t: string) => {
    const parts = t.split(":");
    return { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) };
  };

  const start = parseTime(workStart);
  const end = parseTime(workEnd);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  const dayStart = new Date(year, month, day, start.hours, start.minutes, 0);
  const dayEnd = new Date(year, month, day, end.hours, end.minutes, 0);

  const slots: { start: Date; end: Date }[] = [];
  let cursor = new Date(dayStart);
  while (cursor.getTime() + SLOT_DURATION * 60000 <= dayEnd.getTime()) {
    slots.push({
      start: new Date(cursor),
      end: new Date(cursor.getTime() + SLOT_DURATION * 60000),
    });
    cursor = new Date(cursor.getTime() + SLOT_DURATION * 60000);
  }

  const available: string[] = [];
  for (const slot of slots) {
    const sStart = slot.start.getTime();
    const sEnd = slot.end.getTime();

    if (sStart < now.getTime()) continue;

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
      if (h.hold_expires_at && new Date(h.hold_expires_at).getTime() < now.getTime()) return false;
      const hStart = new Date(h.start_time).getTime();
      const hEnd = new Date(h.end_time).getTime();
      return hStart < sEnd && hEnd > sStart;
    });
    if (isHeld) continue;

    available.push(formatTimeAMPM(slot.start));
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
      return new Response(JSON.stringify({ error: "Unsupported message type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calledNumber = body?.message?.call?.to;
    if (!calledNumber) {
      return new Response(JSON.stringify({ error: "Missing call.to number" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find barber by phone number
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

    // Get today and tomorrow in EST
    const now = new Date();
    // We work with UTC dates but the slot generation uses local constructor
    // For EST calculations we offset
    const today = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const queryStart = `${todayStr}T00:00:00`;
    const queryEnd = `${tomorrowStr}T23:59:59`;

    // Fetch appointments
    const { data: appointments } = await supabase
      .from("appointments")
      .select("start_time, end_time")
      .eq("barber_id", barber.id)
      .in("status", ["confirmed", "rescheduled"])
      .gte("start_time", queryStart)
      .lte("start_time", queryEnd);

    // Fetch blocked times
    const { data: blockedTimes } = await supabase
      .from("blocked_times")
      .select("start_time, end_time")
      .eq("barber_id", barber.id)
      .lte("start_time", queryEnd)
      .gte("end_time", queryStart);

    // Fetch held slots
    const { data: heldSlots } = await supabase
      .from("availability_slots")
      .select("start_time, end_time, hold_expires_at, held_by_session_id")
      .eq("barber_id", barber.id)
      .eq("status", "held")
      .gte("start_time", queryStart)
      .lte("start_time", queryEnd);

    const nowEST = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

    const todaySlots = getSlotsForDate(today, workStart, workEnd, appointments || [], blockedTimes || [], heldSlots || [], nowEST);
    const tomorrowSlots = getSlotsForDate(tomorrow, workStart, workEnd, appointments || [], blockedTimes || [], heldSlots || [], nowEST);

    let availableStr = "";
    if (todaySlots.length > 0) {
      availableStr += `Hoy: ${todaySlots.join(", ")}`;
    }
    if (tomorrowSlots.length > 0) {
      if (availableStr) availableStr += ". ";
      availableStr += `Mañana: ${tomorrowSlots.join(", ")}`;
    }
    if (!availableStr) {
      availableStr = "No hay horarios disponibles hoy ni mañana";
    }

    const response = {
      assistant: {
        firstMessage: `Hola, gracias por llamar a ${barber.shop_name}. ¿Te gustaría agendar una cita?`,
        variableValues: {
          shop_name: barber.shop_name,
          barber_name: barber.name,
          barber_id: barber.id,
          address: barber.address || "",
          working_hours_start: formatWorkHour(workStart),
          working_hours_end: formatWorkHour(workEnd),
          working_days: formatWorkingDays(barber.working_days),
          available_slots: availableStr,
        },
      },
    };

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
