import { buildingDetailPath, propertyResidentDetailPath } from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'

export type UniversalSearchCategory =
  | 'property'
  | 'unit'
  | 'resident'
  | 'vendor'
  | 'work_order'
  | 'workflow'
  | 'conversation'
  | 'broadcast'
  | 'document'
  | 'inspection'
  | 'lease_renewal'
  | 'rent_collection'
  | 'report'

export type UniversalSearchItem = {
  id: string
  category: UniversalSearchCategory
  title: string
  subtitle: string
  href: string
  /** Lowercase haystack for matching (title + subtitle + extra tokens). */
  keywords: string
  /** Populated by `searchAdminIndex` when ranking. */
  matchScore?: number
}

export type RecentSearchKind = 'record' | 'ask'

export type RecentSearchItem = {
  title: string
  href?: string
  kind: RecentSearchKind
  query: string
}

export type GroupedSearchResults = {
  category: UniversalSearchCategory
  label: string
  items: UniversalSearchItem[]
}

export const CATEGORY_META: Record<
  UniversalSearchCategory,
  { label: string; symbol: string }
> = {
  property: { label: 'Properties', symbol: '🏢' },
  unit: { label: 'Units', symbol: '🚪' },
  resident: { label: 'Residents', symbol: '👤' },
  vendor: { label: 'Vendors', symbol: '🔧' },
  work_order: { label: 'Work Orders', symbol: '🛠' },
  workflow: { label: 'Workflows', symbol: '⚙️' },
  conversation: { label: 'Conversations', symbol: '💬' },
  broadcast: { label: 'Broadcasts', symbol: '📣' },
  document: { label: 'Documents', symbol: '📄' },
  inspection: { label: 'Inspections', symbol: '🔍' },
  lease_renewal: { label: 'Lease Renewals', symbol: '📝' },
  rent_collection: { label: 'Rent Collection', symbol: '💵' },
  report: { label: 'Reports', symbol: '📊' },
}

/** Suggested Ask Ulo prompts from the unified search product brief. */
export const SUGGESTED_ASK_ULO_PROMPTS: readonly string[] = [
  'Which work orders are overdue?',
  'Show vendor verification status.',
  'Which residents have unpaid rent?',
  'What should I focus on today?',
  'Which properties have critical maintenance?',
  'Show upcoming lease renewals.',
]

const RECENT_SEARCH_MAX = 8
const RECENT_SEARCH_PREFIX = 'ulo.admin.universalSearch.recent.'
const SEARCH_RESULT_CAP = 40

const CATEGORY_GROUP_ORDER: UniversalSearchCategory[] = [
  'property',
  'unit',
  'resident',
  'vendor',
  'work_order',
  'workflow',
  'conversation',
  'broadcast',
  'document',
  'inspection',
  'lease_renewal',
  'rent_collection',
  'report',
]

const WORKFLOW_TEMPLATE_LABELS: Record<string, string> = {
  maintenance_intake: 'Maintenance intake',
  maintenance_request: 'Maintenance request',
  lease_renewal: 'Lease renewal',
  rent_collection: 'Rent collection',
  move_in: 'Move in',
  move_out: 'Move out',
  inspection: 'Inspection',
  unit_inspection: 'Inspection',
  vendor_job_response: 'Vendor job response',
  identity_onboarding: 'Identity onboarding',
  landlord_command: 'Landlord command',
}

const STATIC_NAV_SHORTCUTS: UniversalSearchItem[] = [
  {
    id: 'nav-reports',
    category: 'report',
    title: 'Reports & Analytics',
    subtitle: 'Portfolio performance and operational metrics',
    href: '/admin/analytics',
    keywords: 'reports analytics dashboard metrics performance insights charts',
  },
  {
    id: 'nav-communication',
    category: 'conversation',
    title: 'Communication',
    subtitle: 'SMS inbox and resident or vendor threads',
    href: '/admin/communication',
    keywords: 'communication inbox messages sms threads conversations',
  },
]

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readMetaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function buildKeywords(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

function formatUnitLabel(raw: string | null | undefined): string {
  const unit = raw?.trim()
  if (!unit) return 'Unit'
  if (/^unit\b/i.test(unit)) return unit
  return `Unit ${unit}`
}

function formatWorkOrderTitle(row: Record<string, unknown>): string {
  const unit = asString(row.unit)
  const building = asString(row.building)
  const issue =
    asString(row.description) ||
    asString(row.issue) ||
    asString(row.issue_category) ||
    asString(row.title) ||
    'Work order'
  const location = unit
    ? formatUnitLabel(unit)
    : building || ''
  if (location) return `${location} – ${issue}`
  return issue
}

function formatWorkflowTemplateName(templateId: string): string {
  return WORKFLOW_TEMPLATE_LABELS[templateId] ?? templateId.replace(/_/g, ' ')
}

function resolveWorkflowCategory(templateId: string): UniversalSearchCategory {
  if (templateId === 'lease_renewal') return 'lease_renewal'
  if (templateId === 'rent_collection') return 'rent_collection'
  if (templateId === 'inspection' || templateId === 'unit_inspection') return 'inspection'
  return 'workflow'
}

function formatWorkflowSubtitle(input: {
  templateId: string
  status: string
  metadata: Record<string, unknown>
}): string {
  const template = formatWorkflowTemplateName(input.templateId)
  const status = input.status.replace(/_/g, ' ')
  const building =
    readMetaString(input.metadata, 'building') ||
    readMetaString(input.metadata, 'property_label') ||
    readMetaString(input.metadata, 'property_name')
  const unit =
    readMetaString(input.metadata, 'unit') ||
    readMetaString(input.metadata, 'unit_label')
  const location = [building, unit ? formatUnitLabel(unit) : null].filter(Boolean).join(' · ')
  if (location) return `${template} · ${status} · ${location}`
  return `${template} · ${status}`
}

function formatWorkflowTitle(input: {
  templateId: string
  metadata: Record<string, unknown>
}): string {
  const template = formatWorkflowTemplateName(input.templateId)
  const building =
    readMetaString(input.metadata, 'building') ||
    readMetaString(input.metadata, 'property_label') ||
    readMetaString(input.metadata, 'property_name')
  if (building) return `${template} – ${building}`
  return template
}

function isProperNameLikeQuery(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed.includes('?')) return false
  if (/^(who|what|which|how|why|when|where|show|list|find|tell me|give me)\b/i.test(trimmed)) {
    return false
  }
  if (/\b(overdue|trends?|attention|unpaid|critical|maintenance|workflow|vendor|resident|rent|lease)\b/i.test(trimmed)) {
    return false
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 3) return false

  const nameLike = words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))
  return nameLike
}

/** Normalize user input for matching. */
export function normalizeAdminSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Score a candidate against a query.
 * Higher is better: exact title (100) → title startsWith (80) → title includes (60) → keywords (40).
 */
export function scoreUniversalSearchMatch(
  item: Pick<UniversalSearchItem, 'title' | 'keywords'>,
  query: string,
): number {
  const normalized = normalizeAdminSearchQuery(query)
  if (!normalized) return 0

  const title = item.title.trim().toLowerCase()
  const keywords = item.keywords.trim().toLowerCase()

  if (title === normalized) return 100
  if (title.startsWith(normalized)) return 80
  if (title.includes(normalized)) return 60
  if (keywords.includes(normalized)) return 40

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length <= 1) return 0

  let tokenScore = 0
  for (const token of tokens) {
    if (token.length < 2) continue
    if (title === token) tokenScore = Math.max(tokenScore, 90)
    else if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 70)
    else if (title.includes(token)) tokenScore = Math.max(tokenScore, 50)
    else if (keywords.includes(token)) tokenScore = Math.max(tokenScore, 30)
  }
  return tokenScore
}

/** Detect natural-language Ask Ulo questions vs record navigation queries. */
export function looksLikeAskUloQuestion(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return false
  if (isProperNameLikeQuery(trimmed)) return false

  if (trimmed.includes('?')) return true

  const lower = trimmed.toLowerCase()

  if (/^(who|what|which|how|why|when|where)\b/.test(lower)) return true
  if (/\b(show me|show|list|find|summarize|compare|rank|explain|tell me|give me)\b/.test(lower)) {
    return true
  }
  if (
    /\b(overdue|trends?|attention|prioriti[sz]e|unpaid|critical|recurring|stuck|blocked|escalated|waiting|missing|upcoming|happening|focus on|need(?:s)? my attention)\b/.test(
      lower,
    )
  ) {
    return true
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 3 && /\b(are|is|have|has|need|needs|should|can|do|does|did|will|would|am|was|were)\b/i.test(trimmed)) {
    return true
  }

  return false
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), waitMs)
  }
}

function recentStorageKey(landlordId: string): string {
  return `${RECENT_SEARCH_PREFIX}${landlordId}`
}

function sanitizeRecentItem(raw: unknown): RecentSearchItem | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const title = asString(row.title)
  const query = asString(row.query)
  const kind = row.kind === 'ask' ? 'ask' : row.kind === 'record' ? 'record' : null
  if (!title || !query || !kind) return null
  const href = asString(row.href)
  return {
    title,
    query,
    kind,
    href: href || undefined,
  }
}

export function loadRecentSearches(landlordId: string): RecentSearchItem[] {
  if (typeof window === 'undefined' || !landlordId.trim()) return []
  try {
    const raw = window.localStorage.getItem(recentStorageKey(landlordId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeRecentItem)
      .filter((item): item is RecentSearchItem => item != null)
      .slice(0, RECENT_SEARCH_MAX)
  } catch {
    return []
  }
}

export function pushRecentSearch(landlordId: string, item: RecentSearchItem): void {
  if (typeof window === 'undefined' || !landlordId.trim()) return
  const title = item.title.trim()
  const query = item.query.trim()
  if (!title || !query) return

  const next: RecentSearchItem = {
    title,
    query,
    kind: item.kind,
    href: item.href?.trim() || undefined,
  }

  const existing = loadRecentSearches(landlordId).filter(
    (entry) => entry.query.toLowerCase() !== query.toLowerCase(),
  )
  const merged = [next, ...existing].slice(0, RECENT_SEARCH_MAX)

  try {
    window.localStorage.setItem(recentStorageKey(landlordId), JSON.stringify(merged))
  } catch {
    /* ignore quota / private mode */
  }
}

export function searchAdminIndex(
  items: UniversalSearchItem[],
  query: string,
): UniversalSearchItem[] {
  const normalized = normalizeAdminSearchQuery(query)
  if (!normalized) return []

  const ranked = items
    .map((item) => {
      const matchScore = scoreUniversalSearchMatch(item, normalized)
      return matchScore > 0 ? { ...item, matchScore } : null
    })
    .filter((item): item is UniversalSearchItem & { matchScore: number } => item != null)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
      return a.title.localeCompare(b.title)
    })

  return ranked.slice(0, SEARCH_RESULT_CAP)
}

export function groupSearchResults(items: UniversalSearchItem[]): GroupedSearchResults[] {
  const buckets = new Map<UniversalSearchCategory, UniversalSearchItem[]>()
  for (const item of items) {
    const list = buckets.get(item.category) ?? []
    list.push(item)
    buckets.set(item.category, list)
  }

  return CATEGORY_GROUP_ORDER.flatMap((category) => {
    const groupItems = buckets.get(category)
    if (!groupItems?.length) return []
    return [
      {
        category,
        label: CATEGORY_META[category].label,
        items: groupItems,
      },
    ]
  })
}

function mapUnitsToSearchItems(
  rows: Record<string, unknown>[],
): UniversalSearchItem[] {
  const items: UniversalSearchItem[] = []
  const buildings = new Set<string>()

  for (const row of rows) {
    const building = asString(row.building)
    const unitLabel = asString(row.unit_label)
    const unitId = asString(row.id)
    if (!building || !unitId) continue

    if (!buildings.has(building)) {
      buildings.add(building)
      items.push({
        id: `property:${building}`,
        category: 'property',
        title: building,
        subtitle: 'Property',
        href: buildingDetailPath(building),
        keywords: buildKeywords([building, 'property', 'building']),
      })
    }

    items.push({
      id: `unit:${unitId}`,
      category: 'unit',
      title: formatUnitLabel(unitLabel),
      subtitle: building,
      href: `${buildingDetailPath(building)}?tab=units&unit=${encodeURIComponent(unitLabel || unitId)}`,
      keywords: buildKeywords([unitLabel, building, 'unit']),
    })
  }

  return items
}

function mapResidentsToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const name = asString(row.full_name) || 'Unnamed resident'
    const building = asString(row.building) || null
    const unit = asString(row.unit)
    if (!id) return []

    const subtitle = [building, unit ? formatUnitLabel(unit) : null].filter(Boolean).join(' · ') || 'Resident'
    const href = building
      ? propertyResidentDetailPath(building, id)
      : '/admin/residents'

    return [
      {
        id: `resident:${id}`,
        category: 'resident',
        title: name,
        subtitle,
        href,
        keywords: buildKeywords([name, building, unit, 'resident', 'tenant']),
      },
    ]
  })
}

function mapVendorsToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const name = asString(row.name) || 'Vendor'
    const categoryLabel = asString(row.category)
    if (!id) return []

    return [
      {
        id: `vendor:${id}`,
        category: 'vendor',
        title: name,
        subtitle: categoryLabel || 'Vendor',
        href: `/admin/vendors/${encodeURIComponent(id)}`,
        keywords: buildKeywords([name, categoryLabel, 'vendor']),
      },
    ]
  })
}

function mapMaintenanceToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    if (!id) return []

    const title = formatWorkOrderTitle(row)
    const building = asString(row.building)
    const unit = asString(row.unit)
    const issueCategory = asString(row.issue_category)
    const subtitle = [building, unit ? formatUnitLabel(unit) : null, issueCategory]
      .filter(Boolean)
      .join(' · ') || 'Maintenance request'
    const q = title || id

    return [
      {
        id: `work-order:${id}`,
        category: 'work_order',
        title,
        subtitle,
        href: `/admin/requests?q=${encodeURIComponent(q)}`,
        keywords: buildKeywords([
          id,
          title,
          building,
          unit,
          issueCategory,
          asString(row.description),
          asString(row.issue),
          'work order',
          'maintenance',
          'request',
        ]),
      },
    ]
  })
}

function mapWorkflowRunsToSearchItems(rows: Record<string, unknown>[]): UniversalSearchItem[] {
  return rows.flatMap((row) => {
    const id = asString(row.id)
    const templateId = asString(row.template_id) || 'workflow'
    const status = asString(row.status) || 'active'
    const metadata = asRecord(row.metadata)
    if (!id) return []

    const category = resolveWorkflowCategory(templateId)
    const title = formatWorkflowTitle({ templateId, metadata })
    const subtitle = formatWorkflowSubtitle({ templateId, status, metadata })

    return [
      {
        id: `workflow:${id}`,
        category,
        title,
        subtitle,
        href: `/admin/workflows?run=${encodeURIComponent(id)}`,
        keywords: buildKeywords([
          id,
          title,
          subtitle,
          templateId,
          status,
          readMetaString(metadata, 'building'),
          readMetaString(metadata, 'unit'),
          readMetaString(metadata, 'resident_name'),
          'workflow',
        ]),
      },
    ]
  })
}

/** Load landlord-scoped records for the universal search index. */
export async function loadAdminSearchIndex(landlordId: string): Promise<UniversalSearchItem[]> {
  const items: UniversalSearchItem[] = [...STATIC_NAV_SHORTCUTS]

  if (!supabase || !landlordId.trim()) {
    return items
  }

  const [
    unitsResult,
    usersResult,
    vendorsResult,
    enrichedTicketsResult,
    workflowRunsResult,
  ] = await Promise.all([
    supabase
      .from('units')
      .select('id, unit_label, building')
      .eq('landlord_id', landlordId)
      .limit(500),
    supabase
      .from('users')
      .select('id, full_name, unit, building')
      .eq('landlord_id', landlordId)
      .neq('status', 'past_resident')
      .limit(500),
    supabase
      .from('vendors')
      .select('id, name, category')
      .eq('landlord_id', landlordId)
      .limit(200),
    supabase
      .from('maintenance_request_enriched')
      .select('id, building, unit, description, issue, issue_category')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('workflow_runs')
      .select('id, template_id, status, metadata')
      .eq('landlord_id', landlordId)
      .order('started_at', { ascending: false })
      .limit(100),
  ])

  if (!unitsResult.error) {
    items.push(...mapUnitsToSearchItems((unitsResult.data ?? []) as Record<string, unknown>[]))
  }

  if (!usersResult.error) {
    items.push(...mapResidentsToSearchItems((usersResult.data ?? []) as Record<string, unknown>[]))
  }

  if (!vendorsResult.error) {
    items.push(...mapVendorsToSearchItems((vendorsResult.data ?? []) as Record<string, unknown>[]))
  }

  let maintenanceRows: Record<string, unknown>[] = []
  if (!enrichedTicketsResult.error) {
    maintenanceRows = (enrichedTicketsResult.data ?? []) as Record<string, unknown>[]
  } else {
    const fallback = await supabase
      .from('maintenance_requests')
      .select('id, building, unit, description, issue, issue_category')
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (!fallback.error) {
      maintenanceRows = (fallback.data ?? []) as Record<string, unknown>[]
    }
  }
  items.push(...mapMaintenanceToSearchItems(maintenanceRows))

  if (!workflowRunsResult.error) {
    items.push(
      ...mapWorkflowRunsToSearchItems((workflowRunsResult.data ?? []) as Record<string, unknown>[]),
    )
  }

  return items
}
