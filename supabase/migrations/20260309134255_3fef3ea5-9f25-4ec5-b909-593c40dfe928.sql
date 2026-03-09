CREATE OR REPLACE FUNCTION public.get_my_referrals(p_barber_id uuid)
RETURNS TABLE(id uuid, referred_name text, referred_shop text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, b.name, b.shop_name, r.status
  FROM referrals r
  JOIN barbers b ON b.id = r.referred_barber_id
  WHERE r.referrer_barber_id = p_barber_id;
$$;