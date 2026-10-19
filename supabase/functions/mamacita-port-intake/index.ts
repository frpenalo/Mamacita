// mamacita-port-intake — ENLACE SEGURO de un solo uso para que el DUEÑO meta la data
// sensible del porte (cuenta/PIN/dirección/factura/LOA). Alojado por Mamacita (Softmedia),
// NO por NXTUP. GET muestra el formulario (por token); POST guarda los datos, sube la
// factura al bucket privado 'port-docs', marca el request 'submitted' e invalida el token.
//
// Público pero token-gated: el token es aleatorio, de un solo uso y expira. No muestra datos
// ya guardados; solo permite completar un request en estado 'collecting'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const page = (title: string, bodyHtml: string) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f7f9; color:#1b1b1f; margin:0; padding:24px; }
  .card { max-width:520px; margin:0 auto; background:#fff; border:1px solid #e4e6eb; border-radius:14px; padding:22px; }
  h1 { font-size:20px; margin:0 0 6px; }
  p.sub { color:#5b5f66; margin:0 0 18px; font-size:14px; }
  label { display:block; font-weight:600; font-size:14px; margin:14px 0 6px; }
  input[type=text], input[type=password] { width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid #cfd2d8; border-radius:9px; font-size:15px; }
  input[type=file] { width:100%; margin-top:4px; font-size:14px; }
  .loa { background:#f0f1f4; border-radius:9px; padding:12px; font-size:13px; color:#3a3d44; margin-top:16px; }
  .consent { display:flex; gap:9px; align-items:flex-start; margin-top:12px; font-size:14px; }
  button { margin-top:20px; width:100%; background:#111; color:#fff; border:0; border-radius:10px; padding:13px; font-size:16px; font-weight:600; cursor:pointer; }
  .note { font-size:12px; color:#7a7e86; margin-top:14px; }
</style></head><body><div class="card">${bodyHtml}</div></body></html>`;

const htmlResp = (html: string, status = 200) =>
  new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Token desde query (GET) o form (POST).
  let token = new URL(req.url).searchParams.get("token") || "";
  let form: FormData | null = null;
  if (req.method === "POST") {
    form = await req.formData();
    token = String(form.get("token") || token);
  }

  if (!token) {
    return htmlResp(page("Enlace inválido", `<h1>Enlace inválido</h1><p class="sub">Falta el código del enlace. Pídele a tu proveedor el enlace completo.</p>`), 400);
  }

  const { data: row } = await supabase
    .from("number_port_requests")
    .select("id, phone_number, carrier_name, status, port_token_expires_at")
    .eq("port_token", token)
    .eq("status", "collecting")
    .maybeSingle();

  const expired = row?.port_token_expires_at && new Date(row.port_token_expires_at).getTime() < Date.now();
  if (!row || expired) {
    return htmlResp(page("Enlace no disponible", `<h1>Enlace no disponible</h1><p class="sub">Este enlace ya se usó o expiró. Pídele a tu proveedor uno nuevo.</p>`), 410);
  }

  // --- GET: mostrar el formulario ---
  if (req.method === "GET") {
    return htmlResp(page("Portar tu número", `
      <h1>Portar tu número a tu asistente</h1>
      <p class="sub">Número a portar: <strong>${esc(row.phone_number)}</strong>${row.carrier_name ? ` · Operador: ${esc(row.carrier_name)}` : ""}</p>
      <form method="POST" enctype="multipart/form-data">
        <input type="hidden" name="token" value="${esc(token)}">
        <label>Número de cuenta con tu operador</label>
        <input type="text" name="carrier_account_number" required autocomplete="off">
        <label>PIN o clave de portabilidad</label>
        <input type="password" name="carrier_pin" required autocomplete="off">
        <label>Dirección de servicio (la de tu cuenta)</label>
        <input type="text" name="service_address" required autocomplete="off">
        <label>Foto o PDF de una factura reciente</label>
        <input type="file" name="bill" accept="image/*,application/pdf">
        <div class="loa">
          <strong>Autorización de portabilidad (LOA)</strong><br>
          Autorizo la transferencia del número ${esc(row.phone_number)} desde mi operador actual.
          Confirmo que soy el titular o estoy autorizado a solicitar este cambio.
        </div>
        <label>Tu nombre completo (firma)</label>
        <input type="text" name="loa_signer_name" required autocomplete="off">
        <label class="consent"><input type="checkbox" name="loa_consent" value="yes" required> Acepto la autorización de portabilidad de arriba.</label>
        <button type="submit">Enviar</button>
        <p class="note">Tus datos se usan solo para portar tu número y se guardan de forma segura.</p>
      </form>`));
  }

  // --- POST: guardar ---
  if (req.method === "POST" && form) {
    if (form.get("loa_consent") !== "yes") {
      return htmlResp(page("Falta la autorización", `<h1>Falta la autorización</h1><p class="sub">Debes aceptar la autorización de portabilidad. Vuelve atrás e inténtalo de nuevo.</p>`), 400);
    }
    const account = String(form.get("carrier_account_number") || "").trim();
    const pin = String(form.get("carrier_pin") || "").trim();
    const addr = String(form.get("service_address") || "").trim();
    const signer = String(form.get("loa_signer_name") || "").trim();
    if (!account || !pin || !signer) {
      return htmlResp(page("Faltan datos", `<h1>Faltan datos</h1><p class="sub">Completa cuenta, PIN y tu nombre. Vuelve atrás e inténtalo de nuevo.</p>`), 400);
    }

    // Subir la factura (si vino) al bucket privado.
    let billPath: string | null = null;
    const file = form.get("bill");
    if (file && file instanceof File && file.size > 0) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
      const path = `${row.id}/${Date.now()}-${safe}`;
      // Subir con el cliente supabase-js (la REST de storage rechaza la service key no-JWT).
      const { error: upErr } = await supabase.storage
        .from("port-docs")
        .upload(path, await file.arrayBuffer(), { contentType: file.type || "application/octet-stream", upsert: true });
      if (upErr) {
        console.error("[port-intake] bill upload failed:", upErr.message);
        billPath = null; // no bloquear el envío por la factura; ops puede pedirla aparte
      } else {
        billPath = path;
      }
    }

    const { error: upErr } = await supabase
      .from("number_port_requests")
      .update({
        carrier_account_number: account,
        carrier_pin: pin,
        service_address: addr || null,
        bill_url: billPath,
        loa_signer_name: signer,
        loa_signed_at: new Date().toISOString(),
        status: "submitted",
        port_token: null,                 // un solo uso: invalidar
        port_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) {
      console.error("[port-intake] update failed:", upErr.message);
      return htmlResp(page("Error", `<h1>Algo salió mal</h1><p class="sub">No pudimos guardar tus datos. Intenta de nuevo en un momento.</p>`), 500);
    }

    console.log(`[port-intake] port_request ${row.id} completed by owner (submitted)`);
    return htmlResp(page("Listo", `<h1>¡Listo! 🎉</h1><p class="sub">Recibimos tu información. Vamos a procesar el porte de ${esc(row.phone_number)} y te avisaremos del avance. Puede tardar unos días hábiles.</p>`));
  }

  return htmlResp(page("No permitido", `<h1>No permitido</h1>`), 405);
});
