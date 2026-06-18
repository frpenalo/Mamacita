# Mamacita — Claude context

## Qué es

**Plataforma de agente de voz IA para pequeños negocios y emprendedores.** El núcleo: contestar el teléfono del negocio, conversar (ES/EN), capturar datos del cliente y notificar por WhatsApp. El primer vertical es walk-in queue para barberías (por la coyuntura NXTUP), pero el alcance es cualquier negocio pequeño que pierde llamadas: dentistas, HVAC, electricistas, pintores, salones.

En el vertical barbería: el cliente llama, pregunta si hay atención disponible, recibe info del local y queda en lista de espera hasta que llegue al sitio físico y haga check-in.

**Flow:** cliente llama → VAPI contesta → cuenta profesionales disponibles + tamaño de cola → responde + da info del shop → si cliente confirma, captura nombre/teléfono → crea entrada en cola → manda WhatsApp con dirección + código de check-in.

**Posicionamiento:** sustituye a la persona que tiene que contestar el teléfono para decir "sí hay barberos" o "hay 20 minutos de espera". Mientras el dueño/barbero corta pelo, Mamacita contesta.

## Modelo de producto

**Fase actual (en construcción):** walk-in queue. El cliente llama AHORA preguntando por disponibilidad AHORA. No hay slot fijo, no hay calendario futuro.

**Fase 2 (deferred, paid premium):** citas agendadas a tiempo específico futuro. El código original de Mamacita fue construido para este modelo y se preserva (`appointments`, `availability_slots`, `blocked_times` no se tocan en el pivot actual). Será un feature pago adicional cuando un cliente lo pida.

## Stack

- Vite + React + TypeScript + shadcn/ui
- Supabase (Postgres + Edge Functions + Auth + RLS + Realtime para dashboard en vivo)
- VAPI (vapi.ai) — plataforma de voz IA
- Stripe — suscripciones
- WhatsApp Business API — confirmaciones

## Estado actual

- En producción, sin clientes pagando aún
- Código actual asume modelo single-barber + appointments futuros (versión vieja)
- **Sprint activo:** pivot a walk-in queue + multi-profesional por shop. Schema nuevo: `shops`, `professionals`, `queue_entries`. Edge functions reescritas.
- **Piloto:** un shop de NXTUP (gratis). La UI de cola del piloto es la de NXTUP (TV/kiosk/PWA) — Mamacita no construye dashboard todavía. Francisco construye también el lado NXTUP de la integración. Billing diferido. Onboarding white-glove. Decisiones completas en `planning/product/walk-in-queue-spec.md` § "Decisiones de scope del piloto".
- Edge Functions del flujo walk-in (nuevas): `vapi-assistant-request` (reescrita), `vapi-join-queue`, `vapi-take-message`, `nxtup-events`, `send-whatsapp-queue-notification`, `vapi-end-of-call` (con telemetría)
- Edge Functions legacy (Fase 2 appointments, no tocar): `vapi-create-appointment`, `send-whatsapp-confirmation`, `vapi-buy-number` (pendiente refactor a shops), `create-checkout-session`, `stripe-webhook`, `accrue-referral-balance` (⚠️ declarada en config.toml pero sin código local)
- Proyecto Supabase: ref `kpgseyfkucnnzdaoqjdq` (East US — North Virginia), nombre "MamaCita"

## Reglas de oro al editar código

1. **No modificar auth ni billing sin avisar** — afecta clientes existentes
2. **Todo el código se escribe y se deploya desde acá** (Claude Code + Supabase CLI). NO se usa Lovable.
3. **Antes de aplicar una migración o deploy de una function, Francisco da OK explícito** — Claude prepara el comando, Francisco lo aprueba o lo corre.
4. **Cambios al schema requieren migración SQL** en `supabase/migrations/` con timestamp en el filename
5. **Re-leer cada archivo antes de editar** — Francisco puede tocar archivos en paralelo desde VSCode
6. **No borrar las tablas viejas (`appointments`, `availability_slots`, `blocked_times`)** — quedan reservadas para Fase 2 paid appointments

## Workflow de deploy

### Setup inicial (una sola vez)
```bash
cd C:\Users\frami\Proyectos\mamacita
supabase login                                # autenticar la CLI
supabase link --project-ref kpgseyfkucnnzdaoqjdq   # vincular este directorio al proyecto MamaCita
```

### Aplicar migración nueva
```bash
supabase db push   # aplica todas las migraciones pendientes en supabase/migrations/
```

### Deploy de una edge function
```bash
supabase functions deploy <function-name>
# ej: supabase functions deploy vapi-assistant-request
```

### Deploy de TODAS las edge functions
```bash
supabase functions deploy
```

### Ver logs en vivo de una function
```bash
supabase functions logs <function-name> --tail
```

## Specs y docs del producto

- **Spec del walk-in queue (sprint activo):** `planning/product/walk-in-queue-spec.md`
- **Plan de integración con NXTUP (primer integrador):** `planning/integration/with-nxtup.md`
- **Economía de tiers + estrategia de proveedor de voz:** `planning/business/pricing-economics.md` — ⚠️ leer antes de cualquier decisión de pricing o de proveedor de voz. El tier de voz tiene margen frágil; la tabla `calls` define el pricing final.

Si trabajas en código del producto, lee el spec primero. Si trabajas en integración, lee el doc de integración primero.

## Roadmap del producto Mamacita

**Sprint actual:** Walk-in queue + multi-profesional por shop (1.5-2 semanas)

**Siguientes (orden tentativo, revisado 2026-06-10):**
- **Agente WhatsApp** (tier intermedio $87 en el modelo NXTUP): agente de texto que agenda citas y comunica cliente↔barbero. Reutiliza las tablas `appointments`/`availability_slots` preservadas y el canal WhatsApp existente. Subió de prioridad: es un tier de revenue, no una optimización
- Dashboard del shop propio (para clientes standalone sin NXTUP)
- Onboarding self-serve
- Vocabulario configurable por vertical (salones, spas, dentistas) + toma de mensajes como producto para verticales dispatch (HVAC, electricistas, pintores)
- SMS además de WhatsApp
- **Fase 2:** citas futuras por VOZ como feature paid premium (por WhatsApp llegan antes, en el tier intermedio)

## Integraciones con sistemas externos

Mamacita expone una API pública. Hoy hay un solo integrador en curso: **NXTUP** (queue management para barberías del que Francisco es 1 de 4 socios). Cuando un shop usa NXTUP, Mamacita lee el estado de la cola de NXTUP en vez de mantener el propio. Para shops standalone, Mamacita mantiene su propio queue state. Detalles en `planning/integration/with-nxtup.md`.

## Repo

- GitHub: https://github.com/frpenalo/tu-cita-pro (URL aún dice tu-cita-pro, rename pendiente). Directorio local: `C:\Users\frami\Proyectos\mamacita`
