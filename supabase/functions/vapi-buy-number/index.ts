import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapiKey = Deno.env.get("VAPI_PRIVATE_KEY")!;

    // Verify the calling user
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { barber_id, shop_name } = await req.json();

    if (!barber_id || !shop_name) {
      return new Response(JSON.stringify({ error: "barber_id and shop_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the barber_id belongs to the authenticated user
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: barberCheck } = await supabaseAdmin
      .from("barbers")
      .select("id")
      .eq("id", barber_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!barberCheck) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Vapi to buy a phone number
    console.log(`[vapi-buy-number] Purchasing number for barber ${barber_id}, shop: ${shop_name}`);
    const vapiRes = await fetch("https://api.vapi.ai/phone-number", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vapiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "vapi",
        assistantId: "155157c5-6884-4fb2-a734-de26675ed69e",
        server: {
          url: `${supabaseUrl}/functions/v1/vapi-assistant-request`,
        },
        name: `${shop_name} - MamaCita`,
      }),
    });

    const vapiData = await vapiRes.json();
    console.log(`[vapi-buy-number] Vapi response status: ${vapiRes.status}`, JSON.stringify(vapiData));

    if (!vapiRes.ok) {
      return new Response(JSON.stringify({ error: "Vapi API error", details: vapiData }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract the phone number (E164) and vapi IDs
    // Vapi returns phoneNumber (not number) for the E164 formatted number
    const phoneNumber = vapiData.phoneNumber || vapiData.number || null;
    const vapiPhoneNumberId = vapiData.id;
    console.log(`[vapi-buy-number] Extracted phoneNumber: ${phoneNumber}, id: ${vapiPhoneNumberId}`);

    // Update barber record with service role client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { error: updateError } = await supabaseAdmin
      .from("barbers")
      .update({
        phone_number: phoneNumber,
        vapi_phone_number_id: vapiPhoneNumberId,
      })
      .eq("id", barber_id);

    if (updateError) {
      console.error(`[vapi-buy-number] DB update error:`, updateError);
      return new Response(JSON.stringify({ error: "Failed to update barber", details: updateError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[vapi-buy-number] Success! Assigned ${phoneNumber} to barber ${barber_id}`);

    return new Response(JSON.stringify({ phone_number: phoneNumber }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[vapi-buy-number] Unexpected error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
