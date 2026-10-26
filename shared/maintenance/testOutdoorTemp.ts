/**
 * Controlled outdoor temperature for disposable maintenance-verification
 * landlords only. Live National Weather Service lookup stays in place for
 * every other account, including when this table has no row.
 */
import {
  DEMO_LANDLORD_ID,
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LEASE_IMPORT_TEST_LANDLORD_IDS,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  isSelfServiceLimitedAlphaLandlord,
} from "../landlordCapabilities.ts"

/** Reserved for a disposable maintenance-verification landlord. Not a product account. */
export const DISPOSABLE_MAINTENANCE_TEST_LANDLORD_RE =
  /^d15a0000-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const PROTECTED_LANDLORD_IDS = new Set<string>([
  DEMO_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  EMPTY_LANDLORD_ID,
  ...LEASE_IMPORT_TEST_LANDLORD_IDS,
])

export function isDisposableMaintenanceTestLandlord(
  landlordId: string | null | undefined,
): boolean {
  const id = (landlordId ?? "").trim()
  if (!DISPOSABLE_MAINTENANCE_TEST_LANDLORD_RE.test(id)) return false
  if (PROTECTED_LANDLORD_IDS.has(id)) return false
  if (isSelfServiceLimitedAlphaLandlord(id)) return false
  return true
}

/** Accept a stored °F only for a disposable verification landlord. */
export function controlledOutdoorTempF(
  landlordId: string | null | undefined,
  stored: unknown,
): number | null {
  if (!isDisposableMaintenanceTestLandlord(landlordId)) return null
  const temp = typeof stored === "number" ? stored : Number.NaN
  if (!Number.isFinite(temp) || temp < -40 || temp > 130) return null
  return Math.round(temp)
}
