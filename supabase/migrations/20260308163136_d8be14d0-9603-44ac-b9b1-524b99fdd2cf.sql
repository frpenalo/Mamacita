
-- Function to lookup barber_id by referral_code (security definer bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_barber_id_by_referral_code(code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.barbers WHERE referral_code = code LIMIT 1;
$$;

-- Auto-generate referral_code on barber insert if not set
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := upper(substr(md5(random()::text || NEW.id::text), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON public.barbers
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_referral_code();

-- Backfill existing barbers without referral_code
UPDATE public.barbers
SET referral_code = upper(substr(md5(random()::text || id::text), 1, 8))
WHERE referral_code IS NULL;
