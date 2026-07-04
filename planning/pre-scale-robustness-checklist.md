# Checklist de robustez antes de escalar — Mamacita + NXTUP

**Para:** Francisco (dueño del producto) y el programador senior que haga la auditoría.
**Fecha:** 2026-06-18
**Objetivo:** llevar el sistema de "MVP de piloto sólido" a "sistema en el que se confía para
escalar a muchos shops con dinero y clientes reales".

---

## Cómo usar este documento

1. **Francisco:** contrata a un **programador senior** (back-end + algo de seguridad) para una
   auditoría de **8–16 horas**. Entrégale este documento y los dos repos:
   - Mamacita: `C:\Users\frami\Proyectos\mamacita` (Supabase Edge Functions, Deno/TypeScript)
   - NXTUP: `C:\Users\frami\Proyectos\nxtup` (Next.js, repo GitHub `Nxtupdev/mvp`)
2. **El senior:** revisa cada ítem, marca ✅/⚠️/❌ y deja notas. Prioriza los 🔴 (críticos)
   ANTES de escalar; los 🟡/🟢 se pueden hacer después.
3. Pídele que **te explique la arquitectura** mientras audita — para que dependas menos de
   una sola persona (o IA).

**Leyenda de prioridad:** 🔴 Crítico (antes de escalar) · 🟡 Importante · 🟢 Mejora

---

## 1. Seguridad

- 🔴 **Auth de los webhooks bidireccionales.** Verificar firma HMAC-SHA256 + ventana
  anti-replay (5 min) + fail-closed en AMBAS direcciones. *Por qué:* es el candado entre
  los dos sistemas; si está flojo, cualquiera podría inyectar entradas falsas o leer datos.
  *Dónde:* `mamacita/supabase/functions/nxtup-events/index.ts` (recibe de NXTUP),
  `nxtup/src/lib/mamacita.ts` (`verifyMamacitaSignature`, `notifyMamacita`),
  `mamacita/supabase/functions/vapi-join-queue/index.ts` (`hmacHex`).

- 🔴 **Manejo de secrets.** Confirmar que NINGÚN secret está hardcoded ni en el repo
  (solo en variables de entorno). Hoy el `MAMACITA_SHARED_SECRET` es **uno global** para
  todos los shops (decisión de piloto). *Por qué:* si se filtra, compromete a todos los
  shops a la vez. *A escala:* mover a un secret **por shop**. *Dónde:* `.env` (ya fuera del
  repo), Supabase Edge secrets, Vercel env vars.

- 🔴 **RLS (Row Level Security) en Supabase — AMBOS proyectos.** Verificar que las tablas con
  datos personales (`queue_entries`, `calls`, `customers`/clientes) tengan políticas que
  impidan que un usuario lea datos de otro shop. *Por qué:* es PII de clientes reales.
  *Nota:* NXTUP ya tiene una auditoría de seguridad pendiente con una brecha de RLS de PII
  conocida — pídele al senior que la cierre. *Dónde:* migraciones de Supabase de ambos repos.

- 🟡 **Validación y saneo de inputs.** ¿Los endpoints validan nombres, teléfonos, longitudes?
  ¿Qué pasa con datos malformados o maliciosos? *Dónde:* todos los `route.ts` de
  `nxtup/src/app/api/` y todas las edge functions de Mamacita.

- 🟡 **Rate limiting / anti-abuso.** El check-in del kiosk limita 3/día. ¿Y los demás
  endpoints (join_queue, los webhooks)? ¿Alguien podría spamear la cola? *Dónde:*
  `vapi-join-queue`, `mamacita/queue-entries`.

- 🟡 **Llaves del frontend.** Confirmar que lo expuesto al navegador (claves `VITE_*`) sea
  solo la *anon/publishable key* (pública por diseño) y que RLS la respalde. Nunca la
  service_role key en el frontend.

## 2. Confiabilidad (que no se rompa)

- 🔴 **Degradación cuando un proveedor externo falla.** Probar: ¿qué hace Julie si NXTUP
  está caído (no lee disponibilidad)? ¿Qué pasa si Mamacita se cae (¿NXTUP sigue
  funcionando?)? ¿Si VAPI/Twilio/Deepgram fallan? *Por qué:* dependes de 3-4 servicios
  externos; cada uno es un punto de fallo. *Estado:* los webhooks ya son "best-effort" (no
  rompen el flujo), pero auditar todos los puntos. *Dónde:* `vapi-assistant-request`
  (timeout 3s a NXTUP), `notifyMamacita` (best-effort).

- 🔴 **Idempotencia y condiciones de carrera.** Verificar que dos eventos iguales (misma
  llamada, mismo webhook) NO produzcan duplicados. *Estado:* hay idempotencia por
  `vapi_call_id` y dedup por teléfono. *Riesgo conocido ya resuelto:* la normalización de
  teléfono (11 vs 10 dígitos) causaba duplicados — confirmar que está bien en todos lados.
  *Dónde:* `vapi-join-queue`, `mamacita/queue-entries`, `kiosk/checkin`.

- 🟡 **Reintentos de webhooks fallidos.** Hoy si un webhook falla, se pierde (best-effort,
  sin reintento). *A escala:* considerar una cola de reintentos o un registro de eventos
  fallidos para no perder cierres/avisos. *Dónde:* `notifyMamacita`, las llamadas a
  `send-whatsapp-queue-notification`.

- 🟡 **Consistencia entre las dos colas (Mamacita ↔ NXTUP).** El webhook de cierre
  (`entry_completed`) acaba de cerrar el caso principal de desincronización. Auditar si
  quedan otros (cancelaciones, reset nocturno de NXTUP, no-shows). *Pendiente conocido:*
  falta `entry_no_show` y `turn_approaching`.

## 3. Escala

- ✅ **Concurrencia — RACE CONDITION ENCONTRADO Y ARREGLADO (2026-06-25).** Auditando este
  punto se halló que la asignación NO era atómica: dos barberos podían reclamar el mismo
  cliente (`state/route.ts`), o dos clientes el mismo barbero (`kiosk/checkin`). Arreglado con
  **reclamo atómico** (UPDATE condicional + `.select()` para detectar quién ganó; el perdedor
  cae limpio al siguiente). Rama `fix/queue-concurrency-atomic-claim`. **PENDIENTE:** escribir
  un test del race para blindar el arreglo (requiere setup de tests — sigue siendo la brecha
  mayor; ver sección 4). *Dónde:* `barbers/[barber_id]/state/route.ts`, `kiosk/checkin/route.ts`.

- 🟡 **Índices de base de datos.** Confirmar índices en las columnas que más se consultan:
  `shops.phone_number` (lookup por número en cada llamada), `queue_entries(shop_id, status)`,
  `queue_entries.customer_phone`, `queue_entries.vapi_call_id`. *Por qué:* sin índices, a
  escala las consultas se vuelven lentas.

- 🟡 **Costos a escala.** Ya analizados en `planning/business/pricing-economics.md` (VAPI
  tiene margen frágil). Confirmar el monitoreo de costo por shop/mes.

- 🟢 **El cron de limpieza** (`expire_stale_queue_entries`, pg_cron) corre para todos los
  shops a la vez — confirmar que escala. *Dónde:* migración `20260617000001`.

## 4. Tests automatizados (HOY NO HAY — esta es la mayor brecha)

- 🔴 **Tests de los flujos críticos.** Escribir tests (unitarios + integración) para:
  - `join_queue`: idempotencia, dedup con ventana de 12h, normalización de teléfono,
    el caso "ya está en la lista".
  - El push a NXTUP + la normalización (el bug histórico de los duplicados).
  - El check-in que activa una reserva de voz (presencia, salta el rate limit).
  - El webhook de cierre (`entry_completed` → `served`).
  - La selección de plantilla de WhatsApp por idioma (es/en) y por destinatario.
  *Por qué:* sin tests, cualquier cambio futuro puede romper algo y nadie se entera hasta
  que un cliente lo sufre. Es la diferencia más grande entre "MVP" y "producción confiable".

- 🟡 **Tests de edge cases:** 0 barberos en turno, teléfono malformado, nombre vacío,
  llamada sin caller ID, shop sin `nxtup_shop_id`.

## 5. Monitoreo y observabilidad

- 🔴 **Visibilidad de errores en producción.** ¿Dónde se ven los errores HOY? (Supabase
  Functions logs para Mamacita, Vercel logs para NXTUP.) ¿Alguien los mira? *Por qué:* si
  algo se rompe en producción y nadie se entera, lo descubre el cliente.

- 🟡 **Alertas.** Configurar avisos cuando: un webhook falla repetidamente, el costo de VAPI
  se dispara, la tasa de error de `join_queue` sube. (Herramientas: Sentry, Supabase
  alerts, o un cron que revise y avise por WhatsApp/email.)

- 🟡 **Métricas de salud.** Ya hay telemetría en la tabla `calls` (duración, costo,
  outcome). Construir un dashboard simple: llamadas/día, conversión, no-show, costo por
  cliente. (Esto es el "embudo" que el webhook de cierre ahora alimenta.)

## 6. Mantenibilidad (que no dependa de una sola persona)

- 🔴 **Reducir la dependencia de una sola persona/IA.** Que Francisco (o un socio) entienda
  la **arquitectura** (no el código línea por línea, sino: qué hace cada pieza, cuáles son
  los puntos de fallo, cómo se conecta todo). La documentación en `planning/` ya es una base
  buena — pídele al senior que la complete con un diagrama de arquitectura.

- 🟡 **Runbooks.** Documentar "qué hacer si X se rompe" (Julie no contesta, los WhatsApp no
  llegan, la cola no sincroniza).

- 🟢 **CI/CD.** Que el typecheck y los tests corran automáticamente en cada push (GitHub
  Actions), para que nada roto llegue a producción.

---

## Resumen: lo CRÍTICO antes de escalar (los 🔴)

1. Auditar la seguridad de los webhooks + RLS de PII (ambos repos)
2. Confirmar la degradación ante fallos de proveedores externos
3. Confirmar idempotencia / no-duplicados
4. **Escribir tests de los flujos críticos** ← la mayor brecha hoy
5. Tener visibilidad de errores en producción (logs + quién los mira)
6. Que más de una persona entienda la arquitectura

Lo demás (🟡/🟢) se construye en capas a medida que creces. **No necesitas todo esto para
el piloto** — lo necesitas antes de apostar el negocio a que el sistema aguante a escala.

---

> **Nota honesta para Francisco:** este sistema se construyó con cuidado (seguridad real,
> idempotencia, verificación con datos, manejo de errores). NO es "vibe coding frágil". Pero
> sí es un MVP sin la red de seguridad de un equipo senior (tests, auditoría humana,
> monitoreo). Esta lista es exactamente esa red. Invertir en ella antes de escalar no es
> porque algo esté roto — es lo que hace cualquier negocio serio antes de crecer.
