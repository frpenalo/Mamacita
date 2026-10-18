-- julie-costo-por-tienda.sql
-- Insumo del reporte de liquidación MENSUAL de Julie (reparto 40/60 Softmedia/NXTUP).
-- Mamacita corre esto al cierre de mes y le pasa el COSTO por tienda a NXTUP, que arma el reporte.
-- Las columnas de reparto (ganancia/softmedia/nxtup) van solo para verificar; el precio de Julie es $100/tienda.
--
-- AJUSTAR el rango al mes a liquidar. started_at es UTC; el mes de NY arranca a las 04:00/05:00 UTC (EDT/EST).
-- Correr en el SQL Editor de Supabase (proyecto kpgseyfkucnnzdaoqjdq).
--
-- Costo C por tienda = VAPI (exacto, de calls) + WhatsApp estimado (anotaciones × 2 msg × $0.0084)
--                      + ALQUILER del número de Twilio (~$1.15-1.50/mes, incluido en los $100, nunca se le cobra al dueño).
-- OJO: el alquiler aplica a números en TWILIO. Para una tienda con número en VAPI (ej. Fade Factory),
--      el costo del número ya va en la factura de VAPI → poner RENT=0 para esa tienda si hace falta.
-- Todo el costo debe ser verificable contra las facturas reales de VAPI y Twilio.

WITH mes AS (
  SELECT
    c.shop_id,
    count(*) FILTER (WHERE c.cost_usd IS NOT NULL)                                              AS llamadas,
    round(coalesce(sum(c.duration_seconds) FILTER (WHERE c.cost_usd IS NOT NULL), 0) / 60.0, 1) AS minutos,
    round(coalesce(sum(c.cost_usd), 0), 2)                                                      AS costo_vapi,
    count(*) FILTER (WHERE c.outcome = 'joined_queue')                                          AS anotaciones
  FROM public.calls c
  WHERE c.started_at >= '2026-10-01 04:00:00+00'   -- << inicio del mes a liquidar (hora NY)
    AND c.started_at <  '2026-11-01 04:00:00+00'   -- << inicio del mes siguiente (hora NY)
  GROUP BY c.shop_id
),
costo AS (
  SELECT
    m.*,
    round(m.anotaciones * 2 * 0.0084, 2)                                     AS costo_whatsapp_est,  -- 2 msg/anotación × $0.0084
    1.50::numeric                                                            AS costo_alquiler,      -- alquiler número Twilio (0 si el número es de VAPI)
    round(m.costo_vapi + m.anotaciones * 2 * 0.0084 + 1.50, 2)               AS c_total              -- C = VAPI + WhatsApp + alquiler
  FROM mes m
)
SELECT
  s.name                                   AS tienda,
  x.llamadas,
  x.minutos,
  x.anotaciones,
  x.costo_vapi                             AS costo_vapi_usd,
  x.costo_whatsapp_est,
  x.costo_alquiler,
  x.c_total                                AS costo_total,       -- C (esto es lo que Mamacita le pasa a NXTUP)
  -- Reparto (Julie = $100; ganancia = 100 − C) — solo verificación, NXTUP lo recalcula:
  round(100 - x.c_total, 2)                AS ganancia,
  round(x.c_total + 0.40 * (100 - x.c_total), 2) AS softmedia,
  round(0.60 * (100 - x.c_total), 2)       AS nxtup
FROM costo x
JOIN public.shops s ON s.id = x.shop_id
WHERE x.llamadas > 0
ORDER BY s.name;
