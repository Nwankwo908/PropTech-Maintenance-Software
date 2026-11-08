-- Cached AI/fallback Activity Feed card copy for work orders.
-- Reused until facts_hash changes; never regenerated on every page load.

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS feed_card_copy jsonb;

COMMENT ON COLUMN public.maintenance_requests.feed_card_copy IS
  'Cached Activity Feed card { headline, status_line, facts_hash, source, updated_at }.';
