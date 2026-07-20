/**
 * getLandlordIncentives — domain tool wrapping landlordIncentivesLookup.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isLandlordIncentivesQuestion,
  landlordIncentivesLookup,
  type LandlordIncentivesResult,
} from "../landlordIncentivesLookup.ts"

export { isLandlordIncentivesQuestion }

export type GetLandlordIncentivesParams = {
  organizationId: string
}

export type GetLandlordIncentivesResult = LandlordIncentivesResult & {
  toolId: "get_landlord_incentives"
  params: Record<string, unknown>
}

export async function getLandlordIncentives(
  supabase: SupabaseClient,
  params: GetLandlordIncentivesParams,
): Promise<GetLandlordIncentivesResult> {
  const base = await landlordIncentivesLookup(supabase, {
    landlordId: params.organizationId,
  })
  return {
    ...base,
    toolId: "get_landlord_incentives",
    params: {
      organizationId: params.organizationId,
      stateCode: base.stateCode,
      programCount: base.programs.length,
    },
  }
}
