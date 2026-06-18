-- Migration: walk-in queue schema (pivot from single-barber appointments)
-- Date: 2026-06-01
-- Spec: planning/product/walk-in-queue-spec.md
--
-- Strategy:
--   - Create new tables: shops, professionals, queue_entries
--   - Backfill 1:1 from existing barbers (each barber → 1 shop + 1 professional, IDs reused)
--   - Existing tables (barbers, appointments, availability_slots, blocked_times) stay intact
--     and are reserved for Fase 2 (paid appointment booking feature)
--   - customers gets an additive shop_id column (backfilled from barber_id)
--   - Zero-downtime: existing code keeps working until edge functions are refactored

-- =============================================================
-- 1. shops — the business (barbershop, salon, clinic)
-- =============================================================

CREATE TABLE public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- identity
  name text NOT NULL,
  phone_number text,
  address text,
  timezone text DEFAULT 'America/New_York',

  -- communication
  whatsapp_number text,
  whatsapp_business_number text,

  -- VAPI
  vapi_assistant_id text,
  vapi_phone_number_id text,

  -- billing
  subscription_status text NOT NULL DEFAULT 'active',
  stripe_customer_id text,
  stripe_subscription_id text,

  -- referrals (moved from barbers)
  referral_code text UNIQUE,
  referral_balance numeric NOT NULL DEFAULT 0,
  referral_credits numeric NOT NULL DEFAULT 0.00,

  -- queue config
  default_service_duration_minutes integer NOT NULL DEFAULT 45,
  queue_timeout_minutes integer NOT NULL DEFAULT 30,
  services_text text,  -- free-form description that VAPI assistant reads to caller

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shops_phone_number ON public.shops(phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX idx_shops_owner ON public.shops(owner_user_id);

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop owners view own shop" ON public.shops
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "Shop owners insert own shop" ON public.shops
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Shop owners update own shop" ON public.shops
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Shop owners delete own shop" ON public.shops
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

-- =============================================================
-- 2. professionals — the person who provides service (barber, stylist, doctor)
-- =============================================================

CREATE TABLE public.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- optional, if pro has own login

  name text NOT NULL,
  avatar_url text,

  -- real-time queue state
  current_status text NOT NULL DEFAULT 'off' CHECK (current_status IN ('available', 'busy', 'break', 'off')),
  status_updated_at timestamptz NOT NULL DEFAULT now(),

  -- working hours (preserved for Fase 2 appointments)
  working_days text[],
  working_hours_start time,
  working_hours_end time,
  appointment_duration integer NOT NULL DEFAULT 45,

  -- display
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_professionals_shop ON public.professionals(shop_id);
CREATE INDEX idx_professionals_shop_status ON public.professionals(shop_id, current_status) WHERE active = true;
CREATE INDEX idx_professionals_user ON public.professionals(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop owners view own professionals" ON public.professionals
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()));

CREATE POLICY "Shop owners manage own professionals" ON public.professionals
  FOR ALL TO authenticated
  USING (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()));

-- Auto-update status_updated_at when current_status changes
CREATE OR REPLACE FUNCTION public.touch_professional_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.current_status IS DISTINCT FROM NEW.current_status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_professional_status_updated_at
  BEFORE UPDATE ON public.professionals
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_professional_status_updated_at();

-- =============================================================
-- 3. queue_entries — customer in the waiting list
-- =============================================================

CREATE TABLE public.queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,

  -- customer info snapshot (so it survives if customer record changes)
  customer_name text NOT NULL,
  customer_phone text NOT NULL,

  -- lifecycle timestamps
  joined_at timestamptz NOT NULL DEFAULT now(),    -- when they called / were added
  eta_at timestamptz,                              -- estimated arrival time
  arrived_at timestamptz,                          -- physical check-in time
  served_at timestamptz,                           -- service started
  completed_at timestamptz,                        -- service finished

  -- assignment
  assigned_professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL,

  -- state machine
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'arrived', 'in_service', 'served', 'no_show', 'cancelled')),

  -- check-in
  check_in_code text UNIQUE NOT NULL,

  -- source tracking
  source text NOT NULL DEFAULT 'voice'
    CHECK (source IN ('voice', 'walk-in', 'other')),
  vapi_call_id text,

  notes text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_queue_shop_status ON public.queue_entries(shop_id, status);
CREATE INDEX idx_queue_shop_active ON public.queue_entries(shop_id, joined_at)
  WHERE status IN ('waiting', 'arrived', 'in_service');
CREATE INDEX idx_queue_check_in_code ON public.queue_entries(check_in_code);
CREATE INDEX idx_queue_vapi_call ON public.queue_entries(vapi_call_id) WHERE vapi_call_id IS NOT NULL;

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shop owners view own queue" ON public.queue_entries
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()));

CREATE POLICY "Shop owners manage own queue" ON public.queue_entries
  FOR ALL TO authenticated
  USING (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()));

-- Generate check_in_code on insert if not provided (4 chars, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_check_in_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  attempts integer := 0;
BEGIN
  IF NEW.check_in_code IS NOT NULL AND NEW.check_in_code != '' THEN
    RETURN NEW;
  END IF;

  LOOP
    code := '';
    FOR i IN 1..4 LOOP
      code := code || substr(chars, (floor(random() * length(chars))::integer) + 1, 1);
    END LOOP;

    -- check uniqueness
    IF NOT EXISTS (SELECT 1 FROM public.queue_entries WHERE check_in_code = code) THEN
      NEW.check_in_code := code;
      RETURN NEW;
    END IF;

    attempts := attempts + 1;
    IF attempts > 50 THEN
      -- extremely unlikely fallback
      NEW.check_in_code := upper(substr(md5(random()::text), 1, 4));
      RETURN NEW;
    END IF;
  END LOOP;
END;
$$;

CREATE TRIGGER trg_generate_check_in_code
  BEFORE INSERT ON public.queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_check_in_code();

-- =============================================================
-- 4. customers — add shop_id (additive, backfilled below)
-- =============================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_customers_shop_phone
  ON public.customers(shop_id, phone_number)
  WHERE shop_id IS NOT NULL;

-- =============================================================
-- 5. BACKFILL — for each existing barber, create 1 shop + 1 professional
--    Reuse barber.id as shop.id so existing FKs (customers.barber_id, etc.)
--    map cleanly to shop_id via the same UUID value.
-- =============================================================

INSERT INTO public.shops (
  id,
  owner_user_id,
  name,
  phone_number,
  address,
  timezone,
  whatsapp_number,
  whatsapp_business_number,
  vapi_assistant_id,
  vapi_phone_number_id,
  subscription_status,
  stripe_customer_id,
  stripe_subscription_id,
  referral_code,
  referral_balance,
  referral_credits,
  default_service_duration_minutes,
  created_at
)
SELECT
  b.id,
  b.user_id,
  b.shop_name,
  b.phone_number,
  b.address,
  COALESCE(b.timezone, 'America/New_York'),
  b.whatsapp_number,
  b.whatsapp_business_number,
  b.vapi_assistant_id,
  b.vapi_phone_number_id,
  COALESCE(b.subscription_status, 'active'),
  b.stripe_customer_id,
  b.stripe_subscription_id,
  b.referral_code,
  COALESCE(b.referral_balance, 0),
  COALESCE(b.referral_credits, 0),
  COALESCE(b.appointment_duration, 45),
  b.created_at
FROM public.barbers b
WHERE NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = b.id);

-- Create one professional per existing barber, also reusing barber.id as professional.id
INSERT INTO public.professionals (
  id,
  shop_id,
  user_id,
  name,
  current_status,
  working_days,
  working_hours_start,
  working_hours_end,
  appointment_duration,
  display_order,
  active,
  created_at
)
SELECT
  b.id,
  b.id,             -- shop_id == barber.id (since 1:1 backfill)
  b.user_id,
  b.name,
  'off',            -- start offline, owner enables
  b.working_days,
  b.working_hours_start,
  b.working_hours_end,
  COALESCE(b.appointment_duration, 45),
  0,
  true,
  b.created_at
FROM public.barbers b
WHERE NOT EXISTS (SELECT 1 FROM public.professionals p WHERE p.id = b.id);

-- Backfill customers.shop_id from existing barber_id (1:1 mapping)
UPDATE public.customers c
SET shop_id = c.barber_id
WHERE c.shop_id IS NULL
  AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = c.barber_id);

-- =============================================================
-- 6. Helper RPC: count availability for VAPI assistant
-- =============================================================

CREATE OR REPLACE FUNCTION public.shop_availability(p_shop_id uuid)
RETURNS TABLE (
  professionals_available integer,
  professionals_busy integer,
  professionals_break integer,
  professionals_off integer,
  queue_waiting integer,
  queue_arrived integer,
  estimated_wait_minutes integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pro_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE current_status = 'available')::int AS available,
      COUNT(*) FILTER (WHERE current_status = 'busy')::int AS busy,
      COUNT(*) FILTER (WHERE current_status = 'break')::int AS on_break,
      COUNT(*) FILTER (WHERE current_status = 'off')::int AS off
    FROM public.professionals
    WHERE shop_id = p_shop_id AND active = true
  ),
  queue_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
      COUNT(*) FILTER (WHERE status = 'arrived')::int AS arrived
    FROM public.queue_entries
    WHERE shop_id = p_shop_id
  ),
  shop_config AS (
    SELECT default_service_duration_minutes AS service_min
    FROM public.shops
    WHERE id = p_shop_id
  )
  SELECT
    pc.available,
    pc.busy,
    pc.on_break,
    pc.off,
    qc.waiting,
    qc.arrived,
    -- naive estimate: (queue ahead × service duration) ÷ max(1, available pros)
    CASE
      WHEN pc.available + pc.busy = 0 THEN NULL
      ELSE GREATEST(0,
        ((qc.waiting + qc.arrived) * sc.service_min) / GREATEST(1, pc.available + pc.busy)
      )
    END::int AS estimated_wait_minutes
  FROM pro_counts pc, queue_counts qc, shop_config sc;
$$;
