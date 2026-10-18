-- julie-costo-por-tienda.sql
-- Insumo del reporte de liquidación MENSUAL de Julie (reparto 40/60 Softmedia/NXTUP).
-- Mamacita corre esto al cierre de mes y le pasa el COSTO por tienda a NXTUP, que arma el reporte.
-- Las columnas de reparto (ganancia/softmedia/nxtup) van incluidas solo para verificar; el precio de Julie es $100/tienda.
--
-- AJUSTAR el rango al mes a liquidar. started_at es UTC; el mes de NY arranca a las 04:00/05:00 UTC (EDT/EST).
-- Correr en el SQL Editor de Supabase (proyecto kpgseyfkucnnzdaoqjdq).
--
-- Costo = VAPI (exacto, de la tabla calls) + WhatsApp estimado (anotaciones × 2 msg × $0.0084/msg utility).
-- El WhatsApp es estimado porque Twilio lo factura aparte; ajustar la tarifa/mensajes si cambia.

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
)
SELECT
  s.name                                                       AS tienda,
  m.llamadas,
  m.minutos,
  m.anotaciones,
  m.costo_vapi                                                 AS costo_vapi_usd,
  round(m.anotaciones * 2 * 0.0084, 2)                         AS costo_whatsapp_est,   -- 2 msg/anotación × $0.0084
  round(m.costo_vapi + m.anotaciones * 2 * 0.0084, 2)          AS costo_total,          -- C (esto es lo que Mamacita le pasa a NXTUP)
  -- Reparto (Julie = $100; ganancia = 100 − C) — solo verificación, NXTUP lo recalcula de su lado:
  round(100 - (m.costo_vapi + m.anotaciones * 2 * 0.0084), 2)  AS ganancia,
  round((m.costo_vapi + m.anotaciones * 2 * 0.0084) + 0.40 * (100 - (m.costo_vapi + m.anotaciones * 2 * 0.0084)), 2) AS softmedia,
  round(0.60 * (100 - (m.costo_vapi + m.anotaciones * 2 * 0.0084)), 2)                 AS nxtup
FROM mes m
JOIN public.shops s ON s.id = m.shop_id
WHERE m.llamadas > 0
ORDER BY s.name;
