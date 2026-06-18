# Mamacita ↔ NXTUP — Plan de integración (vista de Mamacita)

**Última actualización:** 2026-06-01
**Status:** planning fase — NO bloqueante del sprint actual
**Perspectiva:** este documento describe la integración desde el lado de Mamacita. NXTUP mantiene su propia copia en `nxtup/planning/integration/mamacita-nxtup-integration.md`. Las dos copias deben coincidir; si difieren, es señal de que algo cambió y no se comunicó.

> **Nota importante (2026-06-01):** Mamacita pivotó de "appointments futuros" a "walk-in queue" como producto primario. Ver `planning/product/walk-in-queue-spec.md`. Bajo el nuevo modelo, la integración con NXTUP es mucho más natural — Mamacita es la interfaz de voz al queue que NXTUP ya mantiene. Las secciones técnicas abajo están parcialmente desactualizadas y se ajustarán cuando el sprint del MVP esté cerrado.

---

## Principio rector (leer primero)

**Mamacita es un producto independiente.** Vende su servicio de agente de voz IA a cualquier negocio que necesite agendar citas — barberías, spas, peluquerías, dentistas, clínicas, etc. NXTUP es **un integrador**, no el dueño ni el canal exclusivo.

La relación con NXTUP se materializa así:
- Mamacita expone una **API pública**
- NXTUP consume esa API para que sus shops puedan activar el agente de voz con un click
- Cada sistema mantiene su Supabase, su repo, su deploy, su roadmap

Esto significa que Mamacita puede (y debe) seguir vendiéndose en paralelo: directo a barberías que no usan NXTUP, a verticales no-barbería, en cualquier país. La integración con NXTUP es un canal adicional, no el único.

---

## Contexto

### Mamacita (este proyecto)

- **Qué es:** agente de voz IA standalone para reservaciones por llamada. Vertical-agnóstico.
- **Stack:** Vite + React + TypeScript + shadcn/ui + Supabase + Edge Functions + VAPI + Stripe.
- **Repo:** https://github.com/frpenalo/tu-cita-pro
- **Estado:** producción, sin clientes pagando aún.
- **Equipo:** Francisco solo (construido antes de NXTUP).
- **Modelo de producto:** walk-in queue (cliente llama, se entera de disponibilidad, queda en lista de espera hasta check-in físico). Citas futuras agendadas son Fase 2 paid premium.
- **Modelo de datos:** en migración de single-barber a multi-profesional por shop. Schema nuevo: `shops`, `professionals`, `queue_entries`.

### NXTUP (primer integrador)

- **Qué es:** sistema de queue management para barberías. Walk-ins, FIFO de barberos, anti-cheat por IP, breaks con reglas, peaje de llegada tarde, hardware NXT TAP (ESP32-S3 + pantalla táctil).
- **Stack:** Next.js 16 (Vercel) + Supabase + ESP32 firmware.
- **Repo:** https://github.com/Nxtupdev/mvp
- **Estado:** producción.
- **Equipo:** 4 socios (Francisco es uno).

---

## El deal

Mamacita expone una **API pública**. NXTUP la consume.

- Cada uno mantiene su Supabase, su repo, su deploy independiente
- Comunicación vía webhooks firmados + API REST
- Shop en NXTUP puede activar Mamacita con un click → NXTUP llama el endpoint de provisioning de Mamacita, que crea cuenta interna ligada al `shop_id` de NXTUP
- Mamacita sigue vendiéndose en paralelo por sus propios canales — la integración NXTUP es un canal más

### Estructura comercial — menú à la carte (actualizado 2026-06-10)

Los agentes de Mamacita (WhatsApp y voz) son add-ons independientes sobre NXTUP base. El shop elige cualquier combinación:

| Combo | Precio lista/mes | Founding (primeros ~20-30 shops, 6 meses) |
|---|---|---|
| **NXTUP solo** | $47 | — |
| **NXTUP + Agente WhatsApp** | $87 (+$40) | $77 ✅ confirmado por Francisco |
| **NXTUP + Agente de voz** | $100 (+$53) | $90 |
| **NXTUP + ambos agentes** | $130 (descuento bundle de $10 vs $140 à la carte) | $120 |

- **Agente WhatsApp:** agente de texto que agenda citas y mantiene la comunicación de esas citas entre cliente y barbero
- **Agente de voz:** contesta llamadas, walk-in queue, toma de mensajes
- **Regla founding:** $10 menos en cualquier combo con agente, garantizado 6 meses, para los primeros shops. Después entra el precio de lista.
- **Racional de márgenes:** voz a +$53 mueve el break-even a ~175 llamadas/mes (vs ~110 con el +$33 originalmente propuesto). El bundle a $130 aguanta hasta ~240 llamadas/mes. Detalle en `planning/business/pricing-economics.md`.

**Split de revenue entre NXTUP y Mamacita por combo: POR DEFINIR.** El modelo anterior ($100 = $37 NXTUP + $63 Mamacita, con el lado Mamacita 50% Francisco / 50% los otros 3 socios) queda como referencia histórica — hay que renegociar el reparto, en particular los incrementos de WhatsApp y voz que son tecnología de Mamacita.

> **Validar contra telemetría:** la tabla `calls` del piloto confirma el costo real de voz por shop antes de cerrar estos precios definitivamente.

> **Propiedad:** la propiedad de Mamacita sigue siendo 100% de Francisco — cualquier participación de los otros socios es sobre revenue del canal NXTUP, no equity.

### Lo que NO está incluido en este acuerdo

- **Exclusividad:** ninguna. Mamacita puede venderse a cualquier vertical y a cualquier barbería que no use NXTUP, sin afectar este split.
- **Equity en Mamacita:** ninguna. Los socios de NXTUP no son co-dueños de Mamacita, solo participan del revenue del canal NXTUP.
- **Roadmap de Mamacita:** Francisco decide solo. NXTUP no tiene voto sobre el producto Mamacita en sí.
- **Pricing fuera del paquete combinado:** Mamacita vendida directa (sin NXTUP) tiene su propio pricing independiente, no atado a estos $100.

### Términos por definir (pendientes)

- **Buyout option:** se evalúa a futuro, no aplica en esta fase.
- **Qué pasa si NXTUP desaparece o pivota:** sin definir todavía. Mamacita sigue funcionando standalone, pero los $31.50/mes que iban a los otros 3 socios — destino por decidir.

### Términos cerrados como "no aplica"

- **Minimum guarantee:** no hay. NXTUP no garantiza pago mínimo a Mamacita; el revenue se genera por shop activo y nada más.
- **Pago por el trabajo de adaptación single-barber → multi-barber:** no hay compensación adicional. El owner absorbe ese costo como inversión en su propio producto.

### Lo que Mamacita NO se compromete a hacer (independencia técnica)

- White-label completo (no se vende como "powered by NXTUP")
- Migrar su Supabase al de NXTUP
- Cambiar de VAPI a otro provider de voz
- Soportar features específicas de NXTUP que no aplican a otros rubros
- Bloquear la venta a competidores de NXTUP en barberías

---

## Lo que Mamacita debe exponer/construir para la integración

### APIs públicas para NXTUP

| Endpoint | Propósito |
|---|---|
| `POST /api/shops/provision` | NXTUP llama esto cuando un shop activa el add-on. Crea cuenta interna, devuelve `mamacita_shop_id` + `magic_link_token` |
| `POST /api/shops/deprovision` | Limpieza cuando se desactiva |
| Magic link auth | Para que el dueño acceda al dashboard de Mamacita sin password adicional |

### Webhooks que Mamacita dispara hacia NXTUP

Cuando VAPI crea una cita exitosa, Mamacita debe disparar webhook al endpoint que NXTUP exponga (`POST /api/appointments/sync` o similar). Firma con `mamacita_webhook_secret` compartido.

Payload mínimo:
```json
{
  "shop_id": "...",
  "external_id": "...",
  "client_name": "...",
  "client_phone": "...",
  "scheduled_at": "ISO timestamp",
  "barber_id": "uuid or null"
}
```

### Adaptaciones internas necesarias

Mamacita en su estado actual está construido para "1 número de teléfono = 1 barbero independiente". Para servir al modelo de NXTUP (1 shop con N barberos) hay que adaptar:

- `supabase/functions/vapi-assistant-request/index.ts` — prompt que pregunta "¿con qué barbero quieres?" o "cualquiera disponible"
- `supabase/functions/vapi-create-appointment/index.ts` — aceptar `barber_id` opcional
- `supabase/functions/vapi-buy-number/index.ts` — pasar de "por barbero" a "por shop"
- Migración SQL para hacer `barber_id` nullable en tabla `appointments`
- Edge function de slots → calcular disponibilidad union de todos los barberos del shop
- Endpoint `GET` que consulte disponibilidad de NXTUP en tiempo real (Mamacita necesita saber qué barberos están libres a qué horas)

Tiempo estimado del sprint preparatorio: 2-3 semanas. **Sin compensación adicional** — Francisco absorbe el costo como inversión en su propio producto.

---

## Lo que Mamacita necesita de NXTUP

### APIs que NXTUP debe exponer

| Endpoint en NXTUP | Para qué lo usa Mamacita |
|---|---|
| `GET /api/shops/[id]/availability?date=X` | Saber qué barberos del shop están libres en qué horarios |
| `POST /api/appointments/sync` | Recibir el webhook cuando Mamacita crea una cita |
| Lista de barberos del shop (probablemente vía Supabase Realtime o endpoint REST) | Que VAPI ofrezca opciones por nombre |

### Información del shop que NXTUP debe pasar al provisionar

- `shop_id`
- `shop_name`
- `timezone`
- `owner_email`
- Lista de barberos (id, name)
- Horarios de operación
- Servicios ofrecidos (opcional)

---

## Roadmap de integración

### Sprint preparatorio — Adaptar Mamacita al modelo multi-barbero

Trabajo descrito arriba en "Adaptaciones internas necesarias". 2-3 semanas. Bloqueante de los demás sprints.

### Sprint 1 — Fundación (linking de cuentas)

- Endpoints `POST /api/shops/provision` y `/deprovision`
- Magic link generation
- En NXTUP lado: columnas en `shops` + endpoints de activación

### Sprint 2 — Flujo de citas

- `vapi-create-appointment` dispara webhook firmado a NXTUP
- Retry logic si NXTUP no responde
- En NXTUP lado: receptor del webhook + tabla `appointments`

### Sprint 3 — UX del marketplace

- Mamacita expone magic_link para que NXTUP redirija al dashboard
- En NXTUP lado: card de Mamacita en marketplace, modal de activación, sidebar item

### Sprint 4 — Citas en operación diaria

- Mamacita consulta `GET /api/shops/[id]/availability` antes de ofrecer slots
- En NXTUP lado: cron de promoción appointments → queue_entries, skip detection consciente de citas, UI de agenda

---

## Estado actual (avanzar este checklist al hacer cambios)

- [ ] Deal con socios cerrado y firmado
- [ ] Sprint preparatorio iniciado
- [ ] Sprint preparatorio terminado
- [ ] Sprint 1 — Fundación
- [ ] Sprint 2 — Flujo de citas
- [ ] Sprint 3 — UX del marketplace
- [ ] Sprint 4 — Operación diaria
- [ ] Producción habilitada para primer shop piloto

---

## Decisiones tomadas (no re-discutir)

- Opción de arquitectura: **B (Marketplace add-on)** — dos sistemas separados, vinculados via webhook + API. NO Opción A (white-label invisible), NO Opción 5 (embedded).
- Modelo de billing: manual al inicio, Stripe automatizado cuando haya 10+ shops con add-on.
- VAPI sigue siendo el provider de voz (no se cambia por otra alternativa por ahora).
- NXT TAP physical device sigue en roadmap de NXTUP pero NO bloquea la integración Mamacita-NXTUP (son tracks paralelos).

---

## Decisiones pendientes

- Integración Mamacita ↔ NXT TAP firmware (¿el dispositivo muestra próxima cita? Definir en Sprint 4)
- Si Mamacita debe enviar SMS de recordatorio el día antes de la cita (función nueva o usar el WhatsApp ya existente)

---

## Cómo mantener este doc en sync con el de NXTUP

Cuando algo cambie en este lado:
1. Actualiza este archivo
2. Commit y push al repo de Mamacita
3. Avísale a quien trabaje en NXTUP que sincronice su copia (`nxtup/planning/integration/mamacita-nxtup-integration.md`)

Cuando NXTUP cambia algo de su lado:
1. Ellos actualizan su copia
2. Te avisan a ti
3. Sincronizas este archivo

Si las dos copias divergen sin coordinación, es señal de que algo se decidió de un lado sin renegociar con el otro — alerta para conversar.
