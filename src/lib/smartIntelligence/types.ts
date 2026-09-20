import type { AdminWorkflowDashboardData } from '@/lib/adminWorkflows'

export type SmartInsightType =
  | 'rent'
  | 'lease'
  | 'maintenance'
  | 'vendor'
  | 'resident'
  | 'property'

export type SmartInsightPriority = 'urgent' | 'attention' | 'upcoming' | 'info'

export type SmartInsightAction = {
  label: string
  route: string
  /** When set, the resident profile handles this instead of navigating. */
  intent?: 'edit_resident'
}

export type SmartInsight = {
  id: string
  type: SmartInsightType
  priority: SmartInsightPriority
  title: string
  description: string
  action?: SmartInsightAction
  dueAt?: string
  amount?: number
  entityId?: string
  score: number
}

export type SmartIntelligenceTicket = {
  id: string
  description: string | null
  issueCategory: string | null
  vendorWorkStatus: string
  assignedVendorId: string | null
  assignedAt: string | null
  urgency: string | null
  severity: string | null
  priority: string | null
  scheduledAt: string | null
  dueAt: string | null
  createdAt: string | null
}

export type SmartIntelligenceResident = {
  id: string
  name: string
  unitDisplay: string
  balanceDue: number
  monthlyRent: number | null
  rentDueDay: number | null
  leaseStartDate: string | null
  leaseEndDate: string | null
  activationStatus?: string | null
}

export type SmartIntelligenceContext = {
  resident: SmartIntelligenceResident
  propertyId?: string | null
  workflowData?: AdminWorkflowDashboardData | null
  tickets?: SmartIntelligenceTicket[]
  communicationThreadId?: string | null
  now?: Date
  maxInsights?: number
}

export const SMART_INTELLIGENCE_MAX = 5

export const PRIORITY_SCORE: Record<SmartInsightPriority, number> = {
  urgent: 800,
  attention: 500,
  upcoming: 220,
  info: 80,
}
