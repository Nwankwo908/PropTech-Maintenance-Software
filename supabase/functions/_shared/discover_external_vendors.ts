/**
 * Back-compat re-exports. Prefer `external_vendor/discover.ts` and `external_vendor/ranking.ts`.
 */
export {
  discoverExternalVendorsMerged,
  type DiscoverExternalVendorsInput,
} from "./external_vendor/discover.ts"

export type { ExternalVendorSuggestion } from "./external_vendor/types.ts"
