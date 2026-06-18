-- Migration: limpieza periódica de entradas de cola "fantasma"
-- Date: 2026-06-17
--
-- Por qué: las entradas de voz en Mamacita quedan en 'waiting' para siempre
-- porque Mamacita no se entera cuando NXTUP las atiende o las limpia con su
-- reset nocturno. Sin limpieza, el dedup por teléfono las ve como fantasmas
-- y bloquea al cliente ("ya estás en la lista") aunque NXTUP ya no lo tenga.
--
-- Solución (sin acoplar a NXTUP): Mamacita hace su propia limpieza periódica,
-- igual que NXTUP resetea la suya. Cada uno mantiene su lado. Las entradas
-- activas de más de 12h se cierran como 'no_show' (cubre una sesión de día
-- de barbería; el reset de NXTUP es diario).
--
-- NO resuelve el caso "atendido y vuelve a llamar el mismo día" (<12h) — eso
-- necesita el webhook de cierre (NXTUP avisa a Mamacita), que es asíncrono y
-- también mantiene la independencia. Pendiente para después.

create extension if not exists pg_cron;

create or replace function public.expire_stale_queue_entries()
returns void
language sql
as $$
  -- 'waiting' viejas = nunca hicieron check-in = no_show.
  -- 'arrived'/'in_service' viejas = sí llegaron = se asumen atendidas (served),
  -- para no inflar los no-shows en las métricas. El resultado real lo dará el
  -- webhook de cierre cuando se conecte; esto es la mejor aproximación sin él.
  update public.queue_entries
  set status = case
        when status in ('arrived', 'in_service') then 'served'
        else 'no_show'
      end,
      completed_at = now()
  where status in ('waiting', 'arrived', 'in_service')
    and created_at < now() - interval '12 hours';
$$;

-- Programar cada hora (idempotente: re-correr la migración reemplaza el job).
do $$
begin
  perform cron.unschedule('expire-stale-queue-entries');
exception when others then
  null; -- el job no existía todavía
end $$;

select cron.schedule(
  'expire-stale-queue-entries',
  '0 * * * *', -- cada hora en punto
  $$ select public.expire_stale_queue_entries(); $$
);
