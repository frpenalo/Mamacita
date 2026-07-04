# Claude-Ready PRD Summary: Agente de Citas por WhatsApp (Mamacita)

## What we're building
Un **agente conversacional de texto por WhatsApp** que atiende a los clientes de un barbero o
barbería para **agendar, reprogramar y cancelar citas a hora fija**, con recordatorios
automáticos. Es un **producto autónomo** (independiente del agente de voz Julie y de la cola
walk-in de NXTUP), para negocios que quieren que su clientela agende sola por texto. Reutiliza el
modelo de citas ya existente en el repo (antes `tu-cita-pro`, hoy Mamacita).

## Suggested stack
- **Frontend:** Vite + React + TS + shadcn/ui + Tailwind (dashboard ya existente, estilo "lujo premium")
- **Backend/DB:** Supabase — Postgres + Edge Functions (Deno) + Auth + RLS + pg_cron
- **Canal:** Twilio WhatsApp Business API (sender de prod `+19844009792`, ya verificado con Meta) → Meta Cloud API a escala
- **Cerebro:** **GPT-4o-mini de OpenAI** (`https://api.openai.com/v1/chat/completions`, function calling) — requiere el secret `OPENAI_API_KEY`
- **Hosting:** Vercel (dashboard) + Supabase (backend). **Dominio:** existente del repo
- **Auth:** barbero/dueño = email+password (Supabase Auth). Cliente = sin login (se identifica por su número de WhatsApp)

## MVP — what to build first
- Agendar por WhatsApp con **disponibilidad real** (citas + `blocked_times` + horario) y **reserva atómica** anti-choque
- Confirmación **al instante** (opción A: la cita nace confirmada)
- Reprogramar y cancelar (cliente por WhatsApp; barbero por WhatsApp/dashboard)
- Elegir barbero **solo si** la cuenta tiene varios
- Recordatorios automáticos: **24 h + ~2 h** antes
- Aviso al barbero de cada cita con botones **Confirmar / Rechazar** (quick-reply)
- Reutilizar el dashboard existente (agenda, horario, bloqueos, acciones de cita, clientes)
- **Número compartido** + **link personalizado por cuenta** (`wa.me/19844009792?text=agendar-con-<código>`)

## Key product decisions made
- **Modelo:** cita a **hora fija** (no walk-in) — mercado NC
- **Confirmación instantánea** (opción A), el barbero solo interviene ante imprevistos
- **Cuentas:** barbero individual (paga, su dashboard) **o** barbería (dueño paga, su dashboard). **Mixto → v2** (modelo lo soporta, no se construye)
- **Cliente sin login** — todo por WhatsApp
- **Onboarding asistido** en la prueba (admin da de alta 2-3 barberos); formulario self-service → v2
- **Número compartido** por defecto; **número dedicado = premium/add-on → v2**
- **Puerta abierta al bundle:** `shops.business_id` común + `shops.enabled_products`; hoy independiente, mañana sincronizable con voz + queue bajo control de Mamacita
- **`tu-cita-pro` = Mamacita:** mismo repo, nombre viejo del remoto de GitHub (pendiente renombrar)

## Do NOT build yet (v2+)
- Elegir **servicio** (duración/precio por servicio)
- **Pago / depósito** en línea
- **Cuenta mixta** (barbería + barberos pagando aparte)
- **Número dedicado** por cuenta
- **Formulario de auto-registro** público
- **Bundle sincronizado** con voz/queue (solo dejar los ganchos de datos)

## Implementation order
1. **Webhook entrante de Twilio + ruteo por código** (identificar cuenta/barbero) — desbloquea todo el canal de texto
2. **Motor de disponibilidad reutilizado** (`slots.ts`) expuesto a las edge functions: `get_slots`
3. **Agendar con reserva atómica** (`book`) — el corazón; incluye el candado anti-choque
4. **Agente LLM con function calling** (get_slots / book / reschedule / cancel) + amarre `wa_sessions`
5. **Aviso al barbero + Confirmar/Rechazar** (quick-reply + actualización de estado)
6. **Recordatorios** (`reminders` + pg_cron: 24 h y 2 h)
7. **Reprogramar / cancelar** por WhatsApp (cliente) enlazados al dashboard existente
8. **Plantillas Twilio/Meta** registradas y aprobadas (es/en) para todo lo que sale de la ventana de 24 h

## Roles & auth
- **Cliente final:** sin login; identidad = número de WhatsApp; vínculo con barbero por el link
- **Barbero individual:** email+password; ve solo su agenda
- **Dueño de barbería:** email+password; ve todos sus barberos
- **Admin (Mamacita):** alta de cuentas, links, soporte, bundle

## Data model (key entities)
- **Reutilizadas:** `shops` (+ `business_id`, `enabled_products`), `professionals` (+ `wa_code`), `appointments`, `availability_slots`, `blocked_times`
- **Nuevas:** `wa_sessions` (amarre cliente→barbero), `wa_messages` (log), `reminders` (cola pg_cron)
- **RLS por `shop_id`** desde el día 1 (la PII del cliente = `client_phone` aislada por cuenta)

## Watch out for
- **Race condition al agendar** dos clientes el mismo hueco → reserva atómica obligatoria (mismo patrón que el fix de NXTUP: UPDATE/INSERT condicional + verificar que ganaste)
- **Cliente con dos barberos** en el mismo número compartido → re-amarrar por último link o preguntar
- **Ventana de 24 h de WhatsApp** → fuera de ella solo salen **plantillas aprobadas** (registrar es/en en Twilio/Meta)
- **Calidad compartida del número** → si se degrada, afecta a todas las cuentas; cuidar spam/opt-out (de ahí el upsell a número dedicado)
- **Recordatorios obsoletos** → cancelarlos si la cita se mueve/cancela
- **No acoplar a NXTUP/voz** hoy, pero **no cerrar** la puerta del bundle (mantener `business_id`/`enabled_products`)
- **RLS de PII** — no repetir la brecha de NXTUP; aislar `client_phone` por cuenta desde el inicio
