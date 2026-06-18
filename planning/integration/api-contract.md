# Contrato de API — Mamacita ↔ NXTUP

**Versión:** 1.0-draft (2026-06-10)
**Status:** para implementar. El lado NXTUP lo construye Francisco en el repo nxtup.

---

## Principios

- **Autenticación:** secreto compartido por shop (`nxtup_shared_secret`, generado al vincular). Toda request lleva HMAC-SHA256 del body en el header `x-mamacita-signature` (hex) + `x-mamacita-timestamp` (epoch segundos). Rechazar si el timestamp difiere más de 5 minutos (anti-replay).
- **Idempotencia:** todo POST lleva `external_id` (el UUID del registro en el sistema origen). El receptor hace upsert por `external_id`, nunca duplica.
- **Timeouts:** llamadas síncronas durante una llamada de voz en vivo usan timeout de 3 segundos con fallback graceful (el agente responde con datos locales o un mensaje genérico).

---

## Lado NXTUP — endpoints que NXTUP expone (a construir en repo nxtup)

### `GET /api/mamacita/availability?shop_id={nxtup_shop_id}`

Mamacita lo llama **durante la llamada de voz** para saber el estado actual.

Response 200:
```json
{
  "shop_id": "...",
  "professionals_available": 2,
  "professionals_busy": 3,
  "queue_waiting": 4,
  "estimated_wait_minutes": 35,
  "is_open": true
}
```

- Auth: header `Authorization: Bearer {nxtup_shared_secret}`
- Performance: < 500ms (es parte de una conversación en vivo)

### `POST /api/mamacita/queue-entries`

Mamacita lo llama cuando un cliente confirma que va. Crea la entrada en la cola de NXTUP (aparece en TV display, kiosk, PWA).

Request body:
```json
{
  "external_id": "uuid de queue_entries en Mamacita",
  "shop_id": "nxtup_shop_id",
  "customer_name": "...",
  "customer_phone": "+1...",
  "source": "voice",
  "check_in_code": "A3F7",
  "eta_at": "ISO timestamp"
}
```

Response 200: `{ "nxtup_entry_id": "...", "position": 5 }`

- Auth: Bearer + firma HMAC
- Idempotente por `external_id`

---

## Lado Mamacita — endpoints que Mamacita expone (edge functions)

### `POST /functions/v1/nxtup-events`

NXTUP dispara eventos hacia Mamacita. Evento inicial: `turn_approaching` (cliente cerca de su turno → Mamacita manda WhatsApp "ya casi te toca").

Request body:
```json
{
  "event": "turn_approaching",
  "external_id": "uuid de queue_entries en Mamacita",
  "shop_id": "nxtup_shop_id",
  "position": 2,
  "eta_minutes": 10
}
```

Eventos futuros: `entry_completed`, `entry_no_show` (para cerrar el loop de telemetría).

- Auth: HMAC con el mismo `nxtup_shared_secret`, headers `x-nxtup-signature` + `x-nxtup-timestamp`

---

## Vinculación de un shop (manual durante el piloto)

White-glove por ahora: Francisco inserta directamente en la tabla `shops` de Mamacita:
- `nxtup_shop_id` — el UUID del shop en NXTUP
- `nxtup_api_url` — base URL del deploy de NXTUP (ej. `https://mvp-nxtup.vercel.app`)
- `nxtup_shared_secret` — generado con `openssl rand -hex 32`, se guarda en ambos sistemas

Cuando exista el marketplace (Sprint 3 del plan general), esto lo hará el endpoint `POST /api/shops/provision`.

---

## Comportamiento del agente según vinculación

| Estado del shop en Mamacita | Disponibilidad | Al unirse a la cola |
|---|---|---|
| `nxtup_shop_id` configurado | `GET availability` de NXTUP (timeout 3s → fallback a datos locales) | `POST queue-entries` a NXTUP + registro local |
| Sin vínculo NXTUP (standalone) | RPC local `shop_availability()` | Solo registro local en `queue_entries` |
