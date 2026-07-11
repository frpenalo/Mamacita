# Spec de integración NXTUP → Mamacita: precios del shop para Julie (voz)

**Fecha:** 2026-07-09 · **Status:** propuesta para acordar entre NXTUP y Mamacita
**Contexto:** los clientes preguntan mucho el precio por teléfono. Hoy Julie (la voz) no lo da
porque el dato no existe. Queremos que el **dueño lo cree y lo modifique él mismo** desde NXTUP
(su panel), no hardcodearlo del lado de Mamacita.

---

## Objetivo

El dueño del shop administra sus **servicios y precios** desde NXTUP. Cuando un cliente le
pregunta el precio a Julie por teléfono, ella lo cita de esa lista (y no inventa).

## Reparto de trabajo

- **NXTUP construye:** el editor donde el dueño crea/edita servicios + precios, y **avisa a
  Mamacita** cuando cambian.
- **Mamacita (lado ya casi listo):** recibe la lista, la guarda y se la pasa a Julie. El tubo
  ya existe — `vapi-assistant-request` ya envía la variable `{{services_text}}` a la voz en cada
  llamada; hoy va vacía. Solo falta poblarla + una línea en el prompt de Julie.

---

## El contrato (lo que NXTUP envía)

Cuando el dueño **guarda** cambios de precios, NXTUP reusa su emisor **`notifyMamacita()`**
existente (`nxtup/src/lib/mamacita.ts`, el mismo que ya firma y manda `entry_completed`) con un
evento nuevo. NO hay endpoint nuevo ni firma nueva.

- **Destino:** el webhook que Mamacita ya tiene →
  `POST https://kpgseyfkucnnzdaoqjdq.supabase.co/functions/v1/nxtup-events`
- **Auth:** la MISMA firma HMAC con `MAMACITA_SHARED_SECRET` que ya usan hoy.
- **Payload:**

```json
{
  "event": "shop_profile_updated",
  "nxtup_shop_id": "f6b50767-0538-47ba-86a8-b0c0170b2d38",
  "services": [
    { "name": "Corte regular",          "price": 35, "duration_min": 30 },
    { "name": "Corte y barba",          "price": 45, "duration_min": 45 },
    { "name": "Niños (menores de 12)",  "price": 30, "duration_min": 30 }
  ]
}
```

- `nxtup_shop_id`: el id del shop en NXTUP (así Mamacita ubica el `shops` correcto). Ej. Fade
  Factory = `f6b50767-0538-47ba-86a8-b0c0170b2d38`.
- `services[]`: la lista que editó el dueño. `price` en USD (número). `name` tal cual lo escribe.
  `duration_min` opcional (útil a futuro; para la voz no es imprescindible).
- Se envía **al guardar** (no en cada llamada) — los precios son estáticos.

## Qué hace Mamacita al recibirlo (lo implemento yo)

1. `nxtup-events` valida la firma, ubica el shop por `nxtup_shop_id`.
2. Formatea `services[]` al texto que Julie lee y lo guarda en `shops.services_text`
   (ej. `"Corte regular $35, Corte y barba $45, Niños $30"`).
3. En la próxima llamada, Julie recibe ese texto en `{{services_text}}` (que **ya viaja hoy**) y
   lo cita si preguntan precio. Ajusto la línea del prompt de Julie en VAPI:
   *"si preguntan precio, cítalo de esta lista; no inventes."*

Como Julie lee una **copia local** en Mamacita, sigue dando precios aunque NXTUP esté caído.

## Alternativa (si NXTUP prefiere no empujar)

En vez del push por evento, NXTUP puede incluir `services` en la respuesta del endpoint que
Mamacita YA consulta en cada llamada: `GET /api/mamacita/availability?shop_id=...`. Mamacita lo
leería en vivo. Ventaja: fuente única de verdad en NXTUP. Desventaja: acopla el precio al uptime
de NXTUP (ya pasa con la disponibilidad) y lee un dato estático en cada llamada. **Recomiendo el
push** por eso.

---

## Notas

- Es a nivel **shop** (perfil del shop), no por barbero. Si quieren precios por barbero, es
  diseño interno de NXTUP; a Julie le basta la lista del shop.
- El **mismo mecanismo** sirve para que el dueño edite horario/dirección desde NXTUP (hoy el
  horario `hours_text` se puso a mano). Se puede sumar al mismo evento `shop_profile_updated`.
- **Coordinación:** es una adición al contrato Mamacita↔NXTUP. Se acuerda entre las dos partes
  antes de mergear; el contrato no se cambia unilateral.
