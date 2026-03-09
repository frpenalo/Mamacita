import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REWARD_PER_REFERRAL = 5; // $5 per active referral per month

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify service role key
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    // Accept either service role key or anon key (for cron jobs)
    if (authHeader !== serviceRoleKey && authHeader !== anonKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all barbers with active referrals
    const { data: referralCounts, error: countError } = await supabaseAdmin
      .from("referrals")
      .select("referrer_barber_id")
      .eq("status", "active");

    if (countError) {
      console.error("[accrue] Error fetching referrals:", countError);
      throw countError;
    }

    // Count active referrals per barber
    const countsByBarber: Record<string, number> = {};
    for (const r of referralCounts || []) {
      countsByBarber[r.referrer_barber_id] = (countsByBarber[r.referrer_barber_id] || 0) + 1;
    }

    // Update each barber's balance
    let updated = 0;
    for (const [barberId, count] of Object.entries(countsByBarber)) {
      const reward = count * REWARD_PER_REFERRAL;
      
      const { error: updateError } = await supabaseAdmin.rpc("increment_referral_balance", {
        barber_id: barberId,
        amount: reward,
      });

      if (updateError) {
        console.error(`[accrue] Failed to update barber ${barberId}:`, updateError);
      } else {
        console.log(`[accrue] Barber ${barberId}: +$${reward} (${count} referrals)`);
        updated++;
      }
    }

    console.log(`[accrue] Updated ${updated} barbers`);

    return new Response(
      JSON.stringify({ success: true, updated, total_barbers: Object.keys(countsByBarber).length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[accrue] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
