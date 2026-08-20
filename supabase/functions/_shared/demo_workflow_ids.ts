/** Demo Property Management showcase landlord (demo@ulohome.io). */
export const DEMO_SHOWCASE_LANDLORD_ID = "de300000-0000-4000-8000-000000000001"

/** Alpha production landlord (ceorentalsnj@gmail.com). Never receives demo vendors. */
export const ALPHA_PRODUCTION_LANDLORD_ID = "068daf53-07e4-4493-bd7f-6106e3c8c62f"

/**
 * Stable move-out workflow run id — first four hex chars render as WO-D777 in Active Tasks.
 * Used when lease renewal "Trigger move-out prep" runs on the showcase account.
 */
export const DEMO_MOVE_OUT_WO_D777_RUN_ID = "d7770000-0000-4000-8000-000000000001"

export function resolveDemoMoveOutRunId(landlordId: string): string | undefined {
  return landlordId === DEMO_SHOWCASE_LANDLORD_ID
    ? DEMO_MOVE_OUT_WO_D777_RUN_ID
    : undefined
}
