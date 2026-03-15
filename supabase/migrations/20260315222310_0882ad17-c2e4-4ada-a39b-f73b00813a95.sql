
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS referral_credits numeric NOT NULL DEFAULT 0.00;

ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS credit_paid boolean NOT NULL DEFAULT false;
