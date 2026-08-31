import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  mergeNotificationMatrixCategories,
  type MatrixCategory,
} from "./notificationMatrixDefaults.ts"
import {
  normalizeOpsAlertChannelPreference,
  opsAlertChannelsEnabled,
} from "./sms/tenantActivationFailure.ts"
import { landlordHasVendorMarketplace } from "../../../shared/landlordCapabilities.ts"

export type EdgeNotificationChannel = "email" | "sms" | "activity_feed" | "push"

export type EdgeNotificationSettings = {
  delivery: {
    primaryChannel: EdgeNotificationChannel
    fallbackChannel: EdgeNotificationChannel
    autoFallback: boolean
    quietHoursStart: string
    quietHoursEnd: string
  }
  categories: MatrixCategory[]
}

export type MarketplacePreferenceId = "ulo_vetted_only" | "include_imported"

export type EdgeOperationalSettings = {
  allowAiDispatch: boolean
  requirePhotoEvidence: boolean
  defaultResponseSla: string
  escalationThreshold: string
  rentReminderCadence: string
  preferredLanguage: string
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  timeZone: string
}

export type LandlordApprovalLimits = {
  autoApprovalThreshold: number
  escalationThreshold: number
}

export function parseMoneyThreshold(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100
  }
  if (typeof value !== "string") return null
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100) / 100
}

export function requiresCompletionPhotoEvidence(
  settings: Pick<EdgeOperationalSettings, "requirePhotoEvidence">,
): boolean {
  return settings.requirePhotoEvidence !== false
}

export function resolveTicketSlaMinutes(input: {
  category?: string | null
  severity?: string | null
  defaultResponseSla?: string | null
  overrideMinutes?: number | null
  /** Category/severity table from shared/maintenance/slaRules.ts */
  fallbackMinutes?: (category?: string, severity?: string) => number
}): number {
  if (
    input.overrideMinutes != null &&
    Number.isFinite(input.overrideMinutes) &&
    input.overrideMinutes > 0
  ) {
    return Math.round(input.overrideMinutes)
  }
  const fromSettings = defaultResponseSlaMinutes(input.defaultResponseSla)
  if (fromSettings) return fromSettings
  if (input.fallbackMinutes) {
    return input.fallbackMinutes(
      input.category ?? undefined,
      input.severity ?? undefined,
    )
  }
  return 240
}

export async function loadLandlordMarketplacePreference(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<MarketplacePreferenceId> {
  if (!landlordHasVendorMarketplace(landlordId)) return "include_imported"
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("marketplace_preference, account_settings")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  const fromColumn = typeof onboarding?.marketplace_preference === "string"
    ? onboarding.marketplace_preference.trim()
    : ""
  if (fromColumn === "ulo_vetted_only" || fromColumn === "include_imported") {
    return fromColumn
  }

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const organization = (account.organization ?? {}) as Record<string, unknown>
  const label = typeof organization.preferredVendorPool === "string"
    ? organization.preferredVendorPool.trim()
    : ""
  if (label === "Ulo-vetted vendors only") return "ulo_vetted_only"
  return "include_imported"
}

export async function loadLandlordApprovalLimits(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<LandlordApprovalLimits> {
  const [{ data: onboarding }, operational] = await Promise.all([
    supabase
      .from("landlord_onboarding")
      .select("auto_approval_threshold, account_settings")
      .eq("landlord_id", landlordId)
      .maybeSingle(),
    loadLandlordOperationalSettings(supabase, landlordId),
  ])

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const organization = (account.organization ?? {}) as Record<string, unknown>

  const autoFromRow = Number(onboarding?.auto_approval_threshold)
  const autoFromOrg = parseMoneyThreshold(organization.autoApprovalLimit)
  const autoApprovalThreshold =
    (Number.isFinite(autoFromRow) && autoFromRow > 0 ? autoFromRow : null) ??
    autoFromOrg ??
    250

  const escalationFromOperational = parseMoneyThreshold(operational.escalationThreshold)
  const escalationFromOrg = parseMoneyThreshold(organization.escalationThreshold)
  const escalationThreshold =
    escalationFromOperational ?? escalationFromOrg ?? 2500

  return { autoApprovalThreshold, escalationThreshold }
}

const DEFAULT_SETTINGS: EdgeNotificationSettings = {
  delivery: {
    primaryChannel: "email",
    fallbackChannel: "sms",
    autoFallback: true,
    quietHoursStart: "10:00 PM",
    quietHoursEnd: "8:00 AM",
  },
  categories: mergeNotificationMatrixCategories(undefined),
}

export async function loadLandlordOperationalSettings(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EdgeOperationalSettings> {
  const [{ data: landlord }, { data: onboarding }] = await Promise.all([
    supabase.from("landlords").select("time_zone").eq("id", landlordId).maybeSingle(),
    supabase
      .from("landlord_onboarding")
      .select("account_settings")
      .eq("landlord_id", landlordId)
      .maybeSingle(),
  ])

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const operational = (account.operational ?? {}) as Record<string, unknown>
  const organization = (account.organization ?? {}) as Record<string, unknown>

  const defaultResponseSla =
    (typeof operational.defaultResponseSla === "string" &&
        operational.defaultResponseSla.trim()) ||
    (typeof organization.defaultResponseSla === "string" &&
        organization.defaultResponseSla.trim()) ||
    "4 hours"

  const escalationThreshold =
    (typeof operational.escalationThreshold === "string" &&
        operational.escalationThreshold.trim()) ||
    (typeof organization.escalationThreshold === "string" &&
        organization.escalationThreshold.trim()) ||
    "2500"

  const rentReminderCadence =
    (typeof operational.rentReminderCadence === "string" &&
        operational.rentReminderCadence.trim()) ||
    (typeof organization.rentReminderCadence === "string" &&
        organization.rentReminderCadence.trim()) ||
    "5, 3, 1 days before"

  const preferredLanguage =
    (typeof operational.preferredLanguage === "string" &&
        operational.preferredLanguage.trim()) ||
    (typeof organization.preferredLanguage === "string" &&
        organization.preferredLanguage.trim()) ||
    "English (US)"

  const notifications = account.notifications as EdgeNotificationSettings | undefined
  const delivery = notifications?.delivery

  const quietHoursStart =
    (typeof operational.quietHoursStart === "string" &&
        operational.quietHoursStart.trim()) ||
    (typeof organization.quietHoursStart === "string" &&
        organization.quietHoursStart.trim()) ||
    (typeof delivery?.quietHoursStart === "string" && delivery.quietHoursStart.trim()) ||
    "10:00 PM"

  const quietHoursEnd =
    (typeof operational.quietHoursEnd === "string" &&
        operational.quietHoursEnd.trim()) ||
    (typeof organization.quietHoursEnd === "string" &&
        organization.quietHoursEnd.trim()) ||
    (typeof delivery?.quietHoursEnd === "string" && delivery.quietHoursEnd.trim()) ||
    "8:00 AM"

  return {
    allowAiDispatch: typeof operational.allowAiDispatch === "boolean"
      ? operational.allowAiDispatch
      : typeof organization.allowAiDispatch === "boolean"
        ? organization.allowAiDispatch
        : true,
    requirePhotoEvidence: typeof operational.requirePhotoEvidence === "boolean"
      ? operational.requirePhotoEvidence
      : typeof organization.requirePhotoEvidence === "boolean"
        ? organization.requirePhotoEvidence
        : true,
    defaultResponseSla,
    escalationThreshold,
    rentReminderCadence,
    preferredLanguage,
    quietHoursEnabled: typeof operational.quietHoursEnabled === "boolean"
      ? operational.quietHoursEnabled
      : organization.quietHours !== false,
    quietHoursStart,
    quietHoursEnd,
    timeZone:
      typeof landlord?.time_zone === "string" && landlord.time_zone.trim()
        ? landlord.time_zone.trim()
        : "America/Los_Angeles",
  }
}

export async function loadLandlordNotificationSettings(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<EdgeNotificationSettings> {
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("notification_channel, account_settings")
    .eq("landlord_id", landlordId)
    .maybeSingle()

  const account = (onboarding?.account_settings ?? {}) as Record<string, unknown>
  const operational = (account.operational ?? {}) as Record<string, unknown>
  const stored = account.notifications as EdgeNotificationSettings | undefined
  const base = stored?.delivery
    ? {
      ...DEFAULT_SETTINGS,
      ...stored,
      delivery: { ...DEFAULT_SETTINGS.delivery, ...stored.delivery },
      categories: mergeNotificationMatrixCategories(stored.categories as MatrixCategory[] | undefined),
    }
    : DEFAULT_SETTINGS

  const quietHoursStart =
    (typeof operational.quietHoursStart === "string" && operational.quietHoursStart.trim()) ||
    base.delivery.quietHoursStart
  const quietHoursEnd =
    (typeof operational.quietHoursEnd === "string" && operational.quietHoursEnd.trim()) ||
    base.delivery.quietHoursEnd

  const channel = normalizeOpsAlertChannelPreference(onboarding?.notification_channel)
  const enabled = opsAlertChannelsEnabled(channel)
  const primary: EdgeNotificationChannel = enabled.sms && !enabled.email
    ? "sms"
    : enabled.email
      ? "email"
      : enabled.activityFeed
        ? "activity_feed"
        : base.delivery.primaryChannel

  return {
    ...base,
    delivery: {
      ...base.delivery,
      primaryChannel: primary,
      fallbackChannel: primary === "sms" ? "email" : "sms",
      quietHoursStart,
      quietHoursEnd,
    },
  }
}

function parseClockToMinutes(label: string): number | null {
  const trimmed = label.trim().toLowerCase()
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? "0")
  const meridiem = match[3]
  if (meridiem === "pm" && hours < 12) hours += 12
  if (meridiem === "am" && hours === 12) hours = 0
  return hours * 60 + minutes
}

export function isWithinQuietHours(input: {
  now: Date
  timeZone: string
  start: string
  end: string
}): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  })
  const parts = formatter.formatToParts(input.now)
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
  const current = hour * 60 + minute
  const start = parseClockToMinutes(input.start)
  const end = parseClockToMinutes(input.end)
  if (start == null || end == null) return false
  if (start === end) return false
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

const ATTENTION_EVENT_MAP: Record<string, { categoryId: string; eventId: string }> = {
  invoice_ready: { categoryId: "workflows", eventId: "needs_your_attention" },
  assign_vendor: { categoryId: "workflows", eventId: "vendor_unassigned" },
  workflow_escalated: { categoryId: "workflows", eventId: "workflow_escalated" },
  late_rent: { categoryId: "rent", eventId: "rent_escalated" },
  lease_renewal: { categoryId: "leasing", eventId: "lease_expiring" },
  lease_info_missing: { categoryId: "leasing", eventId: "lease_info_missing" },
  unknown_occupant: { categoryId: "workflows", eventId: "needs_your_attention" },
  external_vendor_replied: { categoryId: "workflows", eventId: "needs_your_attention" },
}

export function resolveLandlordNotificationDelivery(input: {
  settings: EdgeNotificationSettings
  attentionKind: string
  isCritical?: boolean
  now?: Date
  timeZone?: string
  quietHoursEnabled?: boolean
}): { allowed: boolean; channels: EdgeNotificationChannel[]; reason?: string } {
  const mapping = ATTENTION_EVENT_MAP[input.attentionKind] ?? ATTENTION_EVENT_MAP.invoice_ready
  const category = input.settings.categories.find((row) => row.id === mapping.categoryId)
  const event = category?.events.find((row) => row.id === mapping.eventId)
  const critical = input.isCritical === true || event?.critical === true

  if (event) {
    const any = Object.values(event.channels).some(Boolean)
    if (!any && !critical) return { allowed: false, channels: [], reason: "event_muted" }
  }

  const delivery = input.settings.delivery
  const channels: EdgeNotificationChannel[] = []
  const add = (channel: EdgeNotificationChannel) => {
    if (channel === "push") return
    if (event && event.channels[channel] === false) return
    if (!channels.includes(channel)) channels.push(channel)
  }

  if (event) {
    if (event.channels.email) add("email")
    if (event.channels.sms) add("sms")
    if (event.channels.activity_feed) add("activity_feed")
  } else {
    add(delivery.primaryChannel)
    if (delivery.autoFallback && delivery.fallbackChannel !== delivery.primaryChannel) {
      add(delivery.fallbackChannel)
    }
  }

  if (channels.length === 0 && critical) {
    if (!event || event.channels.email !== false) channels.push("email")
    if (!event || event.channels.sms !== false) channels.push("sms")
    if (!event || event.channels.activity_feed !== false) channels.push("activity_feed")
  }
  if (channels.length === 0) return { allowed: false, channels: [], reason: "no_channels" }

  if (
    input.quietHoursEnabled !== false &&
    input.timeZone &&
    isWithinQuietHours({
      now: input.now ?? new Date(),
      timeZone: input.timeZone,
      start: delivery.quietHoursStart,
      end: delivery.quietHoursEnd,
    }) &&
    !critical
  ) {
    return { allowed: false, channels: [], reason: "quiet_hours" }
  }

  return { allowed: true, channels }
}

export function defaultResponseSlaMinutes(slaLabel: string | null | undefined): number | null {
  const normalized = String(slaLabel ?? "").trim().toLowerCase()
  if (!normalized) return null
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h|minute|min|m|day|d)/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = match[2]
  if (unit.startsWith("h")) return Math.round(amount * 60)
  if (unit.startsWith("d")) return Math.round(amount * 24 * 60)
  return Math.round(amount)
}
