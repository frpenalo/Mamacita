-- message_deliveries — registro de cada mensaje business-initiated que mandamos al CLIENTE,
-- para poder caer a SMS cuando el WhatsApp no entrega (el cliente no tiene WhatsApp).
-- El WhatsApp se acepta (SID) aunque el destinatario no use WhatsApp; el fallo real llega
-- después por el StatusCallback de Twilio → ahí se dispara el SMS guardado en sms_body.
-- Solo lo tocan las edge functions (service role); no se expone al dueño del shop.

CREATE TABLE public.message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_sid text UNIQUE,              -- Twilio Message SID del envío primario (WhatsApp)
  to_phone text NOT NULL,                -- E.164, sin prefijo de canal
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms')),
  message_type text NOT NULL,            -- queue_joined | turn_approaching
  sms_body text,                         -- SMS en texto plano a enviar si el WhatsApp falla
  status text NOT NULL DEFAULT 'sent',   -- último estado de Twilio (sent/delivered/failed/undelivered/...)
  fallback_sid text,                     -- SID del SMS de fallback una vez enviado (evita doble envío)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_deliveries_sid ON public.message_deliveries(provider_sid);

ALTER TABLE public.message_deliveries ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el service role (edge functions) accede a esta tabla.
