-- Rate limit HTTP por IP para las Edge Functions públicas (webhooks VAPI + whatsapp-inbound).
-- Cada request registra una fila (key = "<funcion>:<ip>"); el helper cuenta dentro de la ventana.
-- La purga la hace el helper de forma oportunista (no necesita cron).
create table if not exists public.rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  ts timestamptz not null default now()
);
alter table public.rate_limit_hits enable row level security; -- solo service_role (edge functions)
create index if not exists idx_rate_limit_hits_key_ts on public.rate_limit_hits (key, ts desc);
