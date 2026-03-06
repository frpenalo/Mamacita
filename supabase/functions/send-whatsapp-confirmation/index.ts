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

async function sendWhatsApp(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = btoa(`${accountSid}:${authToken}`);

  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", to);
  params.append("Body", body);

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
      console.log(`[whatsapp] Sent to ${to}, SID: ${data.sid}`);
      return { success: true, sid: data.sid };
    } else {
      console.error(`[whatsapp] Failed to send to ${to}:`, data);
      return { success: false, error: data.message || "Unknown error" };
    }
  } catch (err) {
    console.error(`[whatsapp] Error sending to ${to}:`, err);
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      customer_phone,
      customer_name,
      shop_name,
      barber_name,
      barber_phone,
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
    const fromNumber = "whatsapp:+14155238886";

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

    // Message to barber (if phone provided)
    let barberResult = { success: false, error: "No barber phone provided" };
    if (barber_phone) {
      const barberMsg = `Nueva cita agendada 📅\n\n👤 Cliente: ${customer_name}\n📞 Teléfono: ${customer_phone}\n🕐 Hora: ${formattedDate}\n🔑 Código: ${appointment_code}`;

      barberResult = await sendWhatsApp(
        accountSid,
        authToken,
        fromNumber,
        formatPhoneForWhatsApp(barber_phone),
        barberMsg
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
