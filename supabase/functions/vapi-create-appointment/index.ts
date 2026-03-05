import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Support both direct body params and Vapi tool-call structure
    const args =
      body?.message?.toolCallList?.[0]?.function?.arguments ||
      body;

    const { barber_id, customer_name, customer_phone, start_time } = args;

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
      // Increment total_visits
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
        return new Response(
          JSON.stringify({ error: "Failed to create customer", detail: custErr?.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      customerId = newCustomer.id;
    }

    // 2. Calculate end_time
    // start_time comes as EST (no timezone info), convert to UTC by adding 5 hours
    const estDate = new Date(start_time);
    const EST_OFFSET_MS = 5 * 60 * 60 * 1000;
    const startDate = new Date(estDate.getTime() + EST_OFFSET_MS);
    const endDate = new Date(startDate.getTime() + SLOT_DURATION * 60000);

    // 3. Generate unique appointment code
    const appointmentCode = generateCode();

    // 4. Create appointment
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
      return new Response(
        JSON.stringify({ error: "Failed to create appointment", detail: apptErr?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Update availability_slot if exists
    await supabase
      .from("availability_slots")
      .update({ status: "confirmed" })
      .eq("barber_id", barber_id)
      .eq("start_time", startDate.toISOString())
      .eq("status", "held");

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
