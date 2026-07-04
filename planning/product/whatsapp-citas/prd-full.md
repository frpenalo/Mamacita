# PRD: Agente de Citas por WhatsApp (Mamacita)

**Version:** 1.0
**Date:** 2026-06-30
**Status:** Draft — discovery completado con Francisco (prd-builder)
**Nombre de trabajo:** "Mamacita Agenda" (nombre comercial por definir — ver §12)

> **Qué es en una línea:** un agente conversacional de **texto por WhatsApp** que atiende a
> los clientes de un barbero/barbería para **agendar, reprogramar y cancelar citas a hora
> fija**, con recordatorios automáticos. Es un **producto autónomo**, independiente del agente
> de voz (Julie) y de la cola walk-in de NXTUP — pero diseñado para **enlazarse al ecosistema
> Mamacita** cuando un dueño quiera el combo completo.

> **Relación con la doc existente:** este producto es la materialización del **agente de texto
> para "shops con cita"** descrito en [`channels-and-tiers.md`](../channels-and-tiers.md) §3, y
> del **Plan Personal WhatsApp** de [`pricing-economics.md`](../../business/pricing-economics.md).
> Reutiliza el modelo de citas original preservado del repo (antes `tu-cita-pro`).

---

## 1. Vision & Problem Statement

**Problema.** Los barberos y barberías pierden tiempo y citas gestionando su agenda por
mensajes sueltos, llamadas y DMs: el cliente escribe "¿tienes hueco el sábado?", el barbero
contesta cuando puede, se cruzan horarios, se olvidan citas y aparecen los *no-shows*. No todos
quieren un agente de **voz** (Julie) ni una cola walk-in — muchos simplemente quieren que su
clientela **agende sola, por texto, sin fricción**.

**Solución.** Un número de WhatsApp con un agente que conversa en español/inglés, **consulta la
disponibilidad real** del barbero (citas ya hechas + tiempos bloqueados + horario de trabajo),
**agenda la cita al instante**, y le manda al cliente recordatorios automáticos. El barbero
recibe aviso de cada cita y puede confirmarla/rechazarla desde el propio WhatsApp; gestiona el
resto desde un dashboard que **ya existe**.

**Éxito para el usuario:**
- *Cliente:* agenda su corte en 4-5 mensajes, a cualquier hora, sin llamar ni esperar.
- *Barbero:* su agenda se llena sola, con menos no-shows (por los recordatorios) y sin estar
  pegado al teléfono contestando.

---

## 2. Target Users

**Mercado inicial:** barberías y barberos individuales en **Carolina del Norte** (mercado de
**cita a hora fija**, no walk-in — decisión de Francisco basada en su experiencia de mercado).
Expandible a otras verticales de cita (uñas, spa, dentista) después.

**Fase de prueba:** 2-3 barberos reales, **onboarding asistido** (los da de alta el equipo
Mamacita — ver §5). Volumen bajo a propósito, para aprender la fricción real antes de escalar.

| Persona | Descripción | Qué necesita |
|---|---|---|
| **Cliente final** | El que quiere un corte. No es técnico, vive en WhatsApp. | Agendar/mover/cancelar por texto, sin instalar ni registrarse. |
| **Barbero individual** | Trabaja solo (dentro o fuera de una barbería). Paga su propio plan. | Que su clientela agende sola; controlar su horario y bloqueos; confirmar citas. |
| **Dueño de barbería** | Tiene varios barberos. Paga por la barbería. | Un solo canal para todos sus barberos; ver/gestionar la agenda de cada uno. |
| **Admin plataforma (Mamacita)** | El equipo (Francisco). | Dar de alta cuentas, generar links, control central, habilitar el futuro bundle. |

---

## 3. MVP Scope

### In Scope (v1)
- **Agendar cita** por WhatsApp — el agente consulta disponibilidad real y **confirma al
  instante** (con reserva atómica anti-choque; ver §7).
- **Reprogramar** una cita existente (cliente por WhatsApp; barbero por dashboard).
- **Cancelar** una cita (cliente por WhatsApp; barbero por WhatsApp o dashboard).
- **Elegir barbero** — SOLO si la cuenta tiene varios (barbería). Si es un solo barbero, se
  omite el paso.
- **Recordatorios automáticos** al cliente: **24 h antes + ~2 h antes**.
- **Aviso al barbero** de cada cita nueva por WhatsApp, con botones **Confirmar / Rechazar**.
- **Dashboard del barbero/dueño** (reutilizado de tu-cita-pro): ver agenda, bloquear tiempo,
  definir horario, reprogramar, marcar completada/no-show, ver clientes.
- **Cliente sin login** — todo se resuelve por WhatsApp, sin cuenta ni app.
- **Número compartido** `+19844009792` + **link personalizado por cuenta** (ver §7/§10).

### Out of Scope (v2+)
- **Elegir servicio** (corte vs. barba vs. diseño con duraciones/precios distintos) → v2.
- **Pago / depósito** en línea al agendar → v2.
- **Cuenta mixta** (una barbería paga Y algunos de sus barberos pagan aparte) → v2. El modelo se
  diseña para soportarlo, pero no se construye ahora.
- **Número dedicado premium** (número propio por cuenta) → v2, como add-on de pago.
- **Formulario de auto-registro público** para barberos → v2 (en la prueba es onboarding
  asistido).
- **Bundle sincronizado** con voz (Julie) y queue NXTUP → futuro; solo se dejan los **ganchos**
  en el modelo de datos ahora (ver §9).

### Hard constraints
- Reutilizar el código y las tablas de citas existentes (no reconstruir).
- No acoplar a NXTUP ni a la voz (producto autónomo).
- Coordinar con Francisco antes de cualquier cambio que toque el repo de NXTUP (no aplica aquí,
  pero queda anotado).

---

## 4. User Roles & Permissions

| Role | Puede | No puede |
|---|---|---|
| **Cliente final** | Agendar, reprogramar, cancelar sus propias citas por WhatsApp | Ver la agenda de otros; entrar al dashboard; login |
| **Barbero individual** | Gestionar su agenda, horario y bloqueos; confirmar/rechazar/reprogramar/cancelar sus citas; ver sus clientes | Ver/tocar la agenda de otros barberos |
| **Dueño de barbería** | Todo lo del barbero, para **todos** los barberos de su barbería; alta/baja de barberos de su cuenta | Tocar cuentas de otras barberías |
| **Admin plataforma** | Crear cuentas, generar links, configurar, soporte, habilitar bundle | — |

---

## 5. Authentication & Access

- **Cliente final:** **sin autenticación.** Se identifica por su **número de WhatsApp**; su
  vínculo con el barbero se establece por el **link personalizado** (código en el mensaje
  pre-llenado). Ver §7.
- **Barbero / Dueño:** login con **email + contraseña** (Supabase Auth, ya implementado en el
  dashboard existente). Cada uno ve solo su cuenta (aislamiento por RLS).
- **Onboarding (fase de prueba): asistido / admin-created.** El equipo Mamacita crea la cuenta
  del barbero, carga su horario y genera su link. **Decisión:** no construir formulario de
  auto-registro en v1 — para 2-3 barberos no paga, y el onboarding manual enseña la fricción
  real. El self-service se construye en v2 al escalar.

---

## 6. Screens & Navigation

### Screen List (dashboard — reutilizado de tu-cita-pro)
1. **Login**
2. **Dashboard / Agenda** — vista de citas del día/semana (`Dashboard.tsx`)
3. **Configuración / Horario** — horario de trabajo + bloqueos de tiempo (`Settings.tsx`,
   tabla `blocked_times`)
4. **Nueva cita (manual)** — el barbero agenda a mano si hace falta (`NewAppointmentDialog.tsx`)
5. **Acciones de cita** — confirmar / reprogramar / cancelar / completada / no-show
   (`AppointmentActions.tsx`, ya existe)
6. **Clientes** — libreta de clientes (`Clients.tsx`, `ClientDetailDialog.tsx`)
7. **(Barbería) Selector de barbero** — el dueño cambia entre barberos de su cuenta

> El **cliente final no tiene pantallas**: su interfaz es el chat de WhatsApp.

### Primary User Flow — Cliente agenda (WhatsApp)
1. El cliente toca el **link del barbero** (`wa.me/19844009792?text=agendar-con-<código>`).
2. Se abre WhatsApp con el mensaje pre-llenado → lo envía.
3. El agente **identifica al barbero** por el código y saluda como su asistente.
4. Cliente dice qué quiere ("un corte el sábado en la tarde").
5. El agente **consulta disponibilidad real** (citas + bloqueos + horario) y ofrece 2-3 huecos.
6. Cliente elige uno.
7. El agente **reserva atómicamente** el hueco → **cita confirmada al instante**.
8. El agente confirma por texto y **avisa al barbero** (botones Confirmar/Rechazar).
9. **Recordatorios** automáticos: 24 h antes + ~2 h antes.

### Secondary Flows
- **Reprogramar/cancelar (cliente):** escribe al mismo número → el agente reconoce su número,
  muestra su cita, ofrece mover o cancelar → libera el hueco / reasigna.
- **Barbero confirma/rechaza:** al llegar el aviso, toca **Confirmar** (cita queda firme) o
  **Rechazar** (cita se cancela y el cliente recibe aviso + opción de reagendar).
- **Barbero bloquea tiempo:** en el dashboard marca almuerzo/personal → el agente deja de
  ofrecer esos huecos.
- **Imprevisto del barbero:** reprograma/cancela desde el dashboard → el cliente recibe aviso.

---

## 7. Feature Specifications

### 7.1 Identificación por número compartido + link
- **Descripción.** Un solo número (`+19844009792`) sirve a todas las cuentas. Cada barbero tiene
  un **link con su código**. Al entrar por el link, el sistema **amarra** el número del cliente a
  ese barbero y lo recuerda para conversaciones futuras.
- **Acceptance criteria.**
  - Un mensaje entrante con código `X` se rutea a la cuenta `X`.
  - Un cliente ya amarrado que escribe sin link se rutea a su barbero previo.
  - 300+ clientes de decenas de barberos conversan por el mismo número **sin cruzarse** (par
    único `teléfono-cliente → barbero`).
  - Caso borde (un cliente con dos barberos): se re-amarra por el último link usado, o el agente
    pregunta con cuál agenda.

### 7.2 Agendar con disponibilidad real + reserva atómica ⭐
- **Descripción.** Antes de ofrecer y antes de confirmar, el agente consulta: (a) citas ya
  agendadas, (b) `blocked_times`, (c) horario de trabajo. **Nunca** ofrece un hueco ocupado,
  bloqueado o fuera de horario. Reutiliza el motor `src/lib/slots.ts`.
- **Reserva atómica.** La escritura de la cita usa un `INSERT`/`UPDATE` condicional que falla si
  el hueco fue tomado entre la oferta y la confirmación (mismo patrón que el fix de NXTUP). Si
  dos clientes piden el mismo hueco a la vez, **solo uno gana**; al otro se le ofrece
  inmediatamente otra hora.
- **Acceptance criteria.**
  - No existen dos citas confirmadas para el mismo barbero en el mismo intervalo.
  - Un hueco bloqueado/fuera de horario nunca se ofrece ni se agenda.
  - Bajo dos solicitudes simultáneas del mismo hueco, la BD termina con exactamente una cita y el
    perdedor recibe alternativas sin error visible.
  - La cita queda en estado **confirmada** al instante (opción A).

### 7.3 Reprogramar
- Cliente o barbero mueven una cita a otro hueco disponible; se libera el original y se
  re-reserva atómicamente el nuevo. Ambas partes reciben el nuevo detalle.
- **Done:** la cita refleja el nuevo horario; el hueco viejo queda libre; se notifica a las dos
  partes.

### 7.4 Cancelar
- Cliente (WhatsApp) o barbero (WhatsApp/dashboard) cancelan; el hueco se libera; se notifica.
- **Done:** estado `cancelled`; hueco disponible de nuevo; recordatorios pendientes cancelados.

### 7.5 Elegir barbero (condicional)
- Si la cuenta tiene **>1** `professional`, el agente pregunta con cuál; si tiene 1, lo omite.
- **Done:** en cuentas multi-barbero la cita queda asignada al barbero elegido; en single, al
  único, sin preguntar.

### 7.6 Recordatorios automáticos
- **24 h antes** (reduce no-shows) y **~2 h antes** (empujón final), vía WhatsApp.
- Programados con `pg_cron` / cola de recordatorios; se cancelan si la cita se mueve/cancela.
- **Done:** cada cita confirmada dispara ambos recordatorios en su ventana; una cita
  cancelada/movida no envía recordatorios obsoletos.

### 7.7 Aviso al barbero + confirmar/rechazar
- Cada cita nueva genera un WhatsApp al barbero: cliente + fecha/hora, con botones
  **Confirmar / Rechazar** (quick-reply). Confirmar → firme; Rechazar → cancela + avisa al
  cliente con opción de reagendar. (La cita nace confirmada; esto es el control del barbero
  "por si surge un imprevisto".)
- **Done:** el barbero recibe el aviso <1 min tras agendar; su respuesta actualiza el estado y
  notifica al cliente cuando corresponde.

---

## 8. Notifications & Communication

Canal único: **WhatsApp** (Twilio ahora → Meta Cloud API a escala; ver §10).

| Disparador | Para quién | Contenido | Tipo |
|---|---|---|---|
| Cita agendada | Cliente | Confirmación con fecha/hora/barbero | Sesión (respuesta) |
| Cita agendada | Barbero | Aviso + botones Confirmar/Rechazar | Plantilla + quick-reply |
| Recordatorio 24 h | Cliente | "Mañana tienes tu cita con X a las …" | Plantilla |
| Recordatorio ~2 h | Cliente | "Tu cita es en 2 horas…" | Plantilla |
| Reprogramada | Ambos | Nuevo horario | Sesión/Plantilla |
| Cancelada | Ambos | Aviso + (al cliente) opción de reagendar | Sesión/Plantilla |
| Barbero rechaza | Cliente | Aviso + reagendar | Plantilla |

> Idioma: **sigue al cliente** (es/en), igual que las notificaciones ya construidas. Las
> plantillas fuera de la ventana de 24 h deben estar **registradas y aprobadas en Twilio/Meta**.

---

## 9. Data Architecture

### Core Entities (existentes — reutilizadas)
| Entity | Key Fields | Notes |
|---|---|---|
| `shops` | id, name, **business_id**, **enabled_products**, hours_text | La **cuenta**. Individual = shop con 1 professional; barbería = shop con N. **Gancho del bundle** (ver abajo). |
| `professionals` | id, shop_id, name, **wa_code**, active | Cada barbero. `wa_code` = el código del link personalizado. |
| `appointments` | id, professional_id, client_phone, client_name, start_time, end_time, status, language | Estados: confirmed / rescheduled / cancelled / completed / no_show. |
| `availability_slots` | id, professional_id, weekday, start, end | Horario de trabajo base. |
| `blocked_times` | id, professional_id, start, end, reason | Tiempo apartado por el barbero. |

### Core Entities (nuevas — canal WhatsApp)
| Entity | Key Fields | Notes |
|---|---|---|
| `wa_sessions` | id, client_phone, professional_id, last_active | El **amarre** cliente→barbero (§7.1). Ventana de 24 h de WhatsApp. |
| `wa_messages` | id, session_id, direction, body, created_at | Log de la conversación (auditoría + contexto del LLM). |
| `reminders` | id, appointment_id, fire_at, kind (24h/2h), status | Cola de recordatorios; `pg_cron` la drena. |

### Ganchos para el bundle (puerta abierta — §4 de Francisco)
- **`shops.business_id`** — identificador de **negocio** común. Hoy cada cuenta tiene el suyo;
  el día del combo, la cuenta de citas, la de voz (Julie) y la de queue (NXTUP) de un mismo
  dueño **comparten `business_id`** → se sincronizan y Mamacita mantiene control central.
- **`shops.enabled_products`** — p.ej. `{citas_wa, voz, queue}` — qué productos tiene activo el
  negocio. Permite el combo sin cambiar el schema después.
- **No se acopla nada hoy**: el producto funciona solo; los ganchos solo **existen** para el
  futuro.

### Key Relationships
`shops (1) → (N) professionals (1) → (N) appointments`. Disponibilidad de un professional =
`availability_slots` − `blocked_times` − `appointments` activas. `wa_sessions` mapea cada
teléfono de cliente al `professional` con quien conversa.

### Seguridad
- **RLS** por `shop_id`: cada barbero/dueño ve solo su cuenta. (Aprender de la brecha RLS de
  NXTUP — la PII de clientes debe estar aislada desde el día 1.)
- El `client_phone` es PII → acceso restringido por RLS; nunca expuesto entre cuentas.

---

## 10. Technical Stack & Integrations

### Suggested Stack (todo ya en uso en el repo)
- **Frontend (dashboard):** Vite + React + TypeScript + shadcn/ui + Tailwind (existente).
- **Backend/DB:** **Supabase** — Postgres + Edge Functions (Deno) + Auth + RLS + `pg_cron`
  (recordatorios). Es donde ya viven las edge functions de Mamacita.
- **Canal WhatsApp:** **Twilio** WhatsApp Business API (Content Templates + webhook entrante
  HMAC) → migrar a **Meta Cloud API directa** a escala (regla en `pricing-economics.md`).
- **Cerebro del agente:** **un LLM económico con function calling.** Recomendación:
  **GPT-4o-mini** (function calling maduro, buen español, ~centavos por conversación). Es
  **intercambiable** — la lógica vive en las edge functions (mismas herramientas: `get_slots`,
  `book`, `reschedule`, `cancel`), así que cambiar de LLM es cambiar el "cerebro", no el flujo.
  Alternativa de menor costo: Gemini Flash.

### External Integrations
- **Twilio WhatsApp** — enviar/recibir mensajes, plantillas, quick-reply. Sender de producción
  `+19844009792` ya verificado con Meta (Softmedia, LLC).
- **LLM (GPT-4o-mini)** — interpretar el mensaje y llamar las herramientas de agenda.
- **Supabase pg_cron** — disparar recordatorios y la limpieza de sesiones.

### Deployment & Infrastructure
- **Dashboard:** Vercel (o el hosting actual del repo).
- **Backend:** Supabase (proyecto Mamacita — DB propia; credenciales solo de esa DB).
- **Número:** compartido `+19844009792` para todas las cuentas de la prueba.
- **Entornos:** producción para el piloto; sin staging separado por ahora (volumen bajo).
- **Escala inicial:** 2-3 barberos, decenas–cientos de clientes/mes. El número compartido y
  Twilio (80 MPS) sobran para eso.

---

## 11. UI/UX Guidelines

- **Dashboard:** reutiliza el estilo **"lujo premium"** ya existente en el repo (paleta oscura
  elegante). Mobile-first — el barbero gestiona desde el teléfono.
- **Chat (cliente):** tono cálido, breve, bilingüe (sigue al cliente). Mensajes cortos, con la
  info clave (fecha, hora, barbero) siempre explícita. Botones de quick-reply donde WhatsApp los
  permita.
- **Marca:** Mamacita. El nombre del asistente de texto está por definir (podría ser "Julie por
  texto" para unificar marca, o un nombre propio — ver §12).

---

## 12. Open Questions

1. **Pricing standalone de barbería.** El Plan Personal WhatsApp está en **$29/mes** (barbero
   individual). El tier WhatsApp de **$77/$87** de `pricing-economics.md` incluye la base NXTUP
   ($47). Falta fijar el precio del producto **autónomo de barbería** (sin NXTUP). → Francisco
   decide con datos del piloto.
2. **Nombre comercial** del producto y **nombre del asistente** de texto.
3. **Número dedicado premium (v2):** confirmar precio del add-on y flujo de provisión (número
   Twilio propio + verificación Meta por cuenta).
4. **Política del bundle:** cuando un dueño de barbería tenga el combo, ¿qué control tiene sobre
   los agentes personales de barberos que pagan aparte? (Ya anotado como pendiente en
   `pricing-economics.md`.)
5. **Servicios (v2):** al añadir "elegir servicio", definir duraciones/precios por servicio para
   que la disponibilidad los respete.

---

## 13. Success Metrics

1. **% de citas agendadas sin intervención humana** (meta: >80% de las conversaciones que
   empiezan terminan en cita, sin que el barbero teclee).
2. **Reducción de no-shows** con los recordatorios 24 h + 2 h (meta: no-show < 10%).
3. **Tiempo de respuesta del agente** por mensaje (meta: < 3 s).
4. **Citas por barbero/semana** vía WhatsApp (adopción real).
5. **Satisfacción del barbero** en la prueba (¿lo renovaría? ¿le quitó trabajo?) — señal
   cualitativa para decidir el pricing y el self-service de v2.
