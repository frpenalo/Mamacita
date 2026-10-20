-- Idempotencia del alta de shop desde NXTUP: un shop_profile_updated puede llegar varias
-- veces (reintentos) y hasta concurrente. Sin esto, dos altas concurrentes del MISMO shop
-- (TOCTOU: ambas ven "no existe" y ambas insertan) crearían el shop DUPLICADO. El índice único
-- lo garantiza a nivel de base; el handler nxtup-events atrapa el 23505 y actualiza en vez de
-- duplicar. (Misma clase de carrera que causó el triple cobro de NuevaYol en el billing.)
-- Verificado 20-oct: no hay nxtup_shop_id duplicados hoy, así que el índice crea limpio.

CREATE UNIQUE INDEX IF NOT EXISTS shops_nxtup_shop_id_unique
  ON public.shops (nxtup_shop_id) WHERE nxtup_shop_id IS NOT NULL;
