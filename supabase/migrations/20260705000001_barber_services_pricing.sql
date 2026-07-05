-- Servicios y precios por barbero + recargo por hora tardía (refinamiento del piloto).
-- Date: 2026-07-05
--
-- services: array de objetos {name, price, duration_min}. El agente los usa para
-- responder precios, y al agendar toma la DURACIÓN del servicio elegido.
-- surcharge_after / surcharge_amount: si la cita es a esa hora o después (zona del
-- barbero), se le suma surcharge_amount al precio.

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS services jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS surcharge_after time,
  ADD COLUMN IF NOT EXISTS surcharge_amount numeric(10,2);

COMMENT ON COLUMN public.barbers.services IS 'Array de {name, price, duration_min}. El agente responde precios y usa la duración del servicio al agendar.';
COMMENT ON COLUMN public.barbers.surcharge_after IS 'Hora (zona del barbero) desde la cual aplica recargo por hora tardía.';
COMMENT ON COLUMN public.barbers.surcharge_amount IS 'Monto extra sumado al precio si la cita es a/después de surcharge_after.';
