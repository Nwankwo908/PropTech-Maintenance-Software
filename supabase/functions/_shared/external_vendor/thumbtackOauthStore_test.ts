/// <reference lib="deno.ns" />

import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
} from "../../../../shared/landlordCapabilities.ts"
import { thumbtackOauthLandlordCandidates } from "./thumbtackOauthStore.ts"

Deno.test("oauth landlord candidates include the Connect account and both alpha accounts", () => {
  const ids = thumbtackOauthLandlordCandidates(LIMITED_ALPHA_2_LANDLORD_ID)
  if (ids[0] !== LIMITED_ALPHA_2_LANDLORD_ID) throw new Error(ids.join(","))
  if (!ids.includes(LIMITED_ALPHA_1_LANDLORD_ID)) throw new Error(ids.join(","))
})
