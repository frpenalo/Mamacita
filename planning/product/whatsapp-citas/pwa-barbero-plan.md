# Plan · App del barbero (PWA) para el agente de citas

> Fecha: 21-oct-2026. Estado: propuesta para validar con Francisco.
> Contexto: el agente de citas por WhatsApp quedó funcionando de punta a punta en la prueba del
> 20-oct (botones de horas, reserva directa, candados contra la IA). Este plan cubre el lado del
> BARBERO; el cliente se queda en WhatsApp.

## 1. Decisión

- **Cliente: se queda en WhatsApp.** La gracia del producto es agendar sin instalar nada. Una app
  para el cliente baja la conversión.
- **Barbero: app web instalable (PWA) sobre el dashboard que ya existe.** Nada de App Store ni
  Google Play: sin revisión, se actualiza con cada deploy, mismo patrón que FORJA.
- **El aviso por WhatsApp al barbero se queda como respaldo** para quien no instale la app o no
  acepte notificaciones. La app es la forma "pro" de manejar la agenda; no la única.

Qué resuelve frente a manejar todo por WhatsApp:

| Hoy (WhatsApp) | Con la app |
|---|---|
| Máximo 3 botones por mensaje | Agenda completa, mover a cualquier hueco |
| Avisos fuera de la ventana de 24h dependen de plantillas aprobadas por Meta (la del aviso de cita nueva sigue pendiente) | Notificación push, sin plantillas ni ventana |
| Fallos de entrega silenciosos | El aviso queda también en la agenda, aunque la push no llegue |
| Confirmar una cita no deja registro | Queda quién confirmó, cuándo y qué cambió |

## 2. Lo que ya existe y se reutiliza

- Login email + contraseña (Supabase Auth), `useBarber` (barbero por `user_id`), onboarding.
- `Dashboard.tsx`: tira de 7 días + calendario + lista de citas del día.
- `AppointmentActions.tsx`: completada, no show, reagendar, cancelar.
- `NewAppointmentDialog.tsx`: cita manual.
- `Settings.tsx`: datos, dirección, WhatsApp, horario por día, duración, servicios y precios,
  recargo, bloqueos de horario.
- `Clients.tsx`: libreta de clientes + link `agendar-XXXXXX` con QR.
- UI móvil: shadcn/ui + Tailwind, barra inferior `BottomNav`.
- RLS por barbero en `barbers`, `appointments`, `customers`, `blocked_times` (cada barbero ve solo lo suyo).

No existe: manifest, service worker, iconos, push, Realtime (la agenda no se actualiza sola).

## 3. Fase 0 · Arreglar lo que la app heredaría (antes de todo)

Verificado en el código el 21-oct:

1. **Las acciones del dashboard se saltan al servidor.** Cancelar, reagendar, completada y no show
   hacen un `UPDATE` directo desde el navegador (`AppointmentActions.tsx:34` y `:51`):
   - el cliente **no recibe aviso** cuando el barbero cancela o mueve desde el dashboard;
   - los **recordatorios no se cancelan ni se reprograman**;
   - al reagendar pone `status = 'rescheduled'`, y `send-reminders` solo envía si
     `status === 'confirmed'` (`send-reminders/index.ts:79`), así que **esa cita se queda sin
     recordatorios, en silencio**. Tampoco la encuentra el "Aceptar" por WhatsApp
     (`_shared/barber.ts:104` filtra `confirmed`).

   **Arreglo:** una sola edge function `barber-appointment-action` (autenticada con el JWT del
   barbero; verifica que la cita sea suya) que hace `confirm | cancel | reschedule | complete |
   no_show` reutilizando `_shared/` (avisos al cliente en su idioma, recordatorios, reserva
   atómica). El dashboard y los comandos de WhatsApp pasan a usar la MISMA lógica. Reagendar
   mantiene `confirmed` (como ya hace el agente).
2. **Bloqueos de horario con 1 hora de desfase.** `Settings.tsx:136` arma la fecha con `-05:00`
   fijo; Nueva York está en `-04:00` hasta el 1-nov. **Arreglo:** convertir con la zona del barbero.
3. **Recordatorios siempre en español.** `send-reminders` lee `wa_sessions.language` (nadie lo
   escribe); el idioma real está en `wa_sessions.lang`. **Arreglo:** leer `lang`.
4. **Registro de confirmación.** Columnas `appointments.barber_confirmed_at` y
   `confirmed_via` (`whatsapp | app`), o una tabla `appointment_events` si queremos historial
   completo. Recomendado: las dos columnas para el piloto.

Esfuerzo: 1 a 2 días. Toca `whatsapp-inbound` (compartido con el walk-in): probar que el walk-in
siga igual.

## 4. Fase 1 · PWA instalable

- `vite-plugin-pwa` (versión fija) con `manifest` (nombre, iconos 192/512 + maskable, `theme_color`,
  `display: standalone`, `start_url: /dashboard`) y service worker.
- Estrategia de actualización: aviso "Hay una versión nueva, toca para actualizar" (evita que el
  barbero se quede con una versión vieja en caché).
- Pantalla de instalación: botón "Instalar" en Android; en iPhone, instrucciones de "Compartir →
  Agregar a pantalla de inicio" (sin eso, iOS no permite push).
- `index.html`: `apple-touch-icon`, `theme-color`; quitar `user-scalable=no` (accesibilidad).

Esfuerzo: 1 día. Se publica con el push a `main` (Vercel, equipo Softmedia, `tumamacita.com`).

## 5. Fase 2 · Agenda viva

- **Realtime** en `appointments` (agregar la tabla a la publicación `supabase_realtime`; Realtime
  respeta RLS): la agenda se actualiza sola cuando un cliente agenda, mueve o cancela.
- Sección **"Por confirmar"** arriba: citas nuevas sin `barber_confirmed_at`, con botones
  Aceptar / Mover / Cancelar.
- **Mover** desde la app: elegir cualquier hueco libre (no solo 3) usando la misma disponibilidad
  del servidor; avisa al cliente.
- Mostrar los bloqueos de horario en la agenda del día.

Esfuerzo: 1 a 2 días.

## 6. Fase 3 · Notificaciones push

- Claves VAPID como secretos de Supabase; tabla `push_subscriptions` (barber_id, endpoint, keys,
  user_agent, created_at, last_ok_at) con RLS.
- Pedir permiso **solo desde un toque del barbero** (botón "Activar avisos"), nunca al abrir.
- Edge function `send-push` (Web Push desde Deno; validar la librería en un deploy de prueba antes
  de cablearla). Se dispara cuando el cliente agenda, mueve o cancela.
- Regla de canal para el piloto: **push + WhatsApp a la vez** (no apostar todo a la push hasta
  medir que llega). Después del piloto: push si tiene suscripción activa, WhatsApp si no.
- Tocar la notificación abre la cita. En Android se pueden poner botones en la notificación
  (Aceptar / Ver); en iPhone no hay botones, solo abre la app.
- Suscripciones vencidas (respuesta 404/410 del servicio push) se borran solas.

Esfuerzo: 2 días.

## 7. Fase 4 · Piloto

Con 2 o 3 barberos reales. Medir:
- cuántos instalan la app y activan los avisos;
- cuántas confirmaciones llegan por la app vs. por WhatsApp;
- tiempo entre cita nueva y confirmación del barbero.

## 8. Riesgos

- **Adopción:** los barberos viven en WhatsApp. Por eso WhatsApp queda de respaldo.
- **iPhone:** push solo con la app agregada a la pantalla de inicio y iOS 16.4 o más nuevo.
- **La push no garantiza entrega:** el aviso siempre queda también en la agenda (y en WhatsApp
  durante el piloto).
- **Avisos duplicados** (push + WhatsApp) durante el piloto: aceptado a propósito; se ajusta con datos.
- **`whatsapp-inbound` es compartido con el walk-in en producción:** cualquier cambio de la Fase 0
  se prueba contra el walk-in antes del deploy.

## 9. Fuera de alcance

- App para el cliente; publicación en tiendas.
- Vista de dueño de barbería con varios barberos (v2, ya fuera del MVP en el PRD).
- Zona horaria configurable en el frontend (hoy fija en America/New_York; sirve para NC).

## 10. Decisiones para Francisco

1. ¿Push **y** WhatsApp a la vez durante el piloto? (recomendado: sí)
2. Nombre e icono de la app en la pantalla del teléfono.
3. Qué 2 o 3 barberos hacen el piloto.

**Total estimado:** 5 a 7 días de trabajo, en este orden: Fase 0 → 1 → 2 → 3 → piloto.
