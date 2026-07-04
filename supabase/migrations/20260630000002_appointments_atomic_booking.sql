-- Migration: agendado atómico — restricción anti-solape (Bloque 3)
-- Date: 2026-06-30
-- Spec: planning/product/whatsapp-citas/prd-full.md §7.2
--
-- Garantiza a nivel de BASE DE DATOS que un barbero no tenga dos citas activas
-- solapadas. Si dos clientes intentan el mismo hueco a la vez, el INSERT del segundo
-- FALLA con error 23P01 (exclusion_violation); el agente lo detecta y ofrece otra hora.
-- Esta es la "reserva atómica" del PRD — la garantía vive en la BD, no en la lógica de app.
--
-- Nota: si la tabla ya tuviera citas activas solapadas (datos viejos), este ALTER fallará;
-- habría que resolver esos solapes antes. En una BD de citas de prueba no debería haber.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    barber_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  ) WHERE (status IN ('confirmed', 'rescheduled'));
