-- Horario ESTRUCTURADO del shop (fuente única para respetar el horario Y decirlo).
-- Formato: { "mon": {"open":"08:30","close":"21:00"}, ..., "sun": {...} } — día ausente = cerrado.
-- Reemplaza el uso de hours_text (texto libre) para la voz. El texto se deja por compatibilidad.
alter table public.shops add column if not exists hours jsonb;
