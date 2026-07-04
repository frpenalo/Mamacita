-- Migration: WhatsApp Citas — foundation (Bloque 1)
-- Date: 2026-06-30
-- Spec: planning/product/whatsapp-citas/prd-full.md
--
-- HALLAZGO (auditoría del esquema real): el modelo de CITAS vive en el mundo
--   `barbers` / `customers` / `appointments` / `availability_slots` / `blocked_times`
-- y TODO el dashboard + src/lib/slots.ts está construido sobre él (barber_id-centric).
-- El mundo `shops` / `professionals` / `queue_entries` es SOLO el walk-in/voz (NXTUP).
-- Los dos mundos están puenteados por el backfill del walk-in: barber.id == shop.id
-- == professional.id (mismo UUID). Ese puente ES el gancho del bundle — un barbero con
-- citas (barbers) Y walk-in (shop/professional) es el MISMO UUID → ya quedan enlazados.
--
-- Por eso el producto de citas por WhatsApp se construye sobre el mundo `barbers`
-- (reutiliza el dashboard y slots.ts al 100%, y queda INDEPENDIENTE del walk-in, como
-- Francisco quiere). Esta migración es ADITIVA — no toca datos ni columnas existentes.
--
--   1. barbers   : + wa_code (link personalizado), + business_id (agrupa barbería/bundle),
--                  + enabled_products (gancho del bundle)
--   2. wa_sessions : amarre cliente-WhatsApp -> barbero (§7.1 del PRD)
--   3. wa_messages : log de la conversación
--   4. reminders   : cola de recordatorios (24h / 2h), drenada por pg_cron

-- =============================================================
-- 1. barbers — campos del canal WhatsApp + ganchos del bundle
-- =============================================================

ALTER TABLE public.barbers
  ADD COLUMN IF NOT EXISTS wa_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS business_id uuid,
  ADD COLUMN IF NOT EXISTS enabled_products text[] NOT NULL DEFAULT '{}';

-- business_id: por defecto cada barbero es su propio "negocio". Una barbería agrupa
-- varios barberos bajo el MISMO business_id (multi-barbero) — de ahí sale "elegir barbero".
UPDATE public.barbers SET business_id = id WHERE business_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_barbers_business ON public.barbers(business_id);
CREATE INDEX IF NOT EXISTS idx_barbers_wa_code ON public.barbers(wa_code) WHERE wa_code IS NOT NULL;

-- Generar wa_code legible (6 chars, sin caracteres ambiguos) al insertar si viene null.
-- Mismo patrón que generate_check_in_code del walk-in.
CREATE OR REPLACE FUNCTION public.generate_wa_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempts integer := 0;
BEGIN
  IF NEW.wa_code IS NOT NULL AND NEW.wa_code != '' THEN
    RETURN NEW;
  END IF;

  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, (floor(random() * length(chars))::integer) + 1, 1);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.barbers WHERE wa_code = code) THEN
      NEW.wa_code := code;
      RETURN NEW;
    END IF;

    attempts := attempts + 1;
    IF attempts > 50 THEN
      NEW.wa_code := upper(substr(md5(random()::text), 1, 6));
      RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER trg_generate_wa_code
  BEFORE INSERT ON public.barbers
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_wa_code();

-- Backfill wa_code para los barberos existentes (una fila a la vez para respetar unicidad).
DO $$
DECLARE
  r record;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
BEGIN
  FOR r IN SELECT id FROM public.barbers WHERE wa_code IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(chars, (floor(random() * length(chars))::integer) + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.barbers WHERE wa_code = code);
    END LOOP;
    UPDATE public.barbers SET wa_code = code WHERE id = r.id;
  END LOOP;
END;
$$;

-- =============================================================
-- 2. wa_sessions — amarre cliente-WhatsApp -> barbero (§7.1)
-- =============================================================

CREATE TABLE public.wa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  client_phone text NOT NULL,
  client_name text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,

  -- estado conversacional del agente (paso actual, hueco propuesto, idioma detectado, etc.)
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  language text NOT NULL DEFAULT 'es',

  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- un cliente conversa con un barbero en una sola sesión viva
  UNIQUE (barber_id, client_phone)
);

-- Para rutear un mensaje entrante sin código: encontrar la sesión más reciente del teléfono.
CREATE INDEX idx_wa_sessions_phone ON public.wa_sessions(client_phone, last_inbound_at DESC);
CREATE INDEX idx_wa_sessions_barber ON public.wa_sessions(barber_id);

ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;

-- El dashboard (dueño del barbero) puede leer sus sesiones; las edge functions usan
-- service_role (bypassa RLS) para escribir.
CREATE POLICY "Barbers view own wa_sessions" ON public.wa_sessions
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- =============================================================
-- 3. wa_messages — log de la conversación (auditoría + contexto del LLM)
-- =============================================================

CREATE TABLE public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.wa_sessions(id) ON DELETE CASCADE NOT NULL,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text,
  wa_message_sid text,               -- SID de Twilio (idempotencia / trazabilidad)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_messages_session ON public.wa_messages(session_id, created_at);
CREATE INDEX idx_wa_messages_sid ON public.wa_messages(wa_message_sid) WHERE wa_message_sid IS NOT NULL;

ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers view own wa_messages" ON public.wa_messages
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- =============================================================
-- 4. reminders — cola de recordatorios (24h / 2h), drenada por pg_cron
-- =============================================================

CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE NOT NULL,
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('24h', '2h')),
  fire_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'cancelled', 'skipped')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- un recordatorio de cada tipo por cita (evita duplicados)
  UNIQUE (appointment_id, kind)
);

-- El cron busca los que ya vencieron y siguen pendientes.
CREATE INDEX idx_reminders_due ON public.reminders(fire_at) WHERE status = 'pending';
CREATE INDEX idx_reminders_appointment ON public.reminders(appointment_id);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers view own reminders" ON public.reminders
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
