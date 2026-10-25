-- Los barberos ya NO modifican ni borran citas directo desde el navegador.
--
-- Mover, cancelar, completar y no-show pasan por la edge function barber-appointment-action
-- (service role), que avisa al cliente y cancela/reprograma sus recordatorios. Con estos
-- permisos abiertos, cualquier copia vieja del dashboard (caché del navegador, o la publicada
-- en tu-cita-pro.lovable.app) seguía escribiendo directo: el cliente no se enteraba y los
-- recordatorios quedaban en horas viejas. Sin ellos, esa copia vieja falla con error visible.
--
-- Se mantienen: SELECT (ver su agenda) e INSERT (cita manual desde NewAppointmentDialog).
-- Las edge functions usan service role, que no pasa por RLS.

DROP POLICY IF EXISTS "Barbers can update own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Barbers can delete own appointments" ON public.appointments;
