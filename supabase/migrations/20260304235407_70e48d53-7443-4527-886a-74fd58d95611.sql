
-- Tabla: barbers
CREATE TABLE public.barbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  shop_name text NOT NULL,
  phone_number text,
  whatsapp_number text,
  whatsapp_business_number text,
  address text,
  working_days text[],
  working_hours_start time,
  working_hours_end time,
  timezone text DEFAULT 'America/New_York',
  referral_code text UNIQUE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own data" ON public.barbers FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Barbers can insert own data" ON public.barbers FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Barbers can update own data" ON public.barbers FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Tabla: customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  phone_number text,
  total_visits integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own customers" ON public.customers FOR SELECT TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can insert own customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can update own customers" ON public.customers FOR UPDATE TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can delete own customers" ON public.customers FOR DELETE TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- Tabla: appointments
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  appointment_code text UNIQUE,
  status text DEFAULT 'confirmed',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own appointments" ON public.appointments FOR SELECT TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can insert own appointments" ON public.appointments FOR INSERT TO authenticated WITH CHECK (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can update own appointments" ON public.appointments FOR UPDATE TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can delete own appointments" ON public.appointments FOR DELETE TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- Tabla: availability_slots
CREATE TABLE public.availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'available',
  hold_expires_at timestamptz,
  held_by_session_id text
);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own slots" ON public.availability_slots FOR SELECT TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can manage own slots" ON public.availability_slots FOR ALL TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- Tabla: blocked_times
CREATE TABLE public.blocked_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text
);

ALTER TABLE public.blocked_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own blocked times" ON public.blocked_times FOR SELECT TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));
CREATE POLICY "Barbers can manage own blocked times" ON public.blocked_times FOR ALL TO authenticated USING (barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()));

-- Tabla: referrals
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  referred_barber_id uuid REFERENCES public.barbers(id) ON DELETE CASCADE NOT NULL,
  monthly_reward decimal,
  status text DEFAULT 'pending'
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Barbers can view own referrals" ON public.referrals FOR SELECT TO authenticated USING (
  referrer_barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid()) OR
  referred_barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid())
);
CREATE POLICY "Barbers can insert referrals" ON public.referrals FOR INSERT TO authenticated WITH CHECK (
  referrer_barber_id IN (SELECT id FROM public.barbers WHERE user_id = auth.uid())
);
