/**
 * External vendor search helpers.
 * Trade taxonomy lives in `_shared/vendor_trades.ts` (keep in sync with `src/lib/vendorTrades.ts`).
 */
export {
  buildExternalSearchQueryFromTrade as buildExternalSearchQuery,
  issueCategoryToVendorTrade as normalizeIssueCategoryForSearch,
  tradeBucketFromVendorTrade as tradeBucketFromCategory,
  tradeTermsFromVendorTrade as tradeTermsFromCategory,
  type ExternalVendorTradeBucket,
} from '../vendor_trades.ts'
