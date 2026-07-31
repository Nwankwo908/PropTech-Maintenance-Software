/**
 * External vendor search helpers.
 * Trade taxonomy: shared/maintenance/vendorTrades.ts
 */
export {
  buildExternalSearchQueryFromTrade as buildExternalSearchQuery,
  issueCategoryToVendorTrade as normalizeIssueCategoryForSearch,
  tradeBucketFromVendorTrade as tradeBucketFromCategory,
  tradeTermsFromVendorTrade as tradeTermsFromCategory,
  type ExternalVendorTradeBucket,
} from '../vendor_trades.ts'
