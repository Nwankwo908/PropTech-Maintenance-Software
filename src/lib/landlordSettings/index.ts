/**
 * Central landlord Settings load/save — DB source of truth for Alpha accounts.
 */
import { getActiveLandlordId, DEMO_LANDLORD_ID } from '@/lib/activeLandlord'
import {
  normalizeCommunicationStyle,
} from '@/lib/communicationStyle'
import {
  marketplaceLabelFromPreference,
  marketplacePreferenceFromLabel,
  notificationChannelFromToggles,
  notificationTogglesFromChannel,
  persistLandlordAccountProfileFields,
} from '@/lib/landlordAccountProfile'
import { normalizeOnboardingApprovalRules, normalizeQuietHoursTime } from '@/lib/onboardingApprovalRules'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  type NotificationSettingsState,
} from '@/lib/notificationSettings'
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  normalizeRentReminderCadence,
  type OrganizationSettingsForm,
  type OrganizationWorkspaceSummary,
} from '@/lib/organizationSettings'
import { supabase } from '@/lib/supabase'
import { formatLandlordDate } from '@/lib/landlordWorkspace'
import { resolveLogoDisplayUrl } from '@/lib/landlordLogoUpload'
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  type LandlordAccountSettingsPayload,
  type RegisteredAddress,
  type LandlordSettingsSnapshot,
} from '@/lib/landlordSettings/types'

export type { LandlordSettingsSnapshot, RegisteredAddress }

const ORG_STORAGE_PREFIX = 'ulo.organizationSettings.'
const NOTIF_STORAGE_KEY = 'ulo.notificationSettings'

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatCreatedLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return formatLandlordDate(value)
}

function workspaceIdFromLandlord(landlordId: string): string {
  const compact = landlordId.replace(/-/g, '').slice(0, 5)
  return `ulo_${compact}`
}

function parseRegisteredAddress(raw: unknown): RegisteredAddress {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    street: asTrimmed(row.street),
    city: asTrimmed(row.city),
    state: asTrimmed(row.state),
    zip: asTrimmed(row.zip),
  }
}

function planLabelFromRow(isDemo: boolean | null | undefined, planTier: string | null | undefined): string {
  if (isDemo) return 'Demo'
  const tier = asTrimmed(planTier)?.toLowerCase()
  if (!tier || tier === 'alpha') return 'Ulo Alpha'
  return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase()
}

function readLegacyOrganizationLocal(landlordId: string): Partial<OrganizationSettingsForm> | null {
  try {
    const raw = window.localStorage.getItem(`${ORG_STORAGE_PREFIX}${landlordId}`)
    if (!raw) return null
    return JSON.parse(raw) as Partial<OrganizationSettingsForm>
  } catch {
    return null
  }
}

function readLegacyNotificationLocal(): Partial<NotificationSettingsState> | null {
  try {
    const raw = window.localStorage.getItem(NOTIF_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<NotificationSettingsState>
  } catch {
    return null
  }
}

export function mergeOrganizationForm(input: {
  persisted?: Partial<OrganizationSettingsForm>
  legacyLocal?: Partial<OrganizationSettingsForm> | null
  landlordRow: Record<string, unknown> | null
  onboardingRow: Record<string, unknown> | null
  accountSettings: LandlordAccountSettingsPayload
  draftState: Record<string, unknown>
}): OrganizationSettingsForm {
  const draft = input.draftState
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  const approvalRules = normalizeOnboardingApprovalRules({
    ...(draft.approvalRules as Record<string, unknown> | undefined),
    auto_approval_threshold: input.onboardingRow?.auto_approval_threshold,
    marketplace_preference: input.onboardingRow?.marketplace_preference,
    communication_style:
      input.landlordRow?.communication_style ?? input.onboardingRow?.communication_style,
    notification_channel: input.onboardingRow?.notification_channel,
  })

  const savedOperational = input.accountSettings.operational ?? {}
  const savedWorkspace = input.accountSettings.workspace ?? {}
  const address = parseRegisteredAddress(input.landlordRow?.registered_address)

  let next: OrganizationSettingsForm = {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...(input.legacyLocal ?? {}),
    ...(input.persisted ?? {}),
    ...(input.accountSettings.organization ?? {}),
  }

  const legalName = asTrimmed(input.landlordRow?.name) || asTrimmed(account.companyName)
  if (legalName) next.legalName = legalName

  if (input.landlordRow) {
    const displayFromDb = asTrimmed(input.landlordRow.display_name)
    next.displayName = displayFromDb || legalName || next.displayName
    next.about = asTrimmed(input.landlordRow.about)
  } else if (legalName && !next.displayName.trim()) {
    next.displayName = legalName
  }

  const contactName = asTrimmed(input.landlordRow?.contact_name) || asTrimmed(account.contactName)
  if (contactName) next.contactName = contactName
  const email = asTrimmed(input.landlordRow?.email) || asTrimmed(account.email)
  if (email) next.supportEmail = email
  const phone = asTrimmed(input.landlordRow?.phone) || asTrimmed(account.phone)
  if (phone) next.phone = phone
  const backupContactName = asTrimmed(account.backupContactName)
  if (backupContactName) next.backupContactName = backupContactName
  const backupContactPhone = asTrimmed(account.backupContactPhone)
  if (backupContactPhone) next.backupContactPhone = backupContactPhone

  next.street = address.street || next.street
  next.city = address.city || next.city
  next.state = address.state || next.state
  next.zip = address.zip || next.zip
  next.timeZone =
    asTrimmed(input.landlordRow?.time_zone) ||
    asTrimmed(savedWorkspace.timeZone) ||
    next.timeZone

  if (asTrimmed(savedWorkspace.currency)) next.currency = asTrimmed(savedWorkspace.currency)
  if (asTrimmed(savedWorkspace.dateFormat)) next.dateFormat = asTrimmed(savedWorkspace.dateFormat)
  if (asTrimmed(savedWorkspace.brandAccent)) next.brandAccent = asTrimmed(savedWorkspace.brandAccent)

  const logoFromDb = asTrimmed(input.landlordRow?.logo_url)
  if (logoFromDb) {
    next.logoStorageRef = logoFromDb
  } else if (asTrimmed(next.logoStorageRef)) {
    // keep persisted org ref
  } else {
    next.logoStorageRef = ''
  }
  // Display URL resolved asynchronously in loadLandlordSettings
  next.logoUrl = asTrimmed(next.logoUrl)

  next.communicationStyle = normalizeCommunicationStyle(
    asTrimmed(input.landlordRow?.communication_style) ||
      asTrimmed(input.onboardingRow?.communication_style) ||
      approvalRules.communicationStyle ||
      next.communicationStyle,
  )

  if (input.onboardingRow?.auto_approval_threshold != null) {
    next.autoApprovalLimit = String(Math.round(Number(input.onboardingRow.auto_approval_threshold)))
  } else if (Number.isFinite(approvalRules.autoApprovalThreshold)) {
    next.autoApprovalLimit = String(approvalRules.autoApprovalThreshold)
  }

  const marketplaceLabel = marketplaceLabelFromPreference(
    asTrimmed(input.onboardingRow?.marketplace_preference) || approvalRules.marketplacePreference,
  )
  if (marketplaceLabel) next.preferredVendorPool = marketplaceLabel

  Object.assign(
    next,
    notificationTogglesFromChannel(
      asTrimmed(input.onboardingRow?.notification_channel) || approvalRules.notificationChannel,
    ),
  )

  if (asTrimmed(savedOperational.escalationThreshold)) {
    next.escalationThreshold = asTrimmed(savedOperational.escalationThreshold)
  }
  if (asTrimmed(savedOperational.defaultResponseSla)) {
    next.defaultResponseSla = asTrimmed(savedOperational.defaultResponseSla)
  }
  if (typeof savedOperational.requirePhotoEvidence === 'boolean') {
    next.requirePhotoEvidence = savedOperational.requirePhotoEvidence
  }
  if (typeof savedOperational.allowAiDispatch === 'boolean') {
    next.allowAiDispatch = savedOperational.allowAiDispatch
  }
  if (asTrimmed(savedOperational.rentReminderCadence)) {
    next.rentReminderCadence = normalizeRentReminderCadence(savedOperational.rentReminderCadence)
  }
  if (asTrimmed(savedOperational.preferredLanguage)) {
    next.preferredLanguage = asTrimmed(savedOperational.preferredLanguage)
  }
  if (typeof savedOperational.quietHoursEnabled === 'boolean') {
    next.quietHours = savedOperational.quietHoursEnabled
  } else if (typeof draft.approvalRules === 'object' && draft.approvalRules != null) {
    const quiet = (draft.approvalRules as Record<string, unknown>).quietHoursEnabled
    if (typeof quiet === 'boolean') next.quietHours = quiet
  }

  const notifDelivery = input.accountSettings.notifications?.delivery
  const quietStart =
    asTrimmed(savedOperational.quietHoursStart) ||
    asTrimmed(notifDelivery?.quietHoursStart) ||
    asTrimmed(approvalRules.quietHoursStart)
  if (quietStart) {
    next.quietHoursStart = normalizeQuietHoursTime(quietStart)
  }
  const quietEnd =
    asTrimmed(savedOperational.quietHoursEnd) ||
    asTrimmed(notifDelivery?.quietHoursEnd) ||
    asTrimmed(approvalRules.quietHoursEnd)
  if (quietEnd) {
    next.quietHoursEnd = normalizeQuietHoursTime(quietEnd, '8:00 AM')
  }

  const pushFromNotifications = input.accountSettings.notifications?.delivery?.pushEnabled
  if (typeof pushFromNotifications === 'boolean') {
    next.pushNotifications = pushFromNotifications
  } else if (typeof input.accountSettings.organization?.pushNotifications === 'boolean') {
    next.pushNotifications = input.accountSettings.organization.pushNotifications
  } else if (typeof input.persisted?.pushNotifications === 'boolean') {
    next.pushNotifications = input.persisted.pushNotifications
  }

  return normalizeOrganizationSettings(next)
}

export function normalizeOrganizationSettings(settings: OrganizationSettingsForm): OrganizationSettingsForm {
  return {
    ...settings,
    rentReminderCadence: normalizeRentReminderCadence(settings.rentReminderCadence),
    quietHoursStart: normalizeQuietHoursTime(settings.quietHoursStart),
    quietHoursEnd: normalizeQuietHoursTime(settings.quietHoursEnd, '8:00 AM'),
    communicationStyle: normalizeCommunicationStyle(settings.communicationStyle),
  }
}

function mergeNotificationSettings(input: {
  accountSettings: LandlordAccountSettingsPayload
  legacyLocal?: Partial<NotificationSettingsState> | null
  notificationChannel: string | null
  pushNotifications?: boolean
}): NotificationSettingsState {
  const base = normalizeNotificationSettings({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(input.legacyLocal ?? {}),
    ...(input.accountSettings.notifications ?? {}),
  })

  const pushEnabled =
    typeof input.accountSettings.notifications?.delivery?.pushEnabled === 'boolean'
      ? input.accountSettings.notifications.delivery.pushEnabled
      : typeof input.pushNotifications === 'boolean'
        ? input.pushNotifications
        : base.delivery.pushEnabled

  const channel = asTrimmed(input.notificationChannel).toLowerCase()
  if (!channel) {
    return {
      ...base,
      delivery: {
        ...base.delivery,
        pushEnabled,
        quietHoursStart: input.accountSettings.operational?.quietHoursStart ?? base.delivery.quietHoursStart,
        quietHoursEnd: input.accountSettings.operational?.quietHoursEnd ?? base.delivery.quietHoursEnd,
      },
    }
  }

  const primary =
    channel === 'both'
      ? 'email'
      : channel === 'activity_feed'
        ? 'activity_feed'
        : channel === 'sms'
          ? 'sms'
          : channel === 'push'
            ? 'push'
            : 'email'

  return {
    ...base,
    delivery: {
      ...base.delivery,
      primaryChannel: primary as NotificationSettingsState['delivery']['primaryChannel'],
      fallbackChannel:
        primary === 'sms' ? 'email' : primary === 'email' ? 'sms' : base.delivery.fallbackChannel,
      pushEnabled,
      quietHoursStart: input.accountSettings.operational?.quietHoursStart ?? base.delivery.quietHoursStart,
      quietHoursEnd: input.accountSettings.operational?.quietHoursEnd ?? base.delivery.quietHoursEnd,
    },
  }
}

export async function loadLandlordSettings(
  landlordId: string = getActiveLandlordId(),
): Promise<LandlordSettingsSnapshot> {
  const fallback: LandlordSettingsSnapshot = {
    landlordId,
    organization: { ...DEFAULT_ORGANIZATION_SETTINGS },
    notifications: normalizeNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS),
    planLabel: landlordId === DEMO_LANDLORD_ID ? 'Demo' : 'Ulo Alpha',
    memberSince: null,
  }

  if (!supabase) return fallback

  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase
      .from('landlords')
      .select(
        'name, email, phone, contact_name, communication_style, display_name, about, registered_address, time_zone, logo_url, plan_tier, is_demo, created_at',
      )
      .eq('id', landlordId)
      .maybeSingle(),
    supabase
      .from('landlord_onboarding')
      .select(
        'auto_approval_threshold, marketplace_preference, communication_style, notification_channel, account_settings, draft_state',
      )
      .eq('landlord_id', landlordId)
      .maybeSingle(),
  ])

  const draftState = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const accountSettings = (onboarding?.account_settings ?? {}) as LandlordAccountSettingsPayload
  const persistedOrg = {
    ...(draftState.organizationSettings as Partial<OrganizationSettingsForm> | undefined),
    ...(accountSettings.organization ?? {}),
  }

  const organization = mergeOrganizationForm({
    persisted: persistedOrg,
    legacyLocal: readLegacyOrganizationLocal(landlordId),
    landlordRow: (landlord ?? null) as Record<string, unknown> | null,
    onboardingRow: (onboarding ?? null) as Record<string, unknown> | null,
    accountSettings,
    draftState,
  })

  if (organization.logoStorageRef) {
    organization.logoUrl = await resolveLogoDisplayUrl(organization.logoStorageRef)
  } else {
    organization.logoUrl = ''
  }

  const notifications = mergeNotificationSettings({
    accountSettings,
    legacyLocal: readLegacyNotificationLocal(),
    notificationChannel: asTrimmed(onboarding?.notification_channel),
    pushNotifications: organization.pushNotifications,
  })

  // Keep org toggle and notification delivery in sync after merge
  organization.pushNotifications = notifications.delivery.pushEnabled

  return {
    landlordId,
    organization,
    notifications,
    planLabel: planLabelFromRow(landlord?.is_demo, landlord?.plan_tier),
    memberSince: landlord?.created_at ?? null,
  }
}

export async function saveLandlordOrganizationSettings(
  settings: OrganizationSettingsForm,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Database unavailable.' }

  const autoApproval = Number.parseFloat(settings.autoApprovalLimit.replace(/[^\d.]/g, ''))
  const marketplacePreference = marketplacePreferenceFromLabel(settings.preferredVendorPool)
  const notificationChannel = notificationChannelFromToggles({
    emailUpdates: settings.emailUpdates,
    smsAlerts: settings.smsAlerts,
    activityFeedAlerts: settings.activityFeedAlerts,
  })
  const communicationStyle = normalizeCommunicationStyle(settings.communicationStyle)

  const operational = {
    escalationThreshold: settings.escalationThreshold,
    defaultResponseSla: settings.defaultResponseSla,
    requirePhotoEvidence: settings.requirePhotoEvidence,
    allowAiDispatch: settings.allowAiDispatch,
    rentReminderCadence: settings.rentReminderCadence,
    preferredLanguage: settings.preferredLanguage,
    quietHoursEnabled: settings.quietHours,
    quietHoursStart: normalizeQuietHoursTime(settings.quietHoursStart),
    quietHoursEnd: normalizeQuietHoursTime(settings.quietHoursEnd, '8:00 AM'),
  }

  const workspace = {
    timeZone: settings.timeZone,
    currency: settings.currency,
    dateFormat: settings.dateFormat,
    brandAccent: settings.brandAccent,
  }

  const registeredAddress: RegisteredAddress = {
    street: settings.street.trim(),
    city: settings.city.trim(),
    state: settings.state.trim(),
    zip: settings.zip.trim(),
  }

  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('draft_state, account_settings')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const draft = (existing?.draft_state ?? {}) as Record<string, unknown>
  const priorAccount = (existing?.account_settings ?? {}) as LandlordAccountSettingsPayload
  const accountSetup = (draft.accountSetup ?? {}) as Record<string, unknown>
  const priorNotifications = normalizeNotificationSettings({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(priorAccount.notifications ?? {}),
  })

  const accountSettings: LandlordAccountSettingsPayload = {
    ...priorAccount,
    version: 1,
    organization: settings,
    operational: {
      ...(priorAccount.operational ?? {}),
      ...operational,
    },
    workspace,
    notifications: {
      ...priorNotifications,
      delivery: {
        ...priorNotifications.delivery,
        quietHoursStart: operational.quietHoursStart,
        quietHoursEnd: operational.quietHoursEnd,
        pushEnabled: settings.pushNotifications,
      },
    },
  }

  const upsertRow: Record<string, unknown> = {
    landlord_id: landlordId,
    auto_approval_threshold: Number.isFinite(autoApproval) ? autoApproval : 250,
    communication_style: communicationStyle,
    notification_channel: notificationChannel,
    account_settings: accountSettings,
    draft_state: {
      ...draft,
      accountSetup: {
        ...accountSetup,
        companyName: settings.legalName,
        contactName: settings.contactName,
        email: settings.supportEmail,
        phone: settings.phone,
        backupContactName: settings.backupContactName,
        backupContactPhone: settings.backupContactPhone,
      },
      organizationSettings: settings,
      approvalRules: {
        ...(typeof draft.approvalRules === 'object' ? draft.approvalRules : {}),
        autoApprovalThreshold: Number.isFinite(autoApproval) ? autoApproval : 250,
        marketplacePreference: marketplacePreference ?? 'include_imported',
        notificationChannel,
        communicationStyle,
        quietHoursEnabled: settings.quietHours,
        quietHoursStart: operational.quietHoursStart,
        quietHoursEnd: operational.quietHoursEnd,
      },
    },
    updated_at: new Date().toISOString(),
  }
  if (marketplacePreference) upsertRow.marketplace_preference = marketplacePreference

  const { error: onboardingError } = await supabase
    .from('landlord_onboarding')
    .upsert(upsertRow, { onConflict: 'landlord_id' })

  if (onboardingError && /account_settings|column .* does not exist/i.test(onboardingError.message)) {
    const { account_settings: _drop, ...legacyRow } = upsertRow
    const { error: legacyError } = await supabase
      .from('landlord_onboarding')
      .upsert(legacyRow, { onConflict: 'landlord_id' })
    if (legacyError) return { ok: false, error: legacyError.message }
  } else if (onboardingError) {
    return { ok: false, error: onboardingError.message }
  }

  const landlordUpdate: Record<string, unknown> = {
    name: settings.legalName.trim() || null,
    display_name: settings.displayName.trim() || null,
    contact_name: settings.contactName.trim() || null,
    email: settings.supportEmail.trim() || null,
    phone: settings.phone.trim() || null,
    about: settings.about.trim() || null,
    registered_address: registeredAddress,
    time_zone: settings.timeZone.trim() || DEFAULT_WORKSPACE_SETTINGS.timeZone,
    communication_style: communicationStyle,
    logo_url: settings.logoStorageRef.trim() || null,
  }

  let { error: landlordError } = await supabase.from('landlords').update(landlordUpdate).eq('id', landlordId)

  if (landlordError && /display_name|registered_address|about|time_zone|logo_url|column .* does not exist/i.test(landlordError.message)) {
    const {
      display_name: _d,
      about: _a,
      registered_address: _r,
      time_zone: _t,
      logo_url: _l,
      ...legacyLandlord
    } = landlordUpdate
    const retry = await supabase.from('landlords').update(legacyLandlord).eq('id', landlordId)
    landlordError = retry.error
  }

  if (landlordError) {
    return { ok: false, error: landlordError.message }
  }

  const profileResult = await persistLandlordAccountProfileFields(landlordId, {
    companyName: settings.legalName.trim(),
    contactName: settings.contactName.trim(),
    email: settings.supportEmail.trim(),
    phone: settings.phone.trim(),
    backupContactName: settings.backupContactName.trim(),
    backupContactPhone: settings.backupContactPhone.trim(),
  })
  if (!profileResult.ok) return profileResult

  const { persistLandlordCommunicationStyle } = await import('@/lib/onboarding/persist/account')
  await persistLandlordCommunicationStyle(landlordId, communicationStyle, {
    eventType: 'landlord.communication_style_updated',
    step: 'settings',
    source: 'admin_ui',
  })

  try {
    window.localStorage.removeItem(`${ORG_STORAGE_PREFIX}${landlordId}`)
    window.localStorage.removeItem(NOTIF_STORAGE_KEY)
  } catch {
    // ignore
  }

  return { ok: true }
}

export async function saveLandlordNotificationSettings(
  state: NotificationSettingsState,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Database unavailable.' }

  const normalized = normalizeNotificationSettings(state)

  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('draft_state, account_settings')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const draft = (existing?.draft_state ?? {}) as Record<string, unknown>
  const priorAccount = (existing?.account_settings ?? {}) as LandlordAccountSettingsPayload
  const notificationChannel = normalized.delivery.primaryChannel

  const accountSettings: LandlordAccountSettingsPayload = {
    ...priorAccount,
    version: 1,
    notifications: normalized,
    operational: {
      ...(priorAccount.operational ?? DEFAULT_OPERATIONAL_SETTINGS),
      quietHoursStart: normalized.delivery.quietHoursStart,
      quietHoursEnd: normalized.delivery.quietHoursEnd,
    },
    organization: {
      ...(priorAccount.organization ?? {}),
      pushNotifications: normalized.delivery.pushEnabled,
    },
  }

  const { error } = await supabase.from('landlord_onboarding').upsert(
    {
      landlord_id: landlordId,
      notification_channel: notificationChannel,
      account_settings: accountSettings,
      draft_state: {
        ...draft,
        approvalRules: {
          ...(typeof draft.approvalRules === 'object' ? draft.approvalRules : {}),
          notificationChannel,
        },
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'landlord_id' },
  )

  if (error) return { ok: false, error: error.message }

  try {
    window.localStorage.removeItem(NOTIF_STORAGE_KEY)
  } catch {
    // ignore
  }

  return { ok: true }
}

export async function loadOrganizationWorkspaceSummary(
  landlordId: string = getActiveLandlordId(),
): Promise<OrganizationWorkspaceSummary> {
  const settings = await loadLandlordSettings(landlordId)
  const fallback: OrganizationWorkspaceSummary = {
    planLabel: settings.planLabel,
    propertyCount: 0,
    activeUnitCount: 0,
    teamMemberCount: 1,
    createdLabel: formatCreatedLabel(settings.memberSince),
    workspaceId: workspaceIdFromLandlord(landlordId),
  }

  if (!supabase) return fallback

  const [{ count: unitCount }, propertiesResult] = await Promise.all([
    supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
  ])

  return {
    ...fallback,
    propertyCount: propertiesResult.count ?? 0,
    activeUnitCount: unitCount ?? 0,
  }
}

export function defaultResponseSlaMinutes(slaLabel: string | null | undefined): number | null {
  const normalized = asTrimmed(slaLabel).toLowerCase()
  if (!normalized) return null
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|m|day|d)/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]
  if (unit.startsWith('h')) return Math.round(amount * 60)
  if (unit.startsWith('d')) return Math.round(amount * 24 * 60)
  return Math.round(amount)
}
