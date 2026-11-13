-- ULO-SEC-01-F10: these helpers are internal server/cron operations.
-- Preserve existing postgres/service_role grants and function bodies.
-- No application rows, schedules, provider requests or messages are changed.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.ulo_invoke_edge_function(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ulo_ensure_required_cron_jobs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_landlord_table_batches(regclass, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_sms_provider_status(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_delivery_retry(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_delivery_retry(text, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
