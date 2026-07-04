-- Migration: detectar cliente de walk-in por teléfono — coexistencia número compartido
-- Date: 2026-06-30
--
-- El número +19844009792 es COMPARTIDO: lo usa el walk-in (voz) para avisos salientes Y el
-- agente de citas para conversar. Cuando un cliente del walk-in RESPONDE a un aviso de la
-- voz, su mensaje entra al webhook de citas. Este RPC permite reconocerlo (tiene una entrada
-- ACTIVA en la cola) para darle el mensaje correcto, NO el de agendar citas.
-- Comparación normalizada por los últimos 10 dígitos (tolerante a formatos), igual que
-- find_barber_by_phone.

CREATE OR REPLACE FUNCTION public.find_active_queue_entry_by_phone(p_phone text)
RETURNS TABLE (shop_name text, shop_phone text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.name, s.phone_number, q.status
  FROM public.queue_entries q
  JOIN public.shops s ON s.id = q.shop_id
  WHERE q.status IN ('waiting', 'arrived', 'in_service')
    AND right(regexp_replace(coalesce(q.customer_phone, ''), '\D', '', 'g'), 10)
        = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
  ORDER BY q.created_at DESC
  LIMIT 1;
$$;
