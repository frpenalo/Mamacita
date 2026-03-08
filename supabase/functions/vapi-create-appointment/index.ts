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

    // Only process tool-calls; ignore all other message types
    if (message?.type !== "tool-calls") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolCall = message.toolCallList?.[0];
    const toolCallId = toolCall?.id ?? null;
    const args = toolCall?.function?.arguments ?? {};

    const { barber_id, customer_name, customer_phone, start_time } = args;

    if (!barber_id || !customer_name || !customer_phone || !start_time) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    await supabase
      .from("availability_slots")
      .update({ status: "available" })
      .eq("barber_id", barber_id)
      .eq("status", "held")
      .lt("hold_expires_at", new Date().toISOString());

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
      const msg =
        lang === "es"
          ? "Ese horario se superpone con otra cita existente. Permíteme buscar otra opción."
          : "That time overlaps with another existing appointment. Let me check another available time.";

      return new Response(
        JSON.stringify({ results: [{ toolCallId, result: msg }] }),
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
      const msg =
        lang === "es"
          ? "Ese horario acaba de ser reservado por otra persona. Permíteme buscar otra opción."
          : "That time was just booked by someone else. Let me check another available time.";

      return new Response(
        JSON.stringify({ results: [{ toolCallId, result: msg }] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ✅ 4️⃣ FIND OR CREATE CUSTOMER
    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id, total_visits")
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
        throw new Error("Customer creation failed");
      }
      customerId = newCustomer.id;
    }

    // ✅ 5️⃣ CREATE APPOINTMENT
    const appointmentCode = generateCode();

    const { data: appointment, error } = await supabase
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

    if (error || !appointment) {
      throw new Error("Appointment creation failed");
    }

    // ✅ 6️⃣ CONFIRM SLOT
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

    return new Response(
      JSON.stringify({
        results: [{
          toolCallId: toolCallId,
          result: confirmation,
        }],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("create-appointment error:", err);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
