-- Migration: unicidad del whatsapp_number del barbero (normalizado, últimos 10 dígitos).
-- Date: 2026-07-04
--
-- El whatsapp_number es la IDENTIDAD del barbero para find_barber_by_phone (recibe los
-- avisos de citas nuevas y desde ahí da Confirmar/Cancelar). Si dos barberos comparten
-- número, el ruteo (LIMIT 1) se vuelve ambiguo. Este índice único parcial lo impide,
-- tolerante a formatos ("+1 984-...", "984...", etc.) comparando por los últimos 10 dígitos.

CREATE UNIQUE INDEX IF NOT EXISTS barbers_whatsapp_number_unique
  ON public.barbers (right(regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'), 10))
  WHERE whatsapp_number IS NOT NULL AND btrim(whatsapp_number) <> '';
