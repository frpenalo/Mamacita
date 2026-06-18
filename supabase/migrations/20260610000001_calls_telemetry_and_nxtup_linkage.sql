-- Migration: calls telemetry table + NXTUP linkage columns on shops
-- Date: 2026-06-10
-- Why: per planning/business/pricing-economics.md, per-call cost telemetry is
--      NON-OPTIONAL — it defines final voice-tier pricing. NXTUP columns enable
--      the pilot integration per planning/integration/api-contract.md.

-- =============================================================
-- 1. calls — one row per inbound voice call (telemetry)
-- =============================================================

CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  vapi_call_id text UNIQUE NOT NULL,
  caller_phone text,

  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  cost_usd numeric(8,4),

  -- what the call resulted in (updated as the call progresses)
  outcome text NOT NULL DEFAULT 'unknown'
    CHECK (outcome IN ('unknown', 'joined_queue', 'info_only', 'message_taken', 'hangup', 'error')),

  transcript text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_calls_shop_started ON public.calls(shop_id, started_at DESC);
CREATE INDEX idx_calls_vapi_id ON public.calls(vapi_call_id);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

-- Owners can read their shop's call log; writes happen via service role only
CREATE POLICY "Shop owners view own calls" ON public.calls
  FOR SELECT TO authenticated
  USING (shop_id IN (SELECT id FROM public.shops WHERE owner_user_id = auth.uid()));

-- =============================================================
-- 2. shops — NXTUP linkage (pilot integration, white-glove)
-- =============================================================

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS nxtup_shop_id text,
  ADD COLUMN IF NOT EXISTS nxtup_api_url text,
  ADD COLUMN IF NOT EXISTS nxtup_shared_secret text;

COMMENT ON COLUMN public.shops.nxtup_shop_id IS 'UUID of this shop in NXTUP. When set, availability and queue entries flow through NXTUP API (see planning/integration/api-contract.md)';
