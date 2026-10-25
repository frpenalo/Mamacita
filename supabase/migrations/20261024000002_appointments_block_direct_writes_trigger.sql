-- Corrige 20261024000001: sin policy de UPDATE/DELETE, RLS no da error, solo filtra las filas
-- (0 filas afectadas) y PostgREST responde OK. Una copia vieja del dashboard mostraría
-- "Cita cancelada" sin cancelar nada. Para que FALLE A LA VISTA se restauran las policies
-- (la fila queda visible al UPDATE/DELETE) y un trigger rechaza la escritura si viene de un
-- usuario logueado (rol 'authenticated' = navegador). Las edge functions usan service_role y
-- el SQL editor usa postgres: no les afecta.

CREATE POLICY "Barbers can update own appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can delete own appointments" ON public.appointments
  FOR DELETE TO authenticated
  USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.block_direct_appointment_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'Las citas se modifican desde el servidor. Recarga la página: estás usando una versión vieja del panel.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_direct_appointment_writes ON public.appointments;
CREATE TRIGGER trg_block_direct_appointment_writes
  BEFORE UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.block_direct_appointment_writes();
