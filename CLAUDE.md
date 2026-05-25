# Mamacita — Claude context

## Qué es este proyecto

Agente de voz IA que toma reservaciones por llamada telefónica.

**Flow:** cliente llama → VAPI contesta como asistente IA → recolecta nombre, hora, barbero preferido → crea cita en Supabase → manda confirmación por WhatsApp.

## Stack

- Vite + React + TypeScript + shadcn/ui
- Supabase (Postgres + Edge Functions + Auth + RLS)
- VAPI (vapi.ai) — plataforma de voz IA
- Stripe — pagos/suscripciones
- WhatsApp Business API — confirmaciones

## Estado actual

- Producción funcional
- Sin clientes pagando aún
- **Modelo single-barber:** un número de teléfono = un barbero independiente
- Edge Functions: `vapi-assistant-request`, `vapi-buy-number`, `vapi-create-appointment`, `vapi-end-of-call`, `send-whatsapp-confirmation`, `create-checkout-session`, `stripe-webhook`

## Reglas de oro al editar código

1. **No modificar el modelo de auth ni billing sin avisar** — afecta clientes existentes
2. **Edge Functions se despliegan vía Lovable o supabase CLI** — Frank confirma antes de deploy
3. **Cambios al schema de DB requieren migración SQL** en `supabase/migrations/`
4. **Si trabajas en algo de la integración con NXTUP, lee el doc de integración primero y actualízalo al terminar**

## Integraciones con otros productos

### NXTUP (en curso)

Mamacita se está integrando como add-on marketplace al sistema de queue management de NXTUP.

**Antes de cualquier trabajo de integración, leer:**

```
planning/integration/with-nxtup.md
```

Ese doc cubre el plan de sprints, las APIs que Mamacita expone, los webhooks que dispara, la estructura de licenciamiento, y las decisiones tomadas/pendientes. Si algo en una conversación contradice el doc, **pregunta antes de actuar**.

Al terminar trabajo de integración, **actualiza el doc** y commit/push.

## Repo

- GitHub: https://github.com/frpenalo/tu-cita-pro (la URL aún dice tu-cita-pro porque el rename de GitHub está pendiente; el directorio local ya está renombrado a `mamacita`)
