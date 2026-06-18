# Mamacita — Modelo de canales y tiers (definición oficial)

**Fecha:** 2026-06-16
**Status:** definición de producto vigente — fuente de verdad para empaquetar voz vs WhatsApp
**Origen:** preguntas de Francisco al activar las notificaciones de WhatsApp. Resuelve el
solapamiento entre "el WhatsApp que dispara Julie" y "el tier de WhatsApp como producto".

> Acompaña a `pricing-economics.md` (los números) y `walk-in-queue-spec.md` (el flujo).
> Si algo aquí contradice al `pricing-economics.md`, manda este doc (es posterior y reconcilia
> el pivot a walk-in).

---

## 1. La base: 3 capacidades distintas, no 3 productos

Todo el modelo se entiende separando **tres capacidades** que la gente confunde porque
todas tocan el teléfono del cliente:

| Capacidad | Dirección | Qué es |
|---|---|---|
| **Entrada por VOZ** (Julie) | cliente → shop | El cliente **llama**, un agente de voz lo atiende, da disponibilidad y lo anota |
| **Entrada por TEXTO** (WhatsApp conversacional) | cliente → shop | El cliente **escribe**, un agente de texto lo atiende — lo mismo que Julie, por texto |
| **Avisos SALIENTES** (WhatsApp one-way) | shop → cliente | El sistema **le escribe** al cliente: "estás en la lista", "ya casi te toca", y al dueño "te dejaron un mensaje" |

**La regla de oro:** los **avisos salientes NO son "el tier WhatsApp"**. Son una capa
transversal que viene con cualquier agente (voz o texto). El tier WhatsApp es **la entrada
conversacional por texto** — eso es lo que se vende.

Si vendes los avisos como "el producto WhatsApp", te quedas sin diferenciador real.

---

## 2. Salida (avisos) ≠ Conversación (agente)

Esta es la distinción que evita que voz y WhatsApp se pisen:

- **Avisos = una vía.** El sistema te escribe, tú no conversas. Lo dispara cualquier agente.
- **Tier WhatsApp = dos vías.** El cliente **le escribe al shop** ("¿hay cupo?", "anótame",
  "¿cuánto falta?") y un agente de texto **le responde y lo atiende**.

> **Julie = entrada por voz. Tier WhatsApp = entrada por texto.** Misma inteligencia (lee la
> cola de NXTUP, anota igual), distinto canal de entrada.

---

## 3. Qué hace el agente de texto (reconciliación con el pivot)

El `pricing-economics.md` (junio 10, pre-pivot) decía que el tier WhatsApp "agenda citas".
Post-pivot a walk-in, la función del agente de texto **se adapta al modelo del shop**:

- **Shop walk-in** (barbería piloto): el agente de texto **anota a la cola** — Julie por texto.
- **Shop con cita** (verticales futuros: dentista, etc.): el agente de texto **agenda citas**
  (usa las tablas `appointments`/`availability_slots` preservadas).

Es el **mismo agente, mismo cerebro**; cambia lo que hace con la reserva según el negocio.

---

## 4. Empaquetado en tiers

Alineado con `pricing-economics.md` (menú à la carte, 2026-06-10):

| Tier | Lista | Founding | Entrada del cliente | Quién atiende | Avisos salientes |
|---|---|---|---|---|---|
| **NXTUP solo** | $47 | — | En persona (kiosk) | Nadie automático | — |
| **+ WhatsApp** | $87 | $77 | **Escribe** al WhatsApp | Agente de **texto** | ✅ |
| **+ Voz (Julie)** | $100 | $90 | **Llama** por teléfono | Julie (**voz**) | ✅ |
| **+ Ambos** | $130 | $120 | Llama **o** escribe | Julie + agente texto | ✅ |

**Pitch de venta por canal:**
> "¿Tus clientes prefieren **llamar**? → Julie. ¿Prefieren **escribir** por WhatsApp? → el
> tier WhatsApp. ¿Los dos? → el combo."

---

## 5. Manejo del cliente que responde a un aviso

**Verdad técnica: no se puede impedir que respondan.** WhatsApp es bidireccional por diseño;
cualquier número que envía, puede recibir. No existe un WhatsApp "de solo lectura". Así que no
se *evita* — se *maneja con gracia* para que nadie quede en visto. Dos capas:

1. **Prevención (en el propio aviso):** una línea que deja claro que no es un chat.
   > "📋 Mensaje automático. Para anotarte o preguntar, **llama al (984) xxx-xxxx** o ven
   > directo. ¡Te esperamos!"
2. **Captura (autoresponder):** si responden igual, un mensaje los redirige.
   > "Este número solo envía avisos 🤖. Llámanos al (984) xxx-xxxx y con gusto te ayudamos."

### El autoresponder ES el interruptor entre tiers

El **mismo número** se comporta distinto según lo que el shop pagó. Cuando el cliente responde,
**abre una ventana de 24h** de conversación (así funciona WhatsApp):

| El cliente responde al WhatsApp… | Shop **sin** tier WhatsApp (solo voz/base) | Shop **con** tier WhatsApp |
|---|---|---|
| "¿cuánto falta?" | Autoresponder: "llámanos al…" | **El agente de texto le responde** y lo atiende |

Ahí vive el upsell natural: *"¿Quieres que cuando te escriban, alguien les responda? Ese es el
tier WhatsApp."*

**Arquitectura recomendada: un solo número, comportamiento según tier.** No duplicar números
(caro y confuso). El webhook de mensajes entrantes de Twilio identifica a qué shop pertenece el
cliente y su tier → o autoresponder, o agente.

---

## 6. Estado de implementación

| Pieza | Estado |
|---|---|
| Avisos salientes — código (`send-whatsapp-queue-notification`) | ✅ construido, disparado por `vapi-join-queue` |
| Avisos salientes — entrega real | ⚠️ **falta registrar plantillas en Twilio** (sin ellas no llegan; ver §5 de `walk-in-queue-spec.md`) |
| Aviso "ya casi te toca" | ⚠️ depende del webhook NXTUP→Mamacita (`turn_approaching`), pendiente |
| Webhook entrante de Twilio (autoresponder + ruteo por tier) | ❌ no construido |
| Agente conversacional de texto (el tier WhatsApp) | ❌ roadmap — reutiliza el cerebro de Julie + tablas de citas |

**Orden sugerido cuando se retome:**
1. Registrar las 3 plantillas en Twilio → activar avisos salientes (rápido, manual).
2. Webhook entrante con autoresponder (capa de respeto al cliente; barata).
3. Agente conversacional de texto = el tier WhatsApp vendible.
