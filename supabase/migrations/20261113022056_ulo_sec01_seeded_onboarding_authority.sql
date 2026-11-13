-- ULO-SEC-01-F11: seeded onboarding permission must be account-scoped.
-- Preserve the existing seeded-account allowlist and real platform/service access.
-- No application rows or function ACLs are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_mutate_onboarding_inventory_seeded(p_landlord_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT coalesce(
    p_landlord_id = ANY (ARRAY[
      'de300000-0000-4000-8000-000000000003'::uuid,
      'de300000-0000-4000-8000-000000000004'::uuid,
      'de300000-0000-4000-8000-000000000005'::uuid,
      'de300000-0000-4000-8000-0000000000a1'::uuid,
      'de300000-0000-4000-8000-0000000000a2'::uuid,
      'de300000-0000-4000-8000-0000000000a3'::uuid
    ])
    AND (
      coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      OR public.is_platform_staff()
      OR public.can_access_landlord(p_landlord_id)
    ),
    false
  );
$function$;

COMMIT;

