# Mamacita ↔ NXTUP — Plan de integración (vista de Mamacita)

**Última actualización:** 2026-05-22
**Status:** planning fase
**Perspectiva:** este documento describe la integración desde el lado de Mamacita. NXTUP mantiene su propia copia en `nxtup/planning/integration/mamacita-nxtup-integration.md`. Las dos copias deben coincidir; si difieren, es señal de que algo cambió y no se comunicó.

---

## Contexto

### Mamacita (este proyecto)

- **Qué es:** agente de voz IA que toma reservaciones por llamada telefónica. Cliente llama → VAPI contesta → recolecta info → crea cita en Supabase → manda WhatsApp.
- **Stack:** Vite + React + TypeScript + shadcn/ui + Supabase + Edge Functions + VAPI + Stripe.
- **Repo:** https://github.com/frpenalo/tu-cita-pro
- **Estado:** producción, sin clientes pagando aún.
- **Equipo:** Frank solo (construido antes de NXTUP).
- **Modelo actual:** single-barber (un número de teléfono = un barbero independiente).

### NXTUP (proyecto consumidor)

- **Qué es:** sistema de queue management para barberías. Walk-ins, FIFO de barberos, anti-cheat por IP, breaks con reglas, peaje de llegada tarde, hardware NXT TAP (ESP32-S3 + pantalla táctil).
- **Stack:** Next.js 16 (Vercel) + Supabase + ESP32 firmware.
- **Repo:** https://github.com/Nxtupdev/mvp
- **Estado:** producción.
- **Equipo:** 4 socios (Frank es uno).

---

## El deal

Mamacita se integra a NXTUP como **add-on marketplace**:

- Cada uno mantiene su Supabase, su repo, su deploy independiente
- Comunicación vía webhooks + API REST
- Shop en NXTUP puede activar Mamacita con un click → se provisiona cuenta en Mamacita ligada al shop_id
- **Mamacita stays como producto separable y licenciable** (este es el principio rector)

### Estructura de licenciamiento (lo que Mamacita aporta y cobra)

- **Pricing al shop final:** NXTUP Basic $27/mes, NXTUP Pro con voz $80/mes (premium de $53 atribuible a voz)
- **Licencia de Mamacita a NXTUP:** 40% del premium de voz = $21.20/shop/mes
- **Minimum guarantee escalonado:** $500/mes (meses 1-6), $1K/mes (7-12), $2K/mes (13+)
- **Revenue share decreciente:** 40% para 1-200 shops, 30% para 201-500, 20% para 501+
- **Exclusividad NXTUP solo en rubro barberías** — Mamacita puede licenciarse a spas, peluquerías, dentistas, etc. sin afectar el acuerdo
- **Buyout option:** $150K mes 24, $200K mes 36, $250K mes 48
- **Trabajo de adaptación** (single-barber → multi-barber): $6K one-time como contractor

### Lo que Mamacita NO se compromete a hacer

- White-label completo (eso es Opción A, no se eligió)
- Migrar su Supabase al de NXTUP (eso es Opción 1, no se eligió)
- Cambiar de VAPI a otro provider de voz
- Soportar features específicas de NXTUP que no aplican a otros rubros

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

Tiempo estimado del sprint preparatorio: 2-3 semanas. Pagado como contractor: $6K.

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
