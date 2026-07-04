# NVIDIA Build / NIM — evaluación para Mamacita

**Fecha:** 2026-06-25
**Tipo:** investigación / recomendación (NO implementación)
**Contexto:** Mamacita = agente de voz "Julie" (walk-in queue), hoy sobre VAPI (telefonía +
STT Deepgram Nova 3 + LLM + TTS) + edge functions + Twilio WhatsApp. Estrategia de proveedor
de voz ya definida en `planning/business/pricing-economics.md`: **VAPI ahora → self-host
(Pipecat/LiveKit) a escala**.

---

## Insight clave (leer primero)

**NVIDIA NO reemplaza VAPI hoy.** VAPI es el *orquestador* de la llamada (telefonía + turnos
+ barge-in + latencia). NVIDIA Build ofrece dos cosas distintas:

1. **Componentes sueltos vía API hosted** (`build.nvidia.com`) que se integran HOY en las edge
   functions sin tocar la voz: LLM (Nemotron), OCR, embeddings/rerank, safety.
2. **El stack de voz completo para self-host** (Riva ASR + Magpie TTS + Nemotron sobre
   `nvidia-pipecat`) — que es EXACTAMENTE la opción "self-host a escala" que ya está en
   nuestra estrategia. Encaja como el proveedor de modelos para esa fase, pero requiere GPUs.

El modelo de acceso lo confirma: free tier (1.000 créditos / 40 RPM, sin tarjeta) para
prototipar; pay-as-you-go en endpoints hosted; self-host = licencia NVIDIA AI Enterprise +
GPUs (precio por ventas, sin lista pública).

---

## 1. Modelos / APIs relevantes

| Necesidad | Modelo NVIDIA | Notas para Mamacita |
|---|---|---|
| **STT español** | **Parakeet 0.6B ES-EN unified** (bilingüe) · **Canary-1b** (es-US, es-ES, multilingüe) | Riva soporta **streaming gRPC <300ms** (apto telefonía). Parakeet ES-EN bilingüe = ideal para nuestra clientela es/en. |
| **TTS natural** | **Magpie TTS Multilingual** (incluye español europeo, voz M/F, real-time, voice cloning zero-shot) | Disponible como NIM hosted (sin GPU local para probar). |
| **LLM (cerebro de Julie)** | **Llama Nemotron** (Nano / Super / Ultra) con **function calling** | Tool calling para `join_queue`/`take_message`. Eficiente, optimizado NVIDIA. |
| **Embeddings + Rerank** | **NeMo Retriever** (Embedding NIM + Reranking NIM) | Para una knowledge base del negocio (FAQs, políticas) — RAG. |
| **OCR** | **NeMo Retriever Image OCR NIM** | Leer foto de lista de servicios/precios → texto. Onboarding. |
| **Safety / moderación** | **Llama 3.1 NemoGuard 8B ContentSafety** (23 categorías) + **TopicControl** + **JailbreakDetect**; orquestados con **NeMo Guardrails** | Verificar input/output antes de responder al cliente. |
| **Armazón listo** | **ACE Agent** + **nvidia-pipecat** (voice-agent-examples) + **AI Virtual Assistant blueprint** | Referencia para el self-host de voz con RAG + guardrails. |

## 2. Cómo aplican al flujo real de Mamacita

- **OCR → onboarding:** el dueño manda una **foto** de su cartel de servicios/precios → OCR
  extrae el texto → llena `services_text` / `hours_text` automáticamente. Hoy eso se teclea a
  mano por shop. Es el encaje más directo y de mayor ROI inmediato.
- **LLM Nemotron → cerebro de Julie:** se puede apuntar VAPI a un "custom LLM" (Nemotron via
  API) o usarlo en las edge functions. Aporta si baja costo/latencia vs el LLM actual.
- **RAG (NeMo Retriever) → respuestas del negocio:** que Julie conteste preguntas fuera del
  prompt (políticas, "¿hacen diseños?", "¿aceptan tarjeta?") desde una base de conocimiento.
- **Safety (NemoGuard) → antes de responder:** capa de moderación input/output. Valor
  incremental (el LLM ya trae algo de seguridad).
- **Riva ASR + Magpie TTS → reemplazo de la voz a escala:** la "boca y el oído" del self-host
  cuando VAPI deje de convenir (~30-50 shops, según pricing-economics.md). NVIDIA + pipecat ES
  esa ruta.

## 3. Integraciones útiles AHORA (bajo esfuerzo)

**Honestidad:** el OCR de onboarding —que sería el quick-win obvio— **ya está resuelto con
Gemini (VLM)** (ver memoria `reference_ocr_open_source`). Así que NVIDIA **no tiene un
"quick win" de producción para Mamacita HOY**; su valor es sobre todo **estratégico/futuro**
(el self-host de voz). Lo único accionable ahora es **VALIDAR** (experimentar), no integrar:
1. **Probar la voz de NVIDIA en español** (Magpie TTS + Canary/Parakeet ASR) en el free tier,
   para saber si NVIDIA será la opción del self-host cuando llegue ese día (ver §6).
2. (Opcional) **Evaluar Nemotron como LLM** — costo/latencia/calidad vs el LLM actual de VAPI.

## 4. Integraciones para DESPUÉS

- **Stack de voz self-host (Riva ASR + Magpie TTS + Nemotron sobre pipecat)** — la fase de
  "self-host a escala". Requiere GPUs (costo operativo real). Se justifica con 30-50 shops de
  voz, NO en el piloto. Pero ya sabemos que **NVIDIA es candidato fuerte** para ese día.
- **RAG / knowledge base** (NeMo Retriever embeddings+rerank) — cuando los shops tengan FAQs/
  políticas que valga la pena indexar. Hoy el negocio es simple (servicios + horario en texto).
- **Safety con NemoGuard** — cuando el volumen y el riesgo de respuestas justifiquen una capa
  dedicada.

## 5. Qué DESCARTO (sin valor inmediato)

- **OCR de NVIDIA (NeMo Retriever OCR):** el caso de uso (foto de cartel/menú → datos del
  negocio) **ya está cubierto con Gemini VLM** (`reference_ocr_open_source`). NVIDIA OCR no
  supera lo que ya funciona; cambiar sería esfuerzo sin ganancia.
- **Reemplazar Deepgram/STT ahora:** Nova 3 ya resolvió el español. Cambiar el STT sin razón
  añade riesgo. (Riva entra en la fase self-host, no antes.)
- **Self-host de voz HOY:** GPUs caras para 1 shop; VAPI es más simple y barato a bajo volumen.
- **Embeddings/rerank ahora:** no hay una base de conocimiento grande que justifique RAG aún.
- **Voice cloning de Magpie ahora:** no es un dolor del producto hoy.

## 6. Primer experimento técnico (para validar)

**La VOZ de NVIDIA en español, contra el free tier de `build.nvidia.com`.** (El OCR habría
sido el quick-win, pero ya está cubierto por Gemini — así que validamos lo que SÍ es el futuro
de Mamacita: el self-host de voz.)
- **Qué:** (a) generar con **Magpie TTS Multilingual (español)** el saludo de Julie y un par de
  mensajes de disponibilidad, y comparar naturalidad vs el TTS actual de VAPI; (b) pasar clips
  de audio reales en español (es-US, acento latino/dominicano, con code-switching es/en) por
  **Canary/Parakeet ASR** y comparar la transcripción con Deepgram Nova 3.
- **Por qué este:** alineado con el interés (TTS natural + STT español), **cero riesgo** (no
  toca producción), gratis (free tier), y responde la pregunta que de verdad importa: *¿la voz
  de NVIDIA en español es lo bastante buena para ser nuestro self-host a escala?*
- **Criterio de éxito:** TTS español natural y sin errores de pronunciación; ASR que iguale o
  supere a Nova 3 en español latino + code-switching.
- **Segundo experimento (si la voz convence):** prototipo mínimo con `nvidia-pipecat` (Riva ASR
  + Magpie TTS + Nemotron) para medir latencia end-to-end vs VAPI.

---

## Fuentes
- ASR: Canary/Parakeet multilingüe (es-US, es-ES), NIM support matrix · build.nvidia.com
- TTS: Magpie TTS Multilingual (español, real-time) · build.nvidia.com
- LLM: Llama Nemotron (function calling, agentic) · build.nvidia.com
- NeMo Retriever (embeddings, reranking, Image OCR)
- NemoGuard ContentSafety/TopicControl/JailbreakDetect + NeMo Guardrails
- Riva streaming ASR <300ms (telefonía/call center) · nvidia-pipecat voice-agent-examples
- Pricing: free tier 1000 créditos/40 RPM; pay-as-you-go; self-host = AI Enterprise + GPUs
