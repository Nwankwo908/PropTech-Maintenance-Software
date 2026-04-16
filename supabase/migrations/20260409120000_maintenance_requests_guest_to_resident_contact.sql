-- Align `guest_*` contact columns with canonical `resident_name`, `email`, and ensure `resident_phone` exists.

alter table public.maintenance_requests
  add column if not exists resident_phone text;

comment on column public.maintenance_requests.resident_phone is
  'Optional phone for SMS; see resident_notification_channel.';

-- guest_name -> resident_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maintenance_requests'
      AND column_name = 'guest_name'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'maintenance_requests'
        AND column_name = 'resident_name'
    ) THEN
      ALTER TABLE public.maintenance_requests RENAME COLUMN guest_name TO resident_name;
    ELSE
      UPDATE public.maintenance_requests
      SET resident_name = COALESCE(
        NULLIF(trim(resident_name), ''),
        NULLIF(trim(guest_name), '')
      );
      ALTER TABLE public.maintenance_requests DROP COLUMN guest_name;
    END IF;
  END IF;
END $$;

-- guest_email -> email
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maintenance_requests'
      AND column_name = 'guest_email'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'maintenance_requests'
        AND column_name = 'email'
    ) THEN
      ALTER TABLE public.maintenance_requests RENAME COLUMN guest_email TO email;
    ELSE
      UPDATE public.maintenance_requests
      SET email = COALESCE(
        NULLIF(trim(email), ''),
        NULLIF(trim(guest_email), '')
      );
      ALTER TABLE public.maintenance_requests DROP COLUMN guest_email;
    END IF;
  END IF;
END $$;
