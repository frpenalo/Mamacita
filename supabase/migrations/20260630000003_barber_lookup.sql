-- Migration: buscar barbero por teléfono (normalizado) — Bloque 5
-- Date: 2026-06-30
--
-- Para detectar cuándo quien escribe al WhatsApp es un BARBERO gestionando sus citas
-- (CONFIRMAR / CANCELAR) en lugar de un cliente. Compara por los últimos 10 dígitos,
-- tolerante a formatos ("+1 984-...", "984...", etc.).

CREATE OR REPLACE FUNCTION public.find_barber_by_phone(p_phone text)
RETURNS SETOF public.barbers
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.* FROM public.barbers b
  WHERE right(regexp_replace(coalesce(b.whatsapp_number, ''), '\D', '', 'g'), 10)
        = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
     OR right(regexp_replace(coalesce(b.phone_number, ''), '\D', '', 'g'), 10)
        = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
  LIMIT 1;
$$;
