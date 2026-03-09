-- Add referral_balance to barbers
ALTER TABLE public.barbers
ADD COLUMN IF NOT EXISTS referral_balance numeric DEFAULT 0 NOT NULL;