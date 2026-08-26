import type { CommunicationStyle } from '@/lib/communicationStyle'
import type { OrganizationSettingsForm } from '@/lib/organizationSettings'
import type { NotificationSettingsState } from '@/lib/notificationSettings'

export type RegisteredAddress = {
  street: string
  city: string
  state: string
  zip: string
}

export type LandlordOperationalSettings = {
  escalationThreshold: string
  defaultResponseSla: string
  requirePhotoEvidence: boolean
  allowAiDispatch: boolean
  rentReminderCadence: string
  preferredLanguage: string
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
}

export type LandlordWorkspaceSettings = {
  timeZone: string
  currency: string
  dateFormat: string
  brandAccent: string
  logoUrl?: string
}

export type ConnectedEmailProvider = 'gmail' | 'outlook' | 'microsoft365'

export type ConnectedEmailSettings = {
  connected: boolean
  provider: ConnectedEmailProvider | null
  email: string
  connectedAt: string | null
  paused: boolean
  automation: Record<string, boolean>
}

export type BillingPaymentMethod = {
  brand: string
  last4: string
  expMonth: string
  expYear: string
}

export type LandlordBillingSettings = {
  paymentMethod: BillingPaymentMethod | null
}

export type LandlordSettingsSnapshot = {
  landlordId: string
  organization: OrganizationSettingsForm
  notifications: NotificationSettingsState
  planLabel: string
  memberSince: string | null
}

export type LandlordAccountSettingsPayload = {
  organization?: Partial<OrganizationSettingsForm>
  notifications?: NotificationSettingsState
  operational?: Partial<LandlordOperationalSettings>
  workspace?: Partial<LandlordWorkspaceSettings>
  connectedEmail?: ConnectedEmailSettings
  billing?: LandlordBillingSettings
  version?: number
}

export const DEFAULT_OPERATIONAL_SETTINGS: LandlordOperationalSettings = {
  escalationThreshold: '2500',
  defaultResponseSla: '4 hours',
  requirePhotoEvidence: true,
  allowAiDispatch: true,
  rentReminderCadence: '5, 3, 1 days before',
  preferredLanguage: 'English (US)',
  quietHoursEnabled: true,
  quietHoursStart: '10:00 PM',
  quietHoursEnd: '8:00 AM',
}

export const DEFAULT_WORKSPACE_SETTINGS: LandlordWorkspaceSettings = {
  timeZone: 'America/Los_Angeles',
  currency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  brandAccent: '#101828',
  logoUrl: '',
}

export type PersistedProfileFields = {
  companyName: string
  displayName: string
  contactName: string
  email: string
  phone: string
  backupContactName: string
  backupContactPhone: string
  about: string
  registeredAddress: RegisteredAddress
  communicationStyle: CommunicationStyle
}
