-- number_port_requests — intake del PORTE de un número (fase: captura self-serve, porte manual).
-- El dueño entrega los datos de su operador para portar su número a nuestro Twilio (Softmedia).
-- El sometimiento del porte en Twilio lo hace OPS a mano con estos datos; aquí solo los
-- capturamos y seguimos el estado para mostrárselo al dueño.
--
-- SENSIBLE: carrier_account_number y carrier_pin son credenciales del operador del dueño.
-- Solo las toca el service role (sin políticas RLS). PURGAR carrier_pin y carrier_account_number
-- cuando status pase a 'completed' o 'cancelled' (ya no se necesitan).

CREATE TABLE public.number_port_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE NOT NULL,
  phone_number text NOT NULL,              -- el número a portar (el público del dueño)
  carrier_name text,
  carrier_account_number text,             -- SENSIBLE (cuenta del operador)
  carrier_pin text,                        -- SENSIBLE (clave/PIN del operador)
  service_address text,
  authorized_name text,
  bill_url text,                           -- factura reciente (URL en storage de NXTUP)
  loa_signer_name text,                    -- quién firmó la Carta de Autorización
  loa_signed_at timestamptz,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'scheduled', 'completed', 'rejected', 'cancelled')),
  reject_reason text,                      -- motivo si el operador rechaza (normalmente PIN/cuenta mal)
  foc_date date,                           -- fecha de corte confirmada por Twilio
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_port_requests_shop ON public.number_port_requests(shop_id);

ALTER TABLE public.number_port_requests ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el service role (edge functions / ops) accede.
