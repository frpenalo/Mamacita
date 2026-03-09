CREATE OR REPLACE FUNCTION public.create_referral(ref_code text, new_barber_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id uuid;
BEGIN
  SELECT id INTO referrer_id FROM barbers WHERE referral_code = ref_code LIMIT 1;
  IF referrer_id IS NOT NULL AND referrer_id != new_barber_id THEN
    INSERT INTO referrals (referrer_barber_id, referred_barber_id, status, monthly_reward)
    VALUES (referrer_id, new_barber_id, 'active', 5.00);
  END IF;
END;
$$;