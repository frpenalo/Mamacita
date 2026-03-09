-- Fix appointments with local time stored as UTC (need to add 4 hours for EDT)
UPDATE appointments 
SET 
  start_time = start_time + INTERVAL '4 hours',
  end_time = end_time + INTERVAL '4 hours'
WHERE id IN (
  'ddd8410e-9005-4bdd-9058-3a906ab78411',
  '31341346-4e7a-4729-99d2-112169633360',
  '3a70e27e-a408-41ce-87d1-51a4c994cb40'
);