import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret",
};

const SLOT_DURATION = 45; // minutes
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

  try {
    const body = await req.json();
    const message = body?.message;

    const toolCall =
      message?.type === "tool-calls"
        ? message.toolCallList?.[0]
        : null;

    const toolCallId = toolCall?.id ?? null;
    const args = toolCall?.function?.arguments ?? body;

    const { barber_id, customer_name, customer_phone, start_time } = args;

    if (!barber_id || !customer_name || !customer_phone || !start_time) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: corsHeaders,
      });
    }

    const lang = detectLanguage(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: barber } = await supabase
      .from("barbers")
      .select("timezone")
      .eq("id", barber_id)
      .maybeSingle();

    const tz = barber?.timezone || "America/New_York";

    const startDate = new Date(start_time);
    const endDate = new Date(startDate.getTime() + SLOT_DURATION * 60000);

    // ✅ 1️⃣ RELEASE EXPIRED HELD SLOTS
    const expirationTime = new Date(
      Date.now() - HOLD_EXPIRATION_MINUTES * 60 * 1000
    ).toISOString();

    await supabase
      .from("availability_slots")
      .update({ status: "available" })
      .eq("barber_id", barber_id)
      .eq("status", "held")
      .lt("updated_at", expirationTime);

    // ✅ 2️⃣ PREVENT OVERLAPPING BOOKINGS
    const { data: overlapping } = await supabase
      .from("appointments")
      .select("*")
      .eq("barber_id", barber_id)
      .eq("status", "confirmed")
      .lt("start_time", endDate.toISOString())
      .gt("end_time", startDate.toISOString())
      .maybeSingle();

    if (overlapping) {
      const overlapPayload = {
        status: "duplicate",
        spoken_confirmation:
          lang === "es"
            ? "Ese horario se superpone con otra cita existente. Permíteme buscar otra opción."
            : "That time overlaps with another existing appointment. Let me check another available time.",
      };

      return new Response(
        JSON.stringify({
          results: [{ toolCallId, result: overlapPayload }],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ 3️⃣ SLOT LOCKING (Atomic)
    const { data: lockedSlot } = await supabase
      .from("availability_slots")
      .update({ status: "held" })
      .eq("barber_id", barber_id)
      .eq("start_time", startDate.toISOString())
      .eq("status", "available")
      .select()
      .maybeSingle();

    if (!lockedSlot) {
      const duplicatePayload = {
        status: "duplicate",
        spoken_confirmation:
          lang === "es"
            ? "Ese horario acaba de ser reservado por otra persona. Permíteme buscar otra opción."
            : "That time was just booked by someone else. Let me check another available time.",
      };

      return new Response(
        JSON.stringify({
          results: [{ toolCallId, result: duplicatePayload }],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ 4️⃣ CREATE APPOINTMENT
    const appointmentCode = generateCode();

    const { data: appointment, error } = await supabase
      .from("appointments")
      .insert({
        barber_id,
        customer_id: customer_phone,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        status: "confirmed",
        appointment_code: appointmentCode,
      })
      .select()
      .single();

    if (error || !appointment) {
      throw new Error("Appointment creation failed");
    }

    // ✅ 5️⃣ CONFIRM SLOT
    await supabase
      .from("availability_slots")
      .update({ status: "confirmed" })
      .eq("barber_id", barber_id)
      .eq("start_time", startDate.toISOString());

    const spokenTime = formatTimeInTZ(startDate, tz, lang);

    const confirmation =
      lang === "es"
        ? `Perfecto ${customer_name}. Tu cita está confirmada para las ${spokenTime}. Tu código de confirmación es ${appointmentCode}.`
        : `Perfect ${customer_name}. Your appointment is confirmed for ${spokenTime}. Your confirmation code is ${appointmentCode}.`;

    const resultPayload = {
      status: "confirmed",
      appointment_code: appointmentCode,
      appointment_id: appointment.id,
      spoken_confirmation: confirmation,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    };

    return new Response(
      JSON.stringify({
        results: [{ toolCallId, result: resultPayload }],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("create-appointment error:", err);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: corsHeaders,
    });
  }
});
