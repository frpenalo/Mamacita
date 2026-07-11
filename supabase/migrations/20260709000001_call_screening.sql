-- Pre-filtro anti-spam para llamadas de voz (capa 1: antes de que Julie conteste).
-- Ojo: el bloqueo por número tiene efecto limitado (spoofing/rotación) — la capa fuerte
-- es que Julie detecte el pitch por CONTENIDO. Esto solo mata lo obvio y barato.

-- Blocklist manual: número E.164 completo o prefijo (ej. "+1984" o "+19845551234").
create table if not exists public.blocked_callers (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  note text,
  created_at timestamptz default now()
);
alter table public.blocked_callers enable row level security; -- solo service_role (edge functions)

-- Índice para el rate-limit: contar llamadas por número dentro de la ventana.
create index if not exists idx_calls_caller_started on public.calls (caller_phone, started_at desc);
