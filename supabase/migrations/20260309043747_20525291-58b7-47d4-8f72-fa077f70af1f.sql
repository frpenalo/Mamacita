-- Drop all existing RESTRICTIVE policies and recreate as PERMISSIVE

-- BARBERS table
DROP POLICY IF EXISTS "Barbers can insert own data" ON public.barbers;
DROP POLICY IF EXISTS "Barbers can view own data" ON public.barbers;
DROP POLICY IF EXISTS "Barbers can update own data" ON public.barbers;

CREATE POLICY "Barbers can insert own data" ON public.barbers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Barbers can view own data" ON public.barbers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Barbers can update own data" ON public.barbers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- APPOINTMENTS table
DROP POLICY IF EXISTS "Barbers can view own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Barbers can insert own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Barbers can update own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Barbers can delete own appointments" ON public.appointments;

CREATE POLICY "Barbers can view own appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can insert own appointments" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can update own appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can delete own appointments" ON public.appointments
  FOR DELETE TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

-- CUSTOMERS table
DROP POLICY IF EXISTS "Barbers can view own customers" ON public.customers;
DROP POLICY IF EXISTS "Barbers can insert own customers" ON public.customers;
DROP POLICY IF EXISTS "Barbers can update own customers" ON public.customers;
DROP POLICY IF EXISTS "Barbers can delete own customers" ON public.customers;

CREATE POLICY "Barbers can view own customers" ON public.customers
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can insert own customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can update own customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can delete own customers" ON public.customers
  FOR DELETE TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

-- AVAILABILITY_SLOTS table
DROP POLICY IF EXISTS "Barbers can view own slots" ON public.availability_slots;
DROP POLICY IF EXISTS "Barbers can manage own slots" ON public.availability_slots;

CREATE POLICY "Barbers can view own slots" ON public.availability_slots
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can manage own slots" ON public.availability_slots
  FOR ALL TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

-- BLOCKED_TIMES table
DROP POLICY IF EXISTS "Barbers can view own blocked times" ON public.blocked_times;
DROP POLICY IF EXISTS "Barbers can manage own blocked times" ON public.blocked_times;

CREATE POLICY "Barbers can view own blocked times" ON public.blocked_times
  FOR SELECT TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

CREATE POLICY "Barbers can manage own blocked times" ON public.blocked_times
  FOR ALL TO authenticated
  USING (barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));

-- REFERRALS table
DROP POLICY IF EXISTS "Barbers can view own referrals" ON public.referrals;
DROP POLICY IF EXISTS "Barbers can insert referrals" ON public.referrals;

CREATE POLICY "Barbers can view own referrals" ON public.referrals
  FOR SELECT TO authenticated
  USING (
    referrer_barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid())
    OR referred_barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid())
  );

CREATE POLICY "Barbers can insert referrals" ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (referrer_barber_id IN (SELECT id FROM barbers WHERE user_id = auth.uid()));