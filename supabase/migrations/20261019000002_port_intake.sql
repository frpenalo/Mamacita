-- Captura SEGURA del porte del lado de Mamacita (división de sensibilidad acordada 17-oct):
-- la data sensible (cuenta/PIN/dirección/factura/LOA) la mete el dueño por un ENLACE DE UN
-- SOLO USO alojado por nosotros, NO por la UI/storage de NXTUP. NXTUP crea el request solo
-- con lo NO sensible (número + titularidad + operador) y recibe el enlace para el dueño.

-- Nuevo estado 'collecting' = request creado, faltan los datos sensibles del dueño.
ALTER TABLE public.number_port_requests DROP CONSTRAINT IF EXISTS number_port_requests_status_check;
ALTER TABLE public.number_port_requests ADD CONSTRAINT number_port_requests_status_check
  CHECK (status IN ('collecting', 'submitted', 'scheduled', 'completed', 'rejected', 'cancelled'));

-- Token del enlace seguro (un solo uso, con expiración).
ALTER TABLE public.number_port_requests ADD COLUMN IF NOT EXISTS port_token text;
ALTER TABLE public.number_port_requests ADD COLUMN IF NOT EXISTS port_token_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_port_requests_token ON public.number_port_requests(port_token);

-- Bucket PRIVADO para las facturas/LOA subidas en el enlace seguro.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('port-docs', 'port-docs', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;
