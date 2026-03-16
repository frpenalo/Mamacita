const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, "");
  if (!cleaned.startsWith("+")) {
    cleaned = cleaned.startsWith("1") ? `+${cleaned}` : `+1${cleaned}`;
  } else if (cleaned.startsWith("+") && !cleaned.startsWith("+1") && cleaned.length <= 11) {
    cleaned = `+1${cleaned.slice(1)}`;
  }
  return `whatsapp:${cleaned}`;
}

function formatDateEST(isoString: string): string {
  const date = new Date(isoString);
  const formatter = new Intl.DateTimeFormat("es-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return formatter.format(date) + " EST";
}


async function sendWhatsAppTemplate(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to);
  params.append("ContentSid", contentSid);
  params.append("ContentVariables", JSON.stringify(contentVariables));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();
    if (res.ok) {
      console.log(`[whatsapp] Template sent to ${to}, SID: ${data.sid}`);
      return { success: true, sid: data.sid };
    } else {
      console.error(`[whatsapp] Template failed to ${to}:`, data);
      return { success: false, error: data.message || "Unknown error" };
    }
  } catch (err) {
    console.error(`[whatsapp] Template error to ${to}:`, err);
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth guard: require FUNCTION_SECRET or valid Supabase JWT
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("FUNCTION_SECRET");
  
  const hasFunctionSecret = !!expectedSecret && authHeader === `Bearer ${expectedSecret}`;
  
  let authenticated = hasFunctionSecret;
  
  if (!authenticated && authHeader) {
    // Validate JWT via Supabase auth
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseClient.auth.getUser();
    authenticated = !!user;
  }
  
  if (!authenticated) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      customer_phone,
      customer_name,
      shop_name,
      barber_name,
      barber_phone,
      address,
      start_time,
      appointment_code,
    } = await req.json();

    if (!customer_phone || !customer_name || !start_time || !appointment_code) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const fromNumber = "whatsapp:+19844009792";

    const formattedDate = formatDateEST(start_time);

    // Message to customer
    const customerMsg = `Hola ${customer_name} 👋\n\nTu cita en ${shop_name || "la barbería"} está confirmada ✅\n\n📅 ${formattedDate}\n💈 Con ${barber_name || "tu barbero"}\n📍 Código de cita: ${appointment_code}\n\nPara cancelar o reprogramar responde a este mensaje.`;

    const customerResult = await sendWhatsApp(
      accountSid,
      authToken,
      fromNumber,
      formatPhoneForWhatsApp(customer_phone),
      customerMsg
    );

    // Message to barber using template (if phone provided)
    let barberResult = { success: false, error: "No barber phone provided" };
    if (barber_phone) {
      barberResult = await sendWhatsAppTemplate(
        accountSid,
        authToken,
        fromNumber,
        formatPhoneForWhatsApp(barber_phone),
        "HXbf9b535ab2519063b8b3a2f0e99f8580",
        {
          "1": customer_name,
          "2": customer_phone,
          "3": formattedDate,
          "4": appointment_code,
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        customer: customerResult,
        barber: barberResult,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[whatsapp] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
