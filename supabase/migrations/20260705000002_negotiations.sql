-- Negociación de cambio de cita barbero↔cliente (#4). Máquina de estados por cita.
-- Date: 2026-07-05
--
-- Flujo: barbero toca [Modificar] → la AI le muestra sus huecos y él elige uno
-- (status barber_choosing) → se propone al cliente (client_deciding) → el cliente
-- acepta (done + reschedule) o propone otra hora → se lleva al barbero (barber_deciding)
-- → y así hasta cerrar. Bail-out por cualquiera de los dos = cancelled (deja la cita como está).

CREATE TABLE IF NOT EXISTS public.negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  barber_id uuid NOT NULL REFERENCES public.barbers(id) ON DELETE CASCADE,
  client_phone text NOT NULL,
  -- barber_choosing | client_deciding | barber_deciding | done | cancelled
  status text NOT NULL DEFAULT 'barber_choosing',
  proposed_start_utc timestamptz,
  proposed_end_utc timestamptz,
  rounds int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solo una negociación activa por cita.
CREATE UNIQUE INDEX IF NOT EXISTS negotiations_one_active_per_appt
  ON public.negotiations (appointment_id) WHERE status NOT IN ('done', 'cancelled');

-- Buscar rápido la negociación activa de un barbero / de un cliente.
CREATE INDEX IF NOT EXISTS negotiations_active_barber
  ON public.negotiations (barber_id) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX IF NOT EXISTS negotiations_active_client
  ON public.negotiations (client_phone) WHERE status NOT IN ('done', 'cancelled');

-- Solo lo tocan las edge functions (service role). RLS ON sin políticas = bloquea anon/auth.
ALTER TABLE public.negotiations ENABLE ROW LEVEL SECURITY;
