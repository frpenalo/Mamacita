-- Migration: shops.owner_user_id nullable.
-- Los shops de NXTUP se crean en Mamacita vía el evento shop_profile_updated (alta),
-- y NO tienen un user de auth.users de Mamacita (el dueño se gestiona en NXTUP).
-- El acceso a esos shops es por service role (edge functions); las RLS de dueño
-- siguen aplicando a shops con owner_user_id no nulo (los del producto propio).

ALTER TABLE public.shops ALTER COLUMN owner_user_id DROP NOT NULL;
