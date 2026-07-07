-- Idioma detectado del cliente, para localizar SOLO los mensajes automáticos que le enviamos
-- (confirmación, cancelación, negociación, .ics). El barbero siempre recibe español.
-- NULL = aún no detectado (se trata como 'es' por defecto).
alter table public.wa_sessions add column if not exists lang text;
