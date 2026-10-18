# Agente de Citas (WhatsApp) — Traspaso / Arranque de chat

> Documento de orientación para el chat dedicado al **agente de citas**. Léelo primero,
> luego el PRD. Fecha de traspaso: **18-oct-2026**.

## Qué es
Agente conversacional de **citas por WhatsApp (texto)**, un **producto INDEPENDIENTE** de
Julie (que es VOZ y solo hace walk-ins). Bajo la sombrilla Mamacita. El cliente agenda,
reprograma, cancela y recibe recordatorios por texto; el barbero gestiona por WhatsApp.

## Estado real (clave)
**Está SUSTANCIALMENTE CONSTRUIDO, no es greenfield.** Se probó hasta **jul-2026** (32 citas
de prueba en la base, todas mar–jul; **idle desde entonces**). El **primer trabajo del chat
nuevo NO es construir, es AUDITAR el estado actual y correr una prueba end-to-end fresca**
(lleva ~3 meses sin usarse), y de ahí decidir qué falta para producción.

## Dónde vive (leer en este orden)
- **PRD:** `planning/product/whatsapp-citas/prd-full.md` (+ `prd-summary.md`).
- **Webhook entrante / orquestador:** `supabase/functions/whatsapp-inbound/index.ts`
  (verifica firma Twilio, transcribe notas de voz, rutea por `wa_code` del link o por sesión,
  distingue citas vs walk-in vs desconocido en el número compartido, dispara el agente).
- **Agente LLM:** `supabase/functions/_shared/agent.ts` (`runAgent`).
- **Lógica de citas:** `_shared/appointments.ts` · **Barbero (aceptar/modificar/cancelar):**
  `_shared/barber.ts` · **Negociación de cambios:** `_shared/negotiation.ts` ·
  **Recordatorios:** `_shared/reminders.ts` + función `send-reminders` ·
  **Notas de voz:** `_shared/transcribe.ts` · **Idiomas:** `_shared/i18n.ts`.
- **Datos (migraciones):** `whatsapp_citas_foundation`, `appointments_atomic_booking`,
  `barber_lookup`, `barbers_whatsapp_unique`, `barber_services_pricing`, `negotiations`,
  `per_day_hours`, `wa_sessions_lang`.
- **Tablas:** `barbers`, `appointments`, `wa_sessions`, `wa_messages`, `negotiations`,
  `customers`.

## OJO con el modelo de entidades
El agente de citas usa una tabla **`barbers`** (modelo heredado de tu-cita-pro: `timezone`,
`working_days`, `working_hours`, `appointment_duration`, `services`, `surcharge_*`, `wa_code`),
que es **SEPARADA** de las tablas del walk-in (`shops` / `professionals`). No son la misma
entidad. Entender y, si hace falta, reconciliar este punto es parte del trabajo.

## Canal e infraestructura (al 18-oct-2026)
- **Número WhatsApp COMPARTIDO con el walk-in:** `+19844009792` (long-code, cuenta Twilio de
  **Softmedia**). El inbound ya separa quién es cliente de citas, quién es del walk-in, y quién
  es desconocido (fallback educado). **Cuidado:** tocar este flujo puede afectar al walk-in,
  que está VIVO.
- **A2P 10DLC aprobado.** Páginas legales en prod (`tumamacita.com/privacy`, `/terms`).
  Advanced Opt-Out (STOP/HELP) activo en Twilio.
- **SMS fallback de WhatsApp** ya construido para el walk-in (`twilio-message-status` +
  tabla `message_deliveries` + `_shared/sms.ts`): si un WhatsApp al cliente no entrega, sale
  SMS. Evaluar si el agente de citas quiere el mismo fallback para sus confirmaciones.
- **Plantillas WhatsApp (Twilio Content) aprobadas:** `appointment_confirmation` (HXa99c…),
  `reminder_2h`/`reminder_24h` es/en, `cita_nueva_barbero`. El aviso al barbero se recreó como
  `barber_notification_v2_es` (`HXd37a420211782f5c4fac09b0c677f2a6`) y está **PENDIENTE de
  aprobación** (verificar antes de usar). La conversación entrante usa **freeform** (ventana de
  24h, porque el cliente inicia); las plantillas son para mensajes business-initiated fuera de
  esa ventana (confirmaciones/recordatorios).
- **Activación:** cada barbero tiene un `wa_code`; el cliente escribe `agendar-XXXXXX` al número
  compartido para amarrarse a ese barbero (o continúa su sesión existente por teléfono).

## Convenciones técnicas (repo mamacita)
- Supabase Edge Functions (Deno). `verify_jwt = false` por función en `config.toml`.
  `FUNCTION_SECRET` para llamadas internas; service role para DB.
- Deploy sin Docker: `supabase functions deploy <fn> --use-api`. Migraciones:
  `SUPABASE_DB_PASSWORD='Prueba@2026' supabase db push`. Proyecto `kpgseyfkucnnzdaoqjdq`.
- Firma Twilio verificada en `whatsapp-inbound` (HMAC-SHA1; `TWILIO_WEBHOOK_URL` como override).
- Para leer/escribir la base de forma puntual: patrón de **función admin efímera** (desplegar
  fn de un uso con guard `x-admin-secret`, invocar, BORRAR y verificar 404).
- Repo `github.com/frpenalo/Mamacita`, deploy web en Vercel (equipo Softmedia).

## NO tocar
Julie (voz) y la cola walk-in están en producción. El número de WhatsApp es compartido: validar
que cualquier cambio en `whatsapp-inbound` o en las plantillas no rompa el walk-in.

## Decisiones abiertas (las define Francisco, no el código)
1. **Barbero/piloto** con quién re-probar y lanzar.
2. **Número:** ¿se queda en el número compartido de Softmedia, o cada barbero con su propio
   número (BYON)? (Una cuenta Twilio = una WABA; las plantillas se comparten por WABA.)
3. **Pricing / posicionamiento** del producto (es aparte de Julie y del queue de NXTUP).
4. **Relación con NXTUP:** ¿producto directo de Mamacita, o se integra/vende vía NXTUP?

## Primer paso sugerido del chat nuevo
Leer PRD + `whatsapp-inbound` + `agent.ts`, auditar el estado funcional actual, y correr una
**prueba end-to-end** (link de activación → agendar → confirmar → recordatorio) con un barbero
de prueba. Reportar qué funciona y qué no ANTES de tocar código.
