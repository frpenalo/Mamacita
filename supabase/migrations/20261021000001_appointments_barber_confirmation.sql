-- Registro de la confirmación del barbero (agente de citas WhatsApp + app del barbero).
-- La cita nace 'confirmed' (opción A del PRD); esto registra el ACUSE del barbero, que hasta
-- ahora no dejaba rastro (no se podía saber si aceptó o nunca vio el aviso).
--   barber_confirmed_at = cuándo tocó Aceptar (NULL = aún sin acuse)
--   confirmed_via       = por dónde: 'whatsapp' (botón/comando) o 'app' (dashboard/PWA)
-- Aditiva: no toca datos existentes.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS barber_confirmed_at timestamptz;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS confirmed_via text
  CHECK (confirmed_via IN ('whatsapp', 'app'));
