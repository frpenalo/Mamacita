-- Horario por día del barbero (apertura/cierre distintos por día).
-- Date: 2026-07-05
--
-- working_hours: {"lun":{"start":"09:00","end":"18:00"}, "sab":{"start":"10:00","end":"14:00"}}
-- Solo los días PRESENTES son laborables. Si está seteado, MANDA sobre working_days +
-- working_hours_start/end (que se mantienen como fallback legacy para barberos que aún
-- no lo editan).

ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS working_hours jsonb;

COMMENT ON COLUMN public.barbers.working_hours IS 'Horario por día {"lun":{"start","end"},...}. Días presentes = laborables. Si está, manda sobre working_days + working_hours_start/end (legacy).';
