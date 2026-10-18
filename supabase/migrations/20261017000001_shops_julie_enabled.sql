-- Migration: shops.julie_enabled — flag de billing del add-on de voz (Julie).
-- Fuente de verdad = NXTUP, que lo emite en el evento shop_profile_updated.
-- Semántica del gate (vapi-assistant-request): Julie contesta SALVO que el flag sea false EXPLÍCITO.
--   null  = sin señal de NXTUP (pilotos como Fade Factory) → Julie contesta. DEFAULT.
--   true  = el shop pagó el add-on → Julie contesta.
--   false = lo quitó o su suscripción del Queue murió → Julie no contesta.
-- Default null a propósito, para NO apagar a los pilotos existentes al desplegar.

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS julie_enabled boolean;

COMMENT ON COLUMN public.shops.julie_enabled IS
  'Billing del add-on Julie (NXTUP lo emite en shop_profile_updated). null/true = Julie contesta; false = apagada. Default null para no afectar pilotos.';
