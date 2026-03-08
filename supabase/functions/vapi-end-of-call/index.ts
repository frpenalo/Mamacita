import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const messageType = body?.message?.type;

    // Only process end-of-call-report; ignore all other message types
    if (messageType !== "end-of-call-report") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callId = body?.message?.call?.id;
    if (!callId) {
      return new Response(JSON.stringify({ error: "Missing call.id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Release held slots for this session
    const { data, error } = await supabase
      .from("availability_slots")
      .update({
        status: "available",
        hold_expires_at: null,
        held_by_session_id: null,
      })
      .eq("held_by_session_id", callId)
      .eq("status", "held")
      .select();

    if (error) {
      console.error("Error releasing slots:", error);
    }

    console.log(`[end-of-call] Released ${data?.length || 0} held slots for call ${callId}`);

    return new Response(
      JSON.stringify({ ok: true, released_slots: data?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("vapi-end-of-call error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
