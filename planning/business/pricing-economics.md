# Mamacita — Economía de los tiers y estrategia de proveedor de voz

**Fecha del análisis:** 2026-06-10
**Status:** vigente — revisar cuando haya telemetría real del piloto
**Contexto:** análisis surgido al evaluar el modelo de 3 tiers propuesto en reunión con socios NXTUP ($47 / $87 / $120). Francisco pidió explícitamente que este detalle NO se olvide.

---

## Los 3 tiers: el de voz tiene un problema de margen

### Tier WhatsApp (+$40) — el negocio redondo

Una conversación completa de WhatsApp (agendar cita, confirmar, recordar) cuesta entre **$0.03 y $0.08**: Meta cobra centavos por conversación y el LLM con un modelo económico cuesta casi nada. Aunque un shop tenga 300 conversaciones al mes, el costo es ~$15. Sobre $40 de incremento, **el margen es 60-75%**.

Además, no depende de ninguna plataforma tipo VAPI: WhatsApp Business API (ya integrado) + el LLM directo. **Todo nuestro.**

### Tier voz (+$33) — el frágil

Una llamada por VAPI cuesta ~$0.10-0.15/min todo incluido. Las llamadas de walk-in son cortas (1.5-2.5 min), es decir ~$0.30 por llamada. Sensibilidad:

| Llamadas/mes del shop | Costo de voz aprox. | Margen sobre +$33 |
|---|---|---|
| 60 | ~$18 | ~$15 ✅ apretado |
| 110 | ~$33 | $0 ⚠️ break-even |
| 200+ | ~$60 | **negativo** ❌ |

**Un shop exitoso (que es justo el que quieres) puede hacer perder plata en el tier de voz.**

### Tres salidas posibles (el piloto decide con datos)

1. **Subir el incremento de voz** — ej. +$53, tier a $140
2. **Incluir un tope** — "hasta 120 llamadas/mes incluidas, después $0.35/llamada"
3. **Bajar el costo por minuto** cambiando de proveedor de voz (ver abajo)

> Por esto la tabla `calls` con costo por llamada es **no-opcional** en el sprint: es la que define el pricing final.

---

## Escenario evaluado (2026-06-10): bajar el tier WhatsApp a +$30 ($77)

Pregunta de Francisco: ¿y si el tier WhatsApp baja de +$40 a +$30?

- **Margen:** aguanta sin problema — costo real ~$5-15/shop/mes, margen sigue ~70%
- **Efecto escondido positivo:** con tier 3 fijo en $120, el incremento de voz sube de $33 a **$43** → break-even del tier frágil mejora de ~110 a **~143 llamadas/mes**
- **Costo oculto:** $10/shop/mes menos en el producto de volumen. Con 100 shops tier 2 = $12K/año menos. Bajar precio después es fácil; subirlo, casi imposible.

**Recomendación registrada:** mantener $87 de lista + descuento founding members ($77 garantizado 6-12 meses para los primeros 20-30 shops). Logra la adopción del $77 sin regalar el precio de lista a perpetuidad. Si los socios prefieren $77 plano: no es un error, es plata dejada en la mesa — y de paso mejora la economía del tier voz.

**✅ DECISIÓN (2026-06-10):** Francisco confirmó: $77 founding por 6 meses → sube a $87 lista.

---

## Estructura final: menú à la carte (2026-06-10)

Decisión de Francisco: WhatsApp y voz son add-ons independientes — el shop arma su combo. Precios acordados:

| Combo | Lista | Founding (6 meses) | Incremento sobre base |
|---|---|---|---|
| NXTUP solo | $47 | — | — |
| + WhatsApp | $87 | $77 ✅ | +$40 |
| + Voz (sin WhatsApp) | $100 | $90 | +$53 |
| + Ambos | $130 | $120 | +$83 (bundle: $10 menos que à la carte) |

**Por qué funcionan:**
- Voz a +$53 sola → break-even ~175 llamadas/mes (vs ~110 del +$33 original)
- Bundle $130 → break-even ~240 llamadas/mes
- El descuento de $10 del bundle empuja al tier máximo en ambas direcciones de venta
- Regla founding única: $10 menos en cualquier combo con agente, 6 meses, primeros shops

---

## Plan Personal — barberos individuales (2026-06-10, borrador)

Arista de Francisco: un barbero (dentro o fuera de un shop NXTUP) quiere contratar el agente para él personalmente.

**Tratamiento:** es el producto Mamacita ORIGINAL — un profesional, su número, sus citas, su clientela. Línea directa de Mamacita, separada del plan de shop. El agente personal maneja el libro personal del barbero; NO toca la cola walk-in del shop.

**Modelo de datos:** cuenta personal = `shop` con 1 `professional`. Sin cambios de schema.

**Pricing borrador (validar con telemetría):**

| Plan Personal | Precio/mes |
|---|---|
| WhatsApp personal | $29 |
| Voz personal | $59 |
| Ambos | $79 |

**Regla de canal:**
- Barbero llega vía app/PWA de NXTUP → venta del canal NXTUP, aplica split
- Barbero llega directo a Mamacita → 100% Mamacita (no-exclusividad ya acordada)

**Implicaciones estratégicas:**
1. El Plan Personal de voz es el código que YA está en producción (single-barber + appointments) — vendible a barberos independientes desde hoy, sin esperar el sprint del shop
2. El PWA de NXTUP es canal de adquisición a costo cero ("¿Quieres tu agente personal?") — da a los socios razón extra para empujar Mamacita

**Decisión de política pendiente (Francisco + socios):** ¿el dueño del shop tiene voz sobre los agentes personales de sus barberos? Instinto: no (el libro personal es del barbero), pero presentar el upsell como feature del ecosistema, no como secreto.

---

## Estrategia de proveedor de voz: VAPI ahora, self-hosting a escala

### Ahora (piloto): VAPI se queda

- Ya está integrado; las 4 edge functions ya manejan sus quirks (formato de webhooks, tool calls, Bearer prefix)
- Migrar ahora cuesta 2-3 semanas de trabajo para ahorrar centavos en un piloto gratis con un solo shop

### Por qué NO las alternativas gestionadas

Retell (~$0.07/min de engine) y Bland (~$0.09/min todo incluido) son los competidores directos. El ahorro real contra VAPI es 10-30% — **no paga la migración**. Son movidas laterales, no mejoras.

### El verdadero ahorro: self-hosting (para después)

Stack abierto tipo **Pipecat o LiveKit Agents** (orquestación open source) + Deepgram (transcripción) + LLM económico + Cartesia (voz) + Twilio (telefonía):

- Costo: **$0.04-0.07/min — la mitad de VAPI**
- Trade-off: semanas de ingeniería + pasas de "VAPI se encarga" a "tú operas la infraestructura de voz"
- Se justifica con **30-50 shops pagando voz**, donde la diferencia son miles de dólares al año. Antes de eso, es distracción.

### La regla práctica (trigger de migración)

**VAPI hasta que la telemetría diga que el costo de voz por shop supera ~$25/mes en promedio Y haya suficientes shops para que duela.** Ese día se migra a Pipecat con números en mano.

Como toda la lógica vive en las edge functions (no en VAPI), la migración es cambiar el "oído y la boca", no el cerebro.

---

## Estrategia de proveedor de WhatsApp: Twilio ahora, Meta Cloud API directo a escala

**Decidido 2026-06-17** (tras la fricción de verificación del negocio con Meta). Análoga a la de voz.

### La fricción NO es del proveedor — es de Meta

La verificación del negocio, la aprobación de plantillas y las restricciones de cuenta son requisitos de **Meta**, iguales para CUALQUIER camino (Twilio, otro BSP, o Cloud API directo). Cambiar de proveedor **no evita** ese trámite. No migrar "huyendo" de Twilio.

### Ahora (piloto): Twilio se queda

- Ya integrado (`send-whatsapp-queue-notification` usa la API de Twilio + Content Templates).
- A bajo volumen el markup de Twilio por mensaje es marginal.
- Cambiar ahora es trabajo sin beneficio inmediato, y la verificación de Meta hay que pasarla igual.

### A escala: Meta Cloud API directo

Para WhatsApp, Twilio agrega **mucho menos valor** que VAPI para la voz: VAPI resuelve STT+LLM+TTS+telefonía (complejo); Twilio para WhatsApp es solo un **wrapper sobre una API REST ya simple** (`graph.facebook.com`). La lógica conversacional la ponemos nosotros igual. Por eso el markup de Twilio es, en gran parte, **costo puro**.

La **Meta Cloud API directa** = sin intermediario, sin markup, control total — es el "todo nuestro" que ya plantea este doc. Ya tenemos el WABA (`1943843112881806`) en nuestro Meta Business Manager, así que el envío directo es viable.

### La regla práctica (trigger de migración)

Migrar a Cloud API directo cuando el volumen de WhatsApp haga que el markup de Twilio sea material (varios shops con tier WhatsApp activo). Es un cambio **acotado**: solo cambia "cómo se envía el mensaje" (apuntar a `graph.facebook.com` en vez de `api.twilio.com`), NO la lógica ni las plantillas. Igual que en voz: cambiar la boca, no el cerebro.

---

## Implicación del tier WhatsApp sobre el código preservado

> **Reconciliación post-pivot (ver `planning/product/channels-and-tiers.md` — manda ese doc):**
> el tier WhatsApp es **el agente de entrada por TEXTO** (Julie por texto), y su función se
> adapta al shop: **walk-in → anota a la cola**; **cita → agenda**. Los **avisos salientes**
> por WhatsApp NO son el tier WhatsApp — son una capa transversal incluida con cualquier
> agente (voz o texto). El diferenciador vendible es la **conversación entrante por texto**.

Para shops con **cita** (verticales tipo dentista), el agente de WhatsApp **agenda citas** —
eso es el modelo de appointments original de Mamacita, preservado intacto en el pivot
(`appointments`, `availability_slots`, `blocked_times`).

Ese código y esas tablas vuelven a ser protagonistas en el tier intermedio, antes de lo previsto. La decisión de no borrarlas pagó dividendos.

---

## Acciones que este análisis exige

- [ ] Tabla `calls` con duración + costo VAPI + resultado por llamada (en el sprint del piloto)
- [ ] Tras 4-6 semanas de piloto: calcular costo real de voz por shop/mes
- [ ] Decidir pricing del tier voz con esos datos (subir precio / tope de llamadas / migrar proveedor)
- [ ] Renegociar split NXTUP↔Mamacita por tier (los incrementos $40 y $33 son tecnología de Mamacita)
- [ ] Re-evaluar proveedor de voz al llegar a 30-50 shops con voz activa
