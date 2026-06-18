# Mamacita — Walk-in Queue Spec

**Última actualización:** 2026-06-10
**Status:** spec activo del sprint en curso
**Propósito:** describir el flujo conversacional, el data model y los componentes que el sprint actual debe entregar.

---

## El producto en una frase

Mamacita es la recepcionista de voz que contesta el teléfono de un negocio walk-in (hoy barberías) y agrega al cliente a la lista de espera del local sin que el dueño tenga que parar lo que está haciendo.

**Visión más amplia:** Mamacita es una plataforma de agente de voz para pequeños negocios en general (no solo barberías). El walk-in queue de barberías es el primer vertical por la coyuntura NXTUP. El núcleo (contestar, conversar, capturar datos, notificar por WhatsApp) es genérico; el vertical es configuración encima.

---

## Decisiones de scope del piloto (2026-06-10)

| Decisión | Valor |
|---|---|
| Primer cliente piloto | Un shop de NXTUP (ej. Fade Factory) — gratis durante el piloto |
| UI de la cola para el piloto | La de NXTUP (TV display, kiosk de entrada, PWA de barberos). Mamacita NO construye dashboard de cola para el piloto |
| Lado NXTUP de la integración | Lo construye Francisco mismo en el repo nxtup (endpoints de availability + insert a cola + webhook de turno) |
| Número de teléfono | Desvío condicional: el shop mantiene su número; si no contesta u ocupado, la llamada cae a Mamacita |
| Llamadas que el agente no puede resolver | Toma mensaje (nombre, teléfono, motivo) y avisa al dueño por WhatsApp. NO transfiere llamadas |
| Idiomas | Español + inglés con auto-detect |
| Aviso "ya casi te toca" | Combinado: NXTUP sabe la posición en cola y dispara webhook → Mamacita manda el WhatsApp (ya tiene el canal abierto con el cliente) |
| Onboarding | White-glove: Francisco monta cada negocio a mano. Sin frontend de onboarding por ahora |
| Billing | DIFERIDO — piloto gratis, refactor de Stripe fuera del sprint. Pricing standalone se define después con costos VAPI reales |
| Visibilidad del dueño | Solo la cola resultante (que en el piloto vive en NXTUP). Transcripciones/métricas/audio son fase posterior |

## El flujo conversacional (happy path)

1. Cliente llama al número del shop
2. VAPI contesta: *"Hola, gracias por llamar a {shop_name}. ¿En qué te puedo ayudar?"*
3. Cliente: *"¿Hay barberos disponibles?"* / *"¿Puedo pasar?"* / *"¿Cuánto es la espera?"*
4. VAPI consulta estado del shop:
   - Cuenta `professionals` con `current_status = 'available'`
   - Cuenta `queue_entries` con status en (`waiting`, `arrived`) para estimar espera
5. VAPI responde:
   - *"Sí, ahora mismo tenemos 2 barberos libres, puedes venir directo"*
   - *"Hay 3 personas esperando, el tiempo estimado es 25 minutos"*
   - *"En este momento no hay barberos disponibles, cerramos a las 8pm"*
6. Cliente pregunta info adicional (dirección, horarios, servicios, precios) — VAPI contesta desde los campos del shop
7. Si cliente confirma que va:
   - VAPI captura **nombre + teléfono**
   - Crea `queue_entry` con `status = 'waiting'`, `joined_at = now()`, `eta_at = now() + espera_estimada`
   - Genera `check_in_code` (4 chars)
   - Devuelve mensaje: *"Listo {nombre}, te agregamos a la lista. Te mando un WhatsApp con la dirección y tu código de check-in"*
8. Edge function dispara WhatsApp con: dirección, link de Google Maps, ETA, código de check-in
9. Cliente viaja al shop
10. Cliente llega → da código en el mostrador (o lo escanea en un tablet futuro)
11. Staff o dueño marca `arrived_at = now()`, status pasa a `arrived`
12. El siguiente profesional disponible toma al primer cliente con status `arrived` (FIFO)
13. Cuando empieza el servicio: status → `in_service`, `assigned_professional_id = X`, `served_at = now()`
14. Al terminar: status → `served`, `completed_at = now()`

## Edge cases del MVP

- **Cliente dice "voy" pero nunca llega:** después de `queue_timeout_minutes` (default 30 min) desde `eta_at`, un cron marca `status = 'no_show'`
- **No hay barberos en este momento:** VAPI ofrece guardar el cliente para llamarlo cuando haya disponibilidad (Fase 2)
- **Cliente quiere cancelar:** VAPI no maneja cancelaciones por ahora — el cliente avisa al shop directamente
- **Cliente pregunta por un barbero específico ("¿está Pedro?"):** Fase 2. MVP solo dice cuántos hay disponibles, no quiénes.
- **Shop cerrado / fuera de horario:** VAPI dice horario de apertura y no agrega a cola

## Data model

### Tablas nuevas

**`shops`** — el negocio (barbería, salón, clínica)
- `id`, `owner_user_id` (auth), `name`, `phone_number`, `address`, `timezone`
- `whatsapp_number`, `whatsapp_business_number`
- `vapi_assistant_id`, `vapi_phone_number_id`
- `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`
- `referral_code`, `referral_balance`, `referral_credits`
- `default_service_duration_minutes` (para estimar espera, default 45)
- `queue_timeout_minutes` (default 30)
- `services_text` (free-form para que VAPI mencione servicios + precios)

**`professionals`** — la persona que atiende
- `id`, `shop_id`, `user_id` (opcional si tiene login propio)
- `name`, `avatar_url`
- `current_status` ENUM: `available` | `busy` | `break` | `off`
- `status_updated_at`
- `working_days`, `working_hours_start`, `working_hours_end`
- `appointment_duration` (para Fase 2)
- `display_order`, `active`

**`queue_entries`** — cliente en lista de espera
- `id`, `shop_id`, `customer_id` (FK, nullable hasta que se cree el customer)
- `customer_name`, `customer_phone` (snapshot)
- `joined_at` (momento de la llamada)
- `eta_at` (estimado de llegada)
- `arrived_at`, `served_at`, `completed_at` (timestamps de transición)
- `assigned_professional_id` (FK, nullable, se asigna cuando arranca el servicio)
- `status` ENUM: `waiting` | `arrived` | `in_service` | `served` | `no_show` | `cancelled`
- `check_in_code` (4 chars UNIQUE)
- `source` ENUM: `voice` | `walk-in` | `other`
- `vapi_call_id` (para idempotencia y debugging)
- `notes`

### Tablas existentes — qué pasa con ellas

- **`barbers`**: se preserva. Backfill 1:1 → cada barber existente genera 1 shop + 1 professional. Eventualmente se deprecia cuando todos los reads migren a `shops`/`professionals`.
- **`customers`**: se preserva. Se le agrega `shop_id` (backfill desde `barber_id`).
- **`appointments`**: se preserva sin tocar. **Reservada para Fase 2 paid appointments.**
- **`availability_slots`**: se preserva sin tocar. **Reservada para Fase 2.**
- **`blocked_times`**: se preserva sin tocar. **Reservada para Fase 2.**
- **`referrals`**: se preserva. Apunta a barbers todavía (= shops en práctica).

### Por qué NO borramos las viejas

- Cero riesgo de pérdida de datos
- Permite rollback fácil si el pivot necesita ajustes
- La Fase 2 (citas futuras como paid feature) va a reutilizar `appointments` y `availability_slots` casi intacto
- El cleanup viene en una migración posterior cuando todo el código apunte a las nuevas

## Edge functions: cambios necesarios

| Función | Cambio |
|---|---|
| `vapi-assistant-request` | **Simplificar drásticamente.** Lookup `shop` por `phone_number`. Contar `professionals` con `status='available'`. Contar `queue_entries` activos. Pasar a VAPI: shop info + counts + services_text. Eliminar todo el cálculo de slots de 7 días. |
| `vapi-create-appointment` | **Renombrar mentalmente a `vapi-join-queue`.** Capturar nombre + teléfono. Crear `queue_entry`. Generar `check_in_code`. Devolver código al asistente. |
| `vapi-buy-number` | Pasar de `barber_id` a `shop_id`. Actualizar `shops.phone_number` y `shops.vapi_phone_number_id`. |
| `vapi-end-of-call` | Sin cambios. Sigue usando `call_id` para limpieza. |
| `send-whatsapp-confirmation` | **Mensaje nuevo:** "estás en la lista en {shop_name}, ETA ~{minutos} min, dirección: {address}, Google Maps: {link}, tu código de check-in: {code}". |
| `stripe-webhook` | Subscription pasa a nivel `shops`. |
| `create-checkout-session` | Subscription pasa a nivel `shops`. |

## Frontend: vistas mínimas

### Dashboard del shop (vista en vivo)

- **Cola activa:** lista de `queue_entries` con status (`waiting`, `arrived`), nombre, teléfono, ETA, tiempo en cola, código de check-in. Realtime updates.
- **Profesionales:** tarjetas con nombre, foto, status. Toggle para cambiar status (available/busy/break/off). Realtime.
- **Acciones rápidas:**
  - Marcar cliente como llegado (status → `arrived`)
  - Asignar profesional + arrancar servicio (status → `in_service`, set `assigned_professional_id`)
  - Marcar servicio completado (status → `served`)
  - Marcar no-show manual

### Onboarding nuevo shop

1. Datos del shop: nombre, dirección, horario, timezone
2. Agregar profesionales (mínimo 1)
3. Texto de servicios (free-form para VAPI)
4. Comprar número de teléfono VAPI
5. Suscripción Stripe

## Defaults aplicados al MVP

- **Asignación de profesional:** NO automática al joinear la cola. Se asigna manualmente en check-in (siguiente disponible toma siguiente cliente).
- **Timeout no-show:** 30 minutos desde `eta_at`, cron lo marca.
- **Catálogo de servicios:** sin tabla estructurada. Campo de texto libre que el asistente lee.
- **Estado de profesionales:** manual via dashboard toggle. Sin auto-detección.
- **Idioma:** español inicialmente. Detección automática en Fase 2.
- **Cantidad máxima en cola:** sin límite hard. El asistente menciona la espera para que el cliente decida.

## Scope del sprint piloto (revisado 2026-06-10)

### Dentro del scope — lado Mamacita (status 2026-06-10)
- ✅ Migración SQL (`shops`, `professionals`, `queue_entries`) — **aplicada en producción**
- ✅ Migración SQL (`calls` + columnas NXTUP en shops) — escrita, pendiente de aplicar
- ✅ `vapi-assistant-request` simplificado: lookup shop, disponibilidad vía NXTUP API (con fallback local) o RPC local — **código listo, pendiente deploy**
- ✅ `vapi-join-queue` (nuevo, reemplaza a `vapi-create-appointment` en el flujo walk-in): captura nombre+teléfono, registro local + push HMAC a NXTUP, WhatsApp, idempotente por call id — **código listo, pendiente deploy**
- ✅ `vapi-take-message` (nuevo): captura motivo + contacto, WhatsApp al dueño — **código listo, pendiente deploy**
- ✅ `nxtup-events` (nuevo): receptor de webhooks de NXTUP con verificación HMAC; maneja `turn_approaching` (WhatsApp al cliente), `entry_completed`, `entry_no_show` — **código listo, pendiente deploy**
- ✅ `send-whatsapp-queue-notification` (nuevo): 3 tipos de mensaje (queue_joined, turn_approaching, message_for_owner) — **código listo, pendiente deploy + registrar templates Twilio**
- ✅ `vapi-end-of-call` actualizado: guarda duración/costo/transcript/outcome en `calls` + mantiene release de slots legacy — **código listo, pendiente deploy**
- ✅ Contrato de API documentado en `planning/integration/api-contract.md`
- ⬜ ES/EN auto-detect en el prompt del asistente (config en dashboard VAPI, no en repo)
- ⬜ Cron de no-show (marca `no_show` 30 min después del ETA)
- ⬜ Refactor de `vapi-buy-number` a shops (no bloquea el piloto — el shop piloto ya tiene número)

### Pendiente al activar el piloto real
- ⬜ Setear el `shop_name` y `address` reales del shop piloto en la tabla `shops` de Mamacita
  (hoy es el dato de prueba "The perfect" / "5301 Summit" del backfill). Julie usa `{{shop_name}}`
  tal cual, así que de ahí sale lo que dice por teléfono. Es un UPDATE de una línea.
- ⬜ **Re-vincular NXTUP:** `update shops set nxtup_shop_id='0454a06d-d741-4537-abc1-8728b92a87e2'
  where id='c4798be1-708f-44e6-8f2c-4efb19e9dc03'`. Se desvinculó temporalmente (2026-06-14)
  para que Julie use solo disponibilidad local mientras los endpoints de NXTUP no están en
  producción. `nxtup_api_url` y `nxtup_shared_secret` se conservaron. Re-vincular DESPUÉS del
  merge a producción de NXTUP.

### Tareas externas (Francisco, fuera del repo)
- ⬜ Registrar 3 templates de WhatsApp en Twilio Console (los textos están comentados al inicio de `send-whatsapp-queue-notification/index.ts`) y setear los SIDs como secrets: `TWILIO_TPL_QUEUE_JOINED`, `TWILIO_TPL_TURN_APPROACHING`, `TWILIO_TPL_MSG_FOR_OWNER`
- ⬜ Actualizar el assistant en el dashboard de VAPI: prompt walk-in + tools `join_queue` y `take_message` apuntando a las nuevas functions
- ⬜ Configurar desvío condicional del número del shop piloto al número VAPI

### Dentro del scope — lado NXTUP (repo nxtup, lo construye Francisco)
- `GET /api/shops/[id]/availability` — barberos disponibles + tamaño de cola ahora
- `POST /api/queue/entries` — insertar cliente desde Mamacita (source: voice)
- Webhook saliente a Mamacita cuando el cliente está cerca de su turno

### Fuera de scope del piloto (diferido)
- Refactor de Stripe / billing (piloto gratis)
- Dashboard de cola propio de Mamacita (la UI del piloto es NXTUP; el dashboard propio llega con el primer cliente standalone)
- Onboarding self-serve (white-glove manual)
- Citas futuras como producto paid premium (Fase 2 — tablas preservadas)
- Reservar a un barbero específico por nombre
- Catálogo estructurado de servicios y precios
- SMS además de WhatsApp
- Vocabulario configurable por vertical
- Transcripciones/métricas/audio visibles al dueño (los datos se guardan desde ya, la UI después)
