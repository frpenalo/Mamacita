# Métricas de voz + Barbero portátil (estrategia)

**Fecha:** 2026-06-15
**Status:** decisiones de diseño / roadmap — NO implementado aún
**Origen:** preguntas de Francisco tras validar el flujo voz→cola end-to-end.

---

## 1. Cómo guardar y medir las estadísticas de walk-ins por voz

### Dónde vive el dato hoy (2 sistemas)

| Dato | Sistema | Tabla |
|---|---|---|
| Cada llamada (duración, costo, outcome, transcript) | Mamacita | `calls` |
| La reserva de voz (nombre, teléfono, código) | Mamacita | `queue_entries` |
| La entrada en la cola real + si llegó (`arrived_at`) | NXTUP | `queue_entries` (con `mamacita_entry_id`) |

El `mamacita_entry_id` en NXTUP es el puente que vincula ambos lados.

### El problema para medir

El embudo completo de una llamada cruza los dos sistemas:

```
llamada → reservó → llegó → fue atendido → costó $X
  └ Mamacita ┘        └────── NXTUP ──────┘   └ Mamacita ┘
```

Para tomar decisiones (¿cuántas llamadas convierten? ¿cuántas reservas son no-show? ¿costo por cliente real?) hay que juntar las dos mitades. Hoy están separadas.

### Recomendación: centralizar las métricas de voz en Mamacita

Mamacita es el dueño natural del dato de voz (ahí nace la llamada). La pieza que falta es que NXTUP le avise el RESULTADO de cada reserva (llegó / no-show / atendido). Eso ya está medio construido: el helper `notifyMamacita()` en `nxtup/src/lib/mamacita.ts` y el receptor `nxtup-events` en Mamacita ya soportan los eventos `entry_completed` y `entry_no_show`.

**Plan:**
1. NXTUP dispara `notifyMamacita` cuando una entrada de voz se atiende (done) o expira (no-show).
2. Mamacita guarda ese resultado en `calls` (o una columna `final_outcome`).
3. Una sola consulta a Mamacita da el embudo + costos, sin tocar NXTUP:
   - Llamadas/día, conversión llamada→reserva, % que realmente llega, % no-show, costo VAPI por cliente real, horas pico, etc.

**¿Quién maneja qué tabla?** Trabajo en ambos repos (ya lo hicimos). Pero las MÉTRICAS de voz conviene centralizarlas en Mamacita — es el producto vendible y separable; sus números no deben depender de consultar la DB de NXTUP. NXTUP solo "avisa el final" vía webhook.

Esto alimenta directo el análisis de `pricing-economics.md` (costo real por shop/mes para el pricing del tier de voz).

---

## 2. Tier intermedio de WhatsApp (recordatorio)

Confirmado en el roadmap: el agente de WhatsApp es el tier intermedio ($87 / $77 founding) entre NXTUP base ($47) y NXTUP+voz ($100). Agenda citas y comunica cliente↔barbero por texto. Reutiliza las tablas `appointments`/`availability_slots` preservadas. Detalle en `pricing-economics.md` y `with-nxtup.md`.

---

## 3. Barbero portátil — el barbero contrata, no la barbería

### La idea

Un barbero (no el shop) contrata el servicio. Se conecta al queue de la barbería donde trabaja. Si se muda a otra barbería que también use NXTUP, se conecta ahí. El barbero **no está atado a una sola barbería** — nosotros, que controlamos la plataforma, permitimos esa portabilidad.

### Por qué es estratégicamente fuerte

- **Ata al barbero a NUESTRA plataforma, no a la barbería.** Su clientela, su agente personal (voz/WhatsApp), sus métricas lo siguen a donde vaya. No pierde su inversión al cambiar de shop.
- Conecta directo con el **Plan Personal** de `pricing-economics.md` ($29/$59/$79): el barbero paga por SU agente, que maneja SU clientela. La portabilidad es lo que hace ese plan irresistible — "tu negocio te sigue".
- Crea lock-in del lado del barbero (el activo más móvil de la industria) además del lado del shop.

### Lo que implica (refactor futuro, NO ahora)

Hoy NXTUP es shop-céntrico: `barbers.shop_id` ata cada barbero a UN shop. Para portabilidad:

- El **barbero pasa a ser una entidad global** (identidad propia, no `shop_id` fijo).
- Relación **barbero↔shop = membresía** (puede cambiar; un barbero puede estar activo en shop X hoy y shop Y mañana). Posiblemente activo en varios.
- El **agente personal del barbero** (Mamacita Plan Personal) maneja su clientela independiente del shop; cuando trabaja en shop X, sus citas/clientes aparecen en el queue de X.
- **Control de plataforma:** nosotros autorizamos qué barbero se conecta a qué shop (evita que un barbero entre a un shop sin permiso del dueño). Política a definir: ¿el dueño del shop aprueba? ¿el barbero se auto-conecta?

### Preguntas abiertas para decidir

- ¿El dueño del shop debe autorizar que un barbero externo (con su propio plan) se conecte a su queue? (probablemente sí, para evitar fricción)
- ¿Cómo se reparte el revenue cuando el barbero portátil trae su clientela a un shop que paga NXTUP? (¿el barbero paga su plan, el shop el suyo, sin conflicto?)
- ¿Un barbero puede estar activo en 2 shops a la vez, o uno a la vez?

### Recomendación

Es una idea de alto valor pero un refactor grande (modelo de datos de NXTUP + Mamacita). NO tocarla hasta que el piloto del shop esté sólido y el Plan Personal tenga demanda comprobada. Documentarla ahora (este doc) como norte; diseñarla en detalle cuando sea la prioridad. El principio que la habilita ya existe: Mamacita es separable y el barbero individual ya es "un shop con 1 professional" en el modelo.
