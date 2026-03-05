ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS vapi_assistant_id text DEFAULT NULL;
ALTER TABLE public.barbers ADD COLUMN IF NOT EXISTS vapi_phone_number_id text DEFAULT NULL;