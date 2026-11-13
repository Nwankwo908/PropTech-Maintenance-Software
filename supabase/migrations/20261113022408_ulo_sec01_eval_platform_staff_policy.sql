-- ULO-SEC-01-F12: evaluation telemetry is platform-staff/service reporting.
-- Portal landlords/team members are not platform staff.
BEGIN;
ALTER POLICY ask_ulo_evals_staff_select
ON public.ask_ulo_evals
TO authenticated
USING (public.is_platform_staff());
COMMIT;

