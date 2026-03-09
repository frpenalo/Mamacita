-- Create function to increment referral balance
CREATE OR REPLACE FUNCTION public.increment_referral_balance(barber_id uuid, amount numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE barbers
  SET referral_balance = referral_balance + amount
  WHERE id = barber_id;
$$;