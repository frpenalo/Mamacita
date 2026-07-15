# Spec NXTUP: estadística real (check-ins) + mostrar el ETA de llegada

**Fecha:** 2026-07-12 · **Status:** propuesta para el equipo de NXTUP
**Contexto:** dos ajustes que viven del lado de NXTUP (dashboard del dueño y TV/cola).
Mamacita ya manda los datos necesarios; falta que NXTUP los use/muestre.

---

## #1 — Estadística: contar quién LLEGÓ, no quién LLAMÓ

**Problema:** el dashboard del dueño cuenta como "cliente de hoy" a **toda** entrada de la
cola — incluidas las **reservas de voz** que Julie anota (`source: "voice"`, estado
`waiting`/"en camino") aunque el cliente **nunca llegue**. Eso infla el número: el dueño ve
más "clientes" de los que de verdad aparecieron.

**Fix (lado NXTUP):** el conteo de "clientes/walk-ins de hoy" debe sumar **solo las entradas
que hicieron check-in (llegaron)** — es decir, las que pasaron a `arrived` / `in_service` /
`served` (atendido) — y **NO** las que siguen en `waiting` (esperando / en camino).

**El dato ya existe:** cada entrada tiene su `status`. El **check-in en la tablet** mueve la
entrada de `waiting` → `arrived`. Ese es el corte: llegó = hizo check-in.

- Una reserva de voz que nunca llega se queda en `waiting` → **no cuenta**.
- Un walk-in presencial o una reserva de voz que sí llega → hace check-in → **cuenta**.

**Opcional:** si el dueño quiere ver ambos ("Llamaron: 8 · Llegaron: 5"), los dos datos ya
están (entradas `waiting` vs `arrived`+). Pero la métrica principal = **llegaron**.

---

## #2 — Mostrar el ETA (hora estimada de llegada) al lado del nombre

**Contexto:** Julie ahora le pregunta al cliente **en cuánto llega**, y Mamacita ya te manda
ese estimado en el campo **`eta_at`** del payload de queue-entries (lo reciben desde antes,
pero hasta ahora venía con un estimado genérico; **ahora trae la llegada que dijo el
cliente**, o el genérico si no la dio).

**Dónde llega (sin cambios):** en el `POST /api/mamacita/queue-entries` que ya reciben:
```json
{
  "external_id": "…",
  "shop_id": "…",
  "customer_name": "Juan",
  "customer_phone": "+1…",
  "source": "voice",
  "check_in_code": "…",
  "eta_at": "2026-07-12T19:15:00.000Z"   ← hora estimada de llegada (ISO / UTC)
}
```

**Fix (lado NXTUP):** en el **TV / la cola**, mostrar ese `eta_at` **al lado del nombre** del
cliente, para que el barbero decida si lo espera. Ej.:
- `Juan · llega ~3:15` (hora local del shop), o
- `Juan · en ~15 min` (calculado `eta_at − ahora`).

Solo aplica a entradas de voz (`source: "voice"`); los walk-ins presenciales no traen ETA.

---

## Notas
- Las dos son ajustes de **NXTUP** (dashboard + TV). Mamacita no cambia — ya entrega `status`
  y `eta_at`.
- Es una coordinación normal del contrato Mamacita↔NXTUP; se acuerda entre las dos partes.
