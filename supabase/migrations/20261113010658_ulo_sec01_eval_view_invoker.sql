-- ULO-SEC-01: preserve staff reporting while enforcing the caller's base-table RLS.
-- This changes view permissions only; no application rows are changed.
BEGIN;

ALTER VIEW public.ask_ulo_eval_daily SET (security_invoker = true);
REVOKE ALL PRIVILEGES ON TABLE public.ask_ulo_eval_daily FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ask_ulo_eval_daily TO authenticated, service_role;

COMMIT;
