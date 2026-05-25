# Mamacita (tu-cita-pro) — Claude context

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

## Integración con NXTUP — IMPORTANTE

Este proyecto se está integrando como **add-on marketplace** a NXTUP (queue management para barberías). Frank es dueño de Mamacita 100% y socio (1 de 4) de NXTUP. La integración va bajo modelo de licenciamiento.

**Antes de cualquier trabajo relacionado con la integración, LEE este documento maestro:**

```
C:\Users\frami\Proyectos\nxtup\planning\integration\mamacita-nxtup-integration.md
```

Esa es la **fuente única de verdad** sobre:
- Sprints planeados
- Decisiones de arquitectura
- Estructura de licenciamiento
- Decisiones pendientes

Si algo que Frank diga contradice lo que está ahí, **pregunta antes de actuar**.

## Reglas de oro al editar código

1. **No modificar el modelo de auth ni billing sin avisar** — afecta clientes existentes
2. **Edge Functions se despliegan vía Lovable o supabase CLI** — Frank confirma antes de deploy
3. **Cambios al schema de DB requieren migración SQL** en `supabase/migrations/`
4. **Si trabajas en algo de la integración con NXTUP, actualiza el doc maestro al terminar**

## Decisiones tomadas (no re-discutir)

- Arquitectura de integración con NXTUP: **B (Marketplace add-on)** — dos sistemas separados, comunicación vía webhooks + API
- Modelo de billing: manual al inicio, Stripe automatizado más adelante
- VAPI sigue siendo el provider de voz

## Repos relacionados

- Mamacita (este): https://github.com/frpenalo/tu-cita-pro
- NXTUP: https://github.com/Nxtupdev/mvp (en `C:\Users\frami\Proyectos\nxtup`)
