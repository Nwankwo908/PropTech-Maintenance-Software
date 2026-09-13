export type {
  SmartInsight,
  SmartInsightPriority,
  SmartIntelligenceContext,
  SmartIntelligenceTicket,
} from '@/lib/smartIntelligence/types'
export { buildSmartIntelligence, attentionCount } from '@/lib/smartIntelligence/buildSmartIntelligence'
export { evaluateRentIntelligence } from '@/lib/smartIntelligence/evaluateRent'
export { evaluateLeaseIntelligence } from '@/lib/smartIntelligence/evaluateLease'
export { evaluateMaintenanceIntelligence } from '@/lib/smartIntelligence/evaluateMaintenance'
export { evaluateVendorIntelligence } from '@/lib/smartIntelligence/evaluateVendor'
export { evaluateResidentIntelligence } from '@/lib/smartIntelligence/evaluateResident'
export { evaluatePropertyIntelligence } from '@/lib/smartIntelligence/evaluateProperty'
