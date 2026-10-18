-- Alta de número: cómo quedó montado el número de voz del shop.
--   'bought'  = compró un número nuevo con nosotros y LO anuncia (lo da a sus clientes).
--   'forward' = compró un número nuevo con nosotros (invisible) y DESVÍA su número de siempre
--               hacia él. El cliente sigue marcando el número público del negocio.
--   'port'    = portó su número real a Twilio (fase 2).
-- public_phone_number = el número que el dueño anuncia/los clientes marcan (solo 'forward':
--   es el número de origen del desvío; nuestro shops.phone_number es el destino que contesta Julie).
-- forward_verified / forward_callerid_ok se setean al verificar una llamada de prueba.

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS public_phone_number text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS number_setup text
  CHECK (number_setup IN ('bought', 'forward', 'port'));
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS forward_verified boolean;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS forward_callerid_ok boolean;
