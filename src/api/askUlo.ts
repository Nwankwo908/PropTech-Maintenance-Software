/**
 * POST ask-ulo (ADMIN_REASSIGN_SECRET via x-admin-reassign-secret).
 * Uses supabase.functions.invoke so the call always targets VITE_SUPABASE_URL.
 */

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type AskUloCitation = {
  tool: 'legal_rag' | 'ops_graph' | 'structured' | 'market_data'
  title: string
  citation?: string
  url?: string
  excerpt?: string
  sourceTier?: 'primary_official' | 'agency_guidance' | 'discovery_mirror' | 'untrusted'
}

export type AskUloMarketCompVisual = {
  address: string
  rent: number | null
  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  distanceMiles: number | null
  source: string
  listingUrl: string | null
}

export type AskUloHistoryChartPoint = {
  date: string
  value: number
}

export type AskUloVisualContext =
  | {
      kind: 'market_analysis' | 'comparable_rentals'
      buildingName: string | null
      address: string | null
      cityLabel: string | null
      stateCode: string | null
      lat: number | null
      lng: number | null
      comps: AskUloMarketCompVisual[]
      showStreetView?: boolean
    }
  | {
      kind: 'price_history' | 'rent_history'
      buildingName: string | null
      title: string
      changeLabel: string | null
      valueKind: 'value' | 'rent'
      series: AskUloHistoryChartPoint[]
    }

export type AskUloHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AskUloCounselExpertRoleId =
  | 'company_attorney'
  | 'landlord_tenant_lawyer'
  | 'compliance_specialist'
  | 'regional_property_manager'

export type AskUloCounselExpert = {
  id: AskUloCounselExpertRoleId
  label: string
  shortLabel: string
  description: string
  whenToUse: string
}

export type AskUloAnswerConfidence = 'high' | 'medium' | 'low' | 'escalate'

export type AskUloSourceUsedItem = {
  label: string
  priority: number | null
  family: string
  kind: 'requirement' | 'guidance' | 'portfolio' | 'market' | 'reference'
  checked: true
}

export type AskUloQualityCheck = {
  id: string
  step: number | null
  label: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  summary: string
}

export type AskUloLegalAudit = {
  gateStatus: 'ok' | 'clarify' | 'refuse' | null
  sensitiveTopics: Array<{ id: string; label: string }>
  requireCounsel: boolean
  counselNote: string | null
  officialSourceCount: number
  primaryOfficialCount: number
  agencyGuidanceCount: number
  discoveryMirrorCount: number
  pendingOrdinanceCount: number
  recommendedExpertId: AskUloCounselExpertRoleId
  handoffExperts: AskUloCounselExpert[]
  /** Buildings to pick when Ulo asks which property. */
  propertyClarifyOptions: string[]
  answerConfidence: AskUloAnswerConfidence
  answerConfidenceLabel: string
  sourcesUsed: AskUloSourceUsedItem[]
  /** Five-check quality gate before the answer is shown. */
  qualityChecks: AskUloQualityCheck[]
}

export type AskUloSafetyBoundary = {
  blocked: true
  kind?: 'action_boundary' | 'fair_housing'
  actions: Array<{ id: string; label: string }>
  fairHousingFlags?: Array<{ id: string; label: string }>
}

export type AskUloJurisdiction = {
  countryCode: string
  stateCode: string | null
  countySlug: string | null
  countyLabel: string | null
  citySlug: string | null
  cityLabel: string | null
  courtSystem: string | null
  housingProgram: string | null
  codeSet: string | null
}

export type AskUloOk = {
  answer: string
  citations: AskUloCitation[]
  toolsUsed: string[]
  mode: 'openai' | 'fallback'
  model: string | null
  intent?: string
  agentMode?: string | null
  /** Continuous-eval row for feedback / metrics. */
  evalId?: string | null
  jurisdiction?: AskUloJurisdiction
  visualContext?: AskUloVisualContext | null
  legalAudit?: AskUloLegalAudit | null
  safetyBoundary?: AskUloSafetyBoundary | null
}

export function resolveAskUloUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/ask-ulo`
  return null
}

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

function expectedAskUloHost(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()
  if (!base) return null
  try {
    return new URL(base).hostname
  } catch {
    return null
  }
}

type InvokeAskUloResult = {
  data: unknown
  status: number | null
}

/**
 * Invoke ask-ulo via the shared Supabase client (same project as VITE_SUPABASE_URL).
 * Distinguishes CORS/network, HTTP, auth, and invalid-body failures in logs + thrown errors.
 */
async function invokeAskUlo(payload: Record<string, unknown>): Promise<InvokeAskUloResult> {
  const secret = adminSecret()
  const host = expectedAskUloHost()
  if (!supabase) {
    console.error('[ask-ulo] missing Supabase client — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
    throw new Error('Ask Ulo: Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  if (!secret) {
    console.error('[ask-ulo] missing VITE_ADMIN_REASSIGN_SECRET')
    throw new Error('Ask Ulo: missing admin secret configuration')
  }

  if (import.meta.env.DEV && host && host !== 'mzpqwuizhiaczxcnmxbt.supabase.co') {
    console.warn(
      '[ask-ulo] VITE_SUPABASE_URL host differs from mzpqwuizhiaczxcnmxbt.supabase.co',
      { host },
    )
  }

  try {
    const { data, error } = await supabase.functions.invoke('ask-ulo', {
      body: payload,
      headers: {
        'x-admin-reassign-secret': secret,
      },
    })

    if (error) {
      if (error instanceof FunctionsFetchError) {
        console.error('[ask-ulo] CORS/preflight or network failure', {
          message: error.message,
          host,
          url: resolveAskUloUrl(),
        })
        throw new Error(
          `Ask Ulo network/CORS failure${host ? ` (${host})` : ''}: ${error.message}. Check DevTools → Network for a failed OPTIONS on ask-ulo.`,
        )
      }
      if (error instanceof FunctionsRelayError) {
        console.error('[ask-ulo] relay failure', { message: error.message, host })
        throw new Error(`Ask Ulo relay failure: ${error.message}`)
      }

      let status: number | null = null
      let bodyText = ''
      let bodyJson: unknown = null
      if (error instanceof FunctionsHttpError) {
        const ctx = error.context as Response | undefined
        status = ctx?.status ?? null
        try {
          bodyText = ctx ? await ctx.text() : ''
          bodyJson = bodyText ? JSON.parse(bodyText) : null
        } catch {
          bodyJson = null
        }
      }

      if (status === 401 || status === 403) {
        console.error('[ask-ulo] authentication failure', {
          status,
          body: bodyJson ?? bodyText,
          host,
        })
        const msg =
          bodyJson && typeof bodyJson === 'object' && typeof (bodyJson as { error?: unknown }).error === 'string'
            ? (bodyJson as { error: string }).error
            : 'Unauthorized'
        throw new Error(`Ask Ulo authentication failed (${status}): ${msg}`)
      }

      console.error('[ask-ulo] function HTTP error', {
        status,
        message: error.message,
        body: bodyJson ?? bodyText,
        host,
      })
      const msg =
        bodyJson && typeof bodyJson === 'object' && typeof (bodyJson as { error?: unknown }).error === 'string'
          ? (bodyJson as { error: string }).error
          : error.message || `Ask Ulo failed (${status ?? 'unknown'})`
      throw new Error(msg)
    }

    if (data == null || typeof data !== 'object') {
      console.error('[ask-ulo] invalid response body', { data, host })
      throw new Error('Ask Ulo: invalid response body')
    }

    return { data, status: 200 }
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message.startsWith('Ask Ulo') || e.message.includes('authentication failed'))
    ) {
      throw e
    }
    if (e instanceof TypeError) {
      console.error('[ask-ulo] CORS/preflight or network failure (TypeError)', {
        message: e.message,
        host,
        url: resolveAskUloUrl(),
      })
      throw new Error(
        `Ask Ulo network/CORS failure${host ? ` (${host})` : ''}: ${e.message}. Check DevTools → Network for a failed OPTIONS on ask-ulo.`,
      )
    }
    console.error('[ask-ulo] unexpected invoke failure', e)
    throw e instanceof Error ? e : new Error('Ask Ulo failed')
  }
}

function parseAskUloOk(body: unknown): AskUloOk {
  if (!body || typeof body !== 'object') {
    console.error('[ask-ulo] invalid response body', { body })
    throw new Error('Ask Ulo: invalid response body')
  }
  const ok = body as AskUloOk
  if (typeof ok.answer !== 'string') {
    console.error('[ask-ulo] invalid response body — missing answer', { body })
    throw new Error('Ask Ulo: response missing answer')
  }
  return {
    answer: ok.answer,
    citations: Array.isArray(ok.citations)
      ? ok.citations
          .filter((c): c is AskUloCitation => Boolean(c && typeof c === 'object'))
          .map((c) => {
            const row = c as AskUloCitation
            const tier = row.sourceTier
            return {
              ...row,
              sourceTier:
                tier === 'primary_official' ||
                tier === 'agency_guidance' ||
                tier === 'discovery_mirror' ||
                tier === 'untrusted'
                  ? tier
                  : undefined,
            }
          })
      : [],
    toolsUsed: Array.isArray(ok.toolsUsed) ? ok.toolsUsed : [],
    mode: ok.mode === 'openai' ? 'openai' : 'fallback',
    model: typeof ok.model === 'string' ? ok.model : null,
    intent: typeof ok.intent === 'string' ? ok.intent : undefined,
    agentMode: typeof ok.agentMode === 'string' ? ok.agentMode : null,
    evalId: typeof ok.evalId === 'string' ? ok.evalId : null,
    jurisdiction: parseJurisdiction(ok.jurisdiction),
    visualContext: parseVisualContext(ok.visualContext),
    legalAudit: parseLegalAudit(ok.legalAudit),
    safetyBoundary: parseSafetyBoundary(ok.safetyBoundary),
  }
}

export async function postAskUlo(input: {
  question: string
  landlordId?: string | null
  /** Prior turns in this conversation (excludes the current question). */
  history?: AskUloHistoryMessage[]
  conversationId?: string | null
  /** UI agent mode chip (biases retrieval intent). */
  agentMode?: string | null
}): Promise<AskUloOk> {
  const question = input.question.trim()
  if (!question) {
    throw new Error('Ask Ulo: question is required')
  }

  const history = (input.history ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))

  const { data } = await invokeAskUlo({
    question,
    landlordId: input.landlordId?.trim() || getActiveLandlordId(),
    messages: history,
    conversationId: input.conversationId?.trim() || null,
    agentMode: input.agentMode?.trim() || null,
  })

  return parseAskUloOk(data)
}

function parseJurisdiction(raw: unknown): AskUloJurisdiction | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const j = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    countryCode: typeof j.countryCode === 'string' && j.countryCode ? j.countryCode : 'US',
    stateCode: str(j.stateCode),
    countySlug: str(j.countySlug),
    countyLabel: str(j.countyLabel),
    citySlug: str(j.citySlug),
    cityLabel: str(j.cityLabel),
    courtSystem: str(j.courtSystem),
    housingProgram: str(j.housingProgram),
    codeSet: str(j.codeSet),
  }
}

function parseSafetyBoundary(raw: unknown): AskUloSafetyBoundary | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.blocked !== true) return null
  const actionsRaw = Array.isArray(s.actions) ? s.actions : []
  const actions: Array<{ id: string; label: string }> = []
  for (const item of actionsRaw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const id = typeof a.id === 'string' ? a.id : ''
    const label = typeof a.label === 'string' ? a.label : ''
    if (!id || !label) continue
    actions.push({ id, label })
  }
  const kind =
    s.kind === 'fair_housing' || s.kind === 'action_boundary' ? s.kind : undefined
  const flagsRaw = Array.isArray(s.fairHousingFlags) ? s.fairHousingFlags : []
  const fairHousingFlags: Array<{ id: string; label: string }> = []
  for (const item of flagsRaw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const id = typeof a.id === 'string' ? a.id : ''
    const label = typeof a.label === 'string' ? a.label : ''
    if (!id || !label) continue
    fairHousingFlags.push({ id, label })
  }
  return {
    blocked: true,
    ...(kind ? { kind } : {}),
    actions,
    ...(fairHousingFlags.length > 0 ? { fairHousingFlags } : {}),
  }
}

function parseExpertRoleId(raw: unknown): AskUloCounselExpertRoleId {
  if (
    raw === 'company_attorney' ||
    raw === 'landlord_tenant_lawyer' ||
    raw === 'compliance_specialist' ||
    raw === 'regional_property_manager'
  ) {
    return raw
  }
  return 'regional_property_manager'
}

const DEFAULT_HANDOFF_EXPERTS: AskUloCounselExpert[] = [
  {
    id: 'company_attorney',
    label: "Your company's attorney",
    shortLabel: 'Company counsel',
    description: 'In-house or retained counsel who already knows your portfolio and policies.',
    whenToUse: 'Policy decisions, notices your company will stand behind, multi-property risk.',
  },
  {
    id: 'landlord_tenant_lawyer',
    label: 'Outside landlord-tenant lawyer',
    shortLabel: 'L-T lawyer',
    description: 'Independent counsel focused on residential landlord-tenant and housing law.',
    whenToUse: 'Evictions, discrimination complaints, contested notices, high-stakes filings.',
  },
  {
    id: 'compliance_specialist',
    label: 'Compliance specialist',
    shortLabel: 'Compliance',
    description: 'Fair housing, lead/environmental, screening, or program-compliance specialist.',
    whenToUse: 'Lead disclosures, FHA/HUD program rules, screening criteria audits.',
  },
  {
    id: 'regional_property_manager',
    label: 'Experienced regional property manager',
    shortLabel: 'Regional PM',
    description: 'Seasoned local operator who knows how rules play out in practice in your market.',
    whenToUse: 'Operational judgment, local custom, when counsel is not yet required.',
  },
]

function parseHandoffExperts(raw: unknown): AskUloCounselExpert[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_HANDOFF_EXPERTS
  const out: AskUloCounselExpert[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = parseExpertRoleId(r.id)
    const label = typeof r.label === 'string' ? r.label : ''
    if (!label) continue
    out.push({
      id,
      label,
      shortLabel: typeof r.shortLabel === 'string' ? r.shortLabel : label,
      description: typeof r.description === 'string' ? r.description : '',
      whenToUse: typeof r.whenToUse === 'string' ? r.whenToUse : '',
    })
  }
  return out.length > 0 ? out : DEFAULT_HANDOFF_EXPERTS
}

function parseLegalAudit(raw: unknown): AskUloLegalAudit | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const gate =
    a.gateStatus === 'ok' || a.gateStatus === 'clarify' || a.gateStatus === 'refuse'
      ? a.gateStatus
      : null
  const topicsRaw = Array.isArray(a.sensitiveTopics) ? a.sensitiveTopics : []
  const sensitiveTopics: Array<{ id: string; label: string }> = []
  for (const item of topicsRaw) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    const id = typeof t.id === 'string' ? t.id : ''
    const label = typeof t.label === 'string' ? t.label : ''
    if (!id || !label) continue
    sensitiveTopics.push({ id, label })
  }
  return {
    gateStatus: gate,
    sensitiveTopics,
    requireCounsel: Boolean(a.requireCounsel),
    counselNote: typeof a.counselNote === 'string' ? a.counselNote : null,
    officialSourceCount:
      typeof a.officialSourceCount === 'number' ? a.officialSourceCount : 0,
    primaryOfficialCount:
      typeof a.primaryOfficialCount === 'number' ? a.primaryOfficialCount : 0,
    agencyGuidanceCount:
      typeof a.agencyGuidanceCount === 'number' ? a.agencyGuidanceCount : 0,
    discoveryMirrorCount:
      typeof a.discoveryMirrorCount === 'number' ? a.discoveryMirrorCount : 0,
    pendingOrdinanceCount:
      typeof a.pendingOrdinanceCount === 'number' ? a.pendingOrdinanceCount : 0,
    recommendedExpertId: parseExpertRoleId(a.recommendedExpertId),
    handoffExperts: parseHandoffExperts(a.handoffExperts),
    propertyClarifyOptions: Array.isArray(a.propertyClarifyOptions)
      ? a.propertyClarifyOptions
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 12)
      : [],
    answerConfidence: parseAnswerConfidence(a.answerConfidence),
    answerConfidenceLabel:
      typeof a.answerConfidenceLabel === 'string' && a.answerConfidenceLabel.trim()
        ? a.answerConfidenceLabel.trim()
        : defaultConfidenceLabel(parseAnswerConfidence(a.answerConfidence)),
    sourcesUsed: parseSourcesUsed(a.sourcesUsed),
    qualityChecks: parseQualityChecks(a.qualityChecks),
  }
}

function parseQualityChecks(raw: unknown): AskUloQualityCheck[] {
  if (!Array.isArray(raw)) return []
  const out: AskUloQualityCheck[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const id = typeof c.id === 'string' ? c.id : ''
    const label = typeof c.label === 'string' ? c.label : ''
    const status =
      c.status === 'pass' ||
      c.status === 'fail' ||
      c.status === 'warn' ||
      c.status === 'skip'
        ? c.status
        : null
    if (!id || !label || !status) continue
    out.push({
      id,
      step: typeof c.step === 'number' ? c.step : null,
      label,
      status,
      summary: typeof c.summary === 'string' ? c.summary : '',
    })
  }
  return out
}

function parseAnswerConfidence(raw: unknown): AskUloAnswerConfidence {
  if (raw === 'high' || raw === 'medium' || raw === 'low' || raw === 'escalate') {
    return raw
  }
  return 'medium'
}

function defaultConfidenceLabel(c: AskUloAnswerConfidence): string {
  switch (c) {
    case 'high':
      return 'High — official laws and regulations found'
    case 'medium':
      return 'Medium — official guidance available'
    case 'low':
      return 'Low — limited authoritative information'
    case 'escalate':
      return 'Escalate — human legal or compliance review recommended'
  }
}

function parseSourcesUsed(raw: unknown): AskUloSourceUsedItem[] {
  if (!Array.isArray(raw)) return []
  const out: AskUloSourceUsedItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const label = typeof s.label === 'string' ? s.label.trim() : ''
    if (!label) continue
    const kind =
      s.kind === 'requirement' ||
      s.kind === 'guidance' ||
      s.kind === 'portfolio' ||
      s.kind === 'market' ||
      s.kind === 'reference'
        ? s.kind
        : 'reference'
    out.push({
      label: label.slice(0, 160),
      priority: typeof s.priority === 'number' ? s.priority : null,
      family: typeof s.family === 'string' ? s.family : 'gov_faqs_guides',
      kind,
      checked: true,
    })
  }
  return out.slice(0, 12)
}

export type AskUloCounselHandoffOk = {
  ok: true
  eventId: string | null
  expertRole: AskUloCounselExpertRoleId
  expertLabel: string
  confirmationMarkdown: string
}

export type AskUloOverrideReason =
  | 'wrong_location'
  | 'bad_citation'
  | 'unsupported_claim'
  | 'should_have_escalated'
  | 'outdated'
  | 'unhelpful'
  | 'other'

export const ASK_ULO_OVERRIDE_REASON_OPTIONS: Array<{
  id: AskUloOverrideReason
  label: string
}> = [
  { id: 'wrong_location', label: 'Wrong city/state' },
  { id: 'bad_citation', label: 'Wrong or weak source' },
  { id: 'unsupported_claim', label: 'Not backed by evidence' },
  { id: 'should_have_escalated', label: 'Should have asked a human' },
  { id: 'outdated', label: 'Out of date' },
  { id: 'unhelpful', label: 'Not helpful' },
  { id: 'other', label: 'Other' },
]

export async function postAskUloFeedback(input: {
  evalId: string
  rating: 'up' | 'down'
  landlordId?: string | null
  overrideReason?: AskUloOverrideReason | null
  note?: string | null
  conversationId?: string | null
  messageId?: string | null
}): Promise<{ ok: true; evalId: string }> {
  const evalId = input.evalId.trim()
  if (!evalId) throw new Error('Ask Ulo feedback: evalId is required')

  const { data } = await invokeAskUlo({
    action: 'feedback',
    evalId,
    rating: input.rating,
    landlordId: input.landlordId?.trim() || getActiveLandlordId(),
    overrideReason: input.overrideReason ?? null,
    note: input.note?.trim()?.slice(0, 500) || null,
    conversationId: input.conversationId?.trim() || null,
    messageId: input.messageId?.trim() || null,
  })

  if (!data || typeof data !== 'object') {
    console.error('[ask-ulo] feedback invalid response body', { data })
    throw new Error('Ask Ulo feedback: invalid response body')
  }
  const ok = data as Record<string, unknown>
  if (ok.ok !== true) throw new Error('Ask Ulo feedback: unexpected response')
  return {
    ok: true,
    evalId: typeof ok.evalId === 'string' ? ok.evalId : evalId,
  }
}

export async function postAskUloCounselHandoff(input: {
  expertRole: AskUloCounselExpertRoleId
  landlordId?: string | null
  conversationId?: string | null
  messageId?: string | null
  evalId?: string | null
  question?: string | null
  answerExcerpt?: string | null
  sensitiveTopicIds?: string[]
  note?: string | null
  stateCode?: string | null
  cityLabel?: string | null
}): Promise<AskUloCounselHandoffOk> {
  const { data } = await invokeAskUlo({
    action: 'counsel_handoff',
    expertRole: input.expertRole,
    landlordId: input.landlordId?.trim() || getActiveLandlordId(),
    conversationId: input.conversationId?.trim() || null,
    messageId: input.messageId?.trim() || null,
    evalId: input.evalId?.trim() || null,
    question: input.question?.trim()?.slice(0, 500) || null,
    answerExcerpt: input.answerExcerpt?.trim()?.slice(0, 800) || null,
    sensitiveTopicIds: input.sensitiveTopicIds ?? [],
    note: input.note?.trim()?.slice(0, 500) || null,
    stateCode: input.stateCode ?? null,
    cityLabel: input.cityLabel ?? null,
  })

  if (!data || typeof data !== 'object') {
    console.error('[ask-ulo] handoff invalid response body', { data })
    throw new Error('Ask Ulo handoff: invalid response body')
  }

  const ok = data as Record<string, unknown>
  if (ok.ok !== true) {
    throw new Error('Ask Ulo handoff: unexpected response')
  }
  return {
    ok: true,
    eventId: typeof ok.eventId === 'string' ? ok.eventId : null,
    expertRole: parseExpertRoleId(ok.expertRole),
    expertLabel: typeof ok.expertLabel === 'string' ? ok.expertLabel : 'Human expert',
    confirmationMarkdown:
      typeof ok.confirmationMarkdown === 'string'
        ? ok.confirmationMarkdown
        : `Flagged for ${typeof ok.expertLabel === 'string' ? ok.expertLabel : 'human review'}.`,
  }
}

function parseHistorySeries(raw: unknown): AskUloHistoryChartPoint[] {
  if (!Array.isArray(raw)) return []
  const out: AskUloHistoryChartPoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const date = typeof p.date === 'string' ? p.date.trim() : ''
    const value = typeof p.value === 'number' ? p.value : Number(p.value)
    if (!date || !Number.isFinite(value)) continue
    out.push({ date, value })
  }
  return out
}

function parseVisualContext(raw: unknown): AskUloVisualContext | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>

  if (v.kind === 'price_history' || v.kind === 'rent_history') {
    const series = parseHistorySeries(v.series)
    if (series.length < 2) return null
    return {
      kind: v.kind,
      buildingName: typeof v.buildingName === 'string' ? v.buildingName : null,
      title:
        typeof v.title === 'string' && v.title.trim()
          ? v.title
          : v.kind === 'rent_history'
            ? 'Typical rent history'
            : 'Estimated value history',
      changeLabel: typeof v.changeLabel === 'string' ? v.changeLabel : null,
      valueKind: v.valueKind === 'rent' ? 'rent' : 'value',
      series,
    }
  }

  if (v.kind !== 'market_analysis' && v.kind !== 'comparable_rentals') return null
  const compsRaw = Array.isArray(v.comps) ? v.comps : []
  const comps: AskUloMarketCompVisual[] = []
  for (const item of compsRaw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const address = typeof c.address === 'string' ? c.address.trim() : ''
    if (!address) continue
    comps.push({
      address,
      rent: typeof c.rent === 'number' ? c.rent : null,
      bedrooms: typeof c.bedrooms === 'number' ? c.bedrooms : null,
      bathrooms: typeof c.bathrooms === 'number' ? c.bathrooms : null,
      squareFootage: typeof c.squareFootage === 'number' ? c.squareFootage : null,
      distanceMiles: typeof c.distanceMiles === 'number' ? c.distanceMiles : null,
      source: typeof c.source === 'string' && c.source.trim() ? c.source : 'Listing',
      listingUrl: typeof c.listingUrl === 'string' && c.listingUrl.trim() ? c.listingUrl : null,
    })
  }
  const kind = v.kind as 'market_analysis' | 'comparable_rentals'
  return {
    kind,
    buildingName: typeof v.buildingName === 'string' ? v.buildingName : null,
    address: typeof v.address === 'string' ? v.address : null,
    cityLabel: typeof v.cityLabel === 'string' ? v.cityLabel : null,
    stateCode: typeof v.stateCode === 'string' ? v.stateCode : null,
    lat: typeof v.lat === 'number' ? v.lat : null,
    lng: typeof v.lng === 'number' ? v.lng : null,
    comps,
    showStreetView:
      typeof v.showStreetView === 'boolean'
        ? v.showStreetView
        : kind === 'market_analysis',
  }
}
