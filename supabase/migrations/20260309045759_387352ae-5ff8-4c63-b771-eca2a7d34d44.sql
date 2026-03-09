ALTER TABLE public.barbers
  ADD COLUMN subscription_status text NOT NULL DEFAULT 'active',
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text;