import type { OrganizationSettingsForm } from '@/lib/organizationSettings'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  type LandlordWorkspaceSettings,
} from '@/lib/landlordSettings/types'

let cachedWorkspace: LandlordWorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS }
let cachedDisplayName = ''
let cachedAbout = ''

export function setLandlordWorkspaceCache(input: {
  organization: Pick<
    OrganizationSettingsForm,
    | 'displayName'
    | 'legalName'
    | 'about'
    | 'currency'
    | 'dateFormat'
    | 'brandAccent'
    | 'timeZone'
    | 'logoUrl'
  >
}): void {
  cachedWorkspace = {
    timeZone: input.organization.timeZone || DEFAULT_WORKSPACE_SETTINGS.timeZone,
    currency: input.organization.currency || DEFAULT_WORKSPACE_SETTINGS.currency,
    dateFormat: input.organization.dateFormat || DEFAULT_WORKSPACE_SETTINGS.dateFormat,
    brandAccent: input.organization.brandAccent || DEFAULT_WORKSPACE_SETTINGS.brandAccent,
    logoUrl: input.organization.logoUrl?.trim() || '',
  }
  cachedDisplayName = resolveLandlordDisplayName(input.organization)
  cachedAbout = input.organization.about.trim()
}

export function getLandlordWorkspaceSettings(): LandlordWorkspaceSettings {
  return cachedWorkspace
}

export function getLandlordDisplayName(): string {
  return cachedDisplayName
}

export function getLandlordAbout(): string {
  return cachedAbout
}

export function getLandlordLogoUrl(): string {
  return cachedWorkspace.logoUrl?.trim() || ''
}

export function resolveLandlordDisplayName(
  organization: Pick<OrganizationSettingsForm, 'displayName' | 'legalName'>,
): string {
  const display = organization.displayName.trim()
  if (display) return display
  const legal = organization.legalName.trim()
  if (legal) return legal
  return ''
}

export function landlordBrandAccentCssProperties(
  accent: string = cachedWorkspace.brandAccent,
): Record<string, string> {
  const color = accent.trim() || DEFAULT_WORKSPACE_SETTINGS.brandAccent
  return {
    '--ulo-brand-accent': color,
  }
}

function parseLandlordDate(value: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const raw = value.trim()
  if (!raw) return null
  const normalized = raw.includes('T') ? raw : `${raw.slice(0, 10)}T12:00:00`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function datePartsInTimeZone(date: Date, timeZone: string): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return {
    y: parts.find((part) => part.type === 'year')?.value ?? '',
    m: parts.find((part) => part.type === 'month')?.value ?? '',
    d: parts.find((part) => part.type === 'day')?.value ?? '',
  }
}

export function formatLandlordDate(
  value: string | Date | null | undefined,
  settings: Pick<LandlordWorkspaceSettings, 'dateFormat' | 'timeZone'> = cachedWorkspace,
): string {
  if (value == null) return '—'
  const date = parseLandlordDate(value)
  if (!date) return typeof value === 'string' ? value : '—'

  const { y, m, d } = datePartsInTimeZone(date, settings.timeZone || DEFAULT_WORKSPACE_SETTINGS.timeZone)
  if (!y || !m || !d) return typeof value === 'string' ? value : '—'

  switch (settings.dateFormat) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`
    default:
      return `${m}/${d}/${y}`
  }
}

export function formatLandlordCurrency(
  amount: number | null | undefined,
  settings: Pick<LandlordWorkspaceSettings, 'currency'> = cachedWorkspace,
): string {
  if (amount == null || !Number.isFinite(amount)) return '—'
  const currency = settings.currency?.trim() || DEFAULT_WORKSPACE_SETTINGS.currency
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: DEFAULT_WORKSPACE_SETTINGS.currency,
      maximumFractionDigits: 2,
    }).format(amount)
  }
}
