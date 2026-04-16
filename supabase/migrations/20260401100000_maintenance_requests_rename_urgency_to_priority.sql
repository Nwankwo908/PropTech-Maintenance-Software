-- Legacy databases created before `priority` replaced `urgency`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maintenance_requests'
      AND column_name = 'urgency'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maintenance_requests'
      AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.maintenance_requests RENAME COLUMN urgency TO priority;
  END IF;
END $$;
