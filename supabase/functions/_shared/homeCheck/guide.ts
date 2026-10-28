import {
  type HomeCheckRole,
  parseHomeCheckGuideStart,
} from '../../../../shared/homeCheck.ts'
import {
  formatLocationWithOptionalUnit,
  shouldOmitUnitReference,
} from '../../../../shared/properties/unitLabelDisplay.ts'
import { accessInstructionKind } from '../sms/inboundInterpretation.ts'
import { isAffirmativeReply } from '../sms/residentIntakeTypes.ts'
import { parseAvailabilityResolved } from '../vendor_availability_parse.ts'

export const HOME_CHECK_GUIDE_TTL_MS = 24 * 60 * 60 * 1000
export const HOME_CHECK_TENANT_REMIND_MS = 24 * 60 * 60 * 1000
export const HOME_CHECK_TENANT_HANDOFF_MS = 48 * 60 * 60 * 1000

export type HomeCheckGuideStep =
  | 'pick_property'
  | 'confirm_place'
  | 'pick_unit'
  | 'pick_who'
  | 'pick_contractor'
  | 'pick_window'
  | 'awaiting_tenant'
  | 'awaiting_landlord'

export type HomeCheckGuideState = {
  step: HomeCheckGuideStep
  updatedAt: string
  promptedAt?: string
  remindedAt?: string | null
  role: HomeCheckRole | null
  propertyId?: string
  unitId?: string | null
  placeLabel?: string
  unitLabel?: string | null
  vendorId?: string
  vendorName?: string
  windowLabel?: string
  windowEnd?: string
  checkId?: string | null
  tenantName?: string
  tenantPhone?: string | null
  tenantConversationId?: string | null
  handoffReason?: 'silent' | 'opted_out'
  propertyChoices?: string[]
  unitChoices?: string[]
}

export type HomeCheckGuideProperty = {
  id: string
  label: string
  name?: string | null
  propertyType: string | null
  units: Array<{ id: string; label: string }>
}

export type HomeCheckGuideVendor = {
  id: string
  name: string
  distanceKm: number | null
}

export type HomeCheckGuideTenant = {
  name: string
  phone: string | null
  optedOut: boolean
}

export type HomeCheckGuideCatalog = {
  properties: HomeCheckGuideProperty[]
  vendors: HomeCheckGuideVendor[]
  tenant: HomeCheckGuideTenant | null
  companyName?: string | null
  timeZone?: string | null
}

export type HomeCheckGuideEffect =
  | { type: 'start_tenant'; propertyId: string; unitId: string }
  | { type: 'start_self'; propertyId: string; unitId: string | null }
  | { type: 'text_tenant'; phone: string; body: string }
  | {
    type: 'send_contractor'
    propertyId: string
    unitId: string | null
    vendorId: string
    windowEnd: string
    windowLabel: string
    /** Sent only to the tenant. Never includes the contractor link. */
    tenantBody: string | null
    tenantPhone: string | null
    /** Sent only to the landlord when the tenant was the sender. Never includes the link. */
    landlordBody: string | null
  }
  | { type: 'cancel'; checkId: string | null }

export type HomeCheckGuideTurn = {
  state: HomeCheckGuideState | null
  replies: string[]
  effects: HomeCheckGuideEffect[]
}

const TENANT_ASK =
  'Your landlord scheduled a quick equipment check (water heater and furnace, about 15 min). What times work this week? Will you be home, or can they enter without you?'

function companyLine(catalog: HomeCheckGuideCatalog): string {
  const name = catalog.companyName?.trim()
  return name
    ? `This is the property management team at ${name}.`
    : 'This is the property management team.'
}

export function homeCheckTenantAsk(catalog: HomeCheckGuideCatalog): string {
  return `Hi,\n\n${companyLine(catalog)}\n\n${TENANT_ASK}`
}

export function homeCheckGuideExpired(
  state: HomeCheckGuideState | null,
  now: Date,
): boolean {
  if (!state) return false
  if (state.step === 'awaiting_tenant' || state.step === 'awaiting_landlord') return false
  const at = Date.parse(state.updatedAt)
  return Number.isFinite(at) && now.getTime() - at >= HOME_CHECK_GUIDE_TTL_MS
}

export function readHomeCheckGuide(intake: unknown): HomeCheckGuideState | null {
  if (!intake || typeof intake !== 'object') return null
  const raw = (intake as { home_check_guide?: unknown }).home_check_guide
  if (!raw || typeof raw !== 'object') return null
  const step = (raw as { step?: unknown }).step
  if (typeof step !== 'string') return null
  return raw as HomeCheckGuideState
}

function isNo(body: string): boolean {
  return /^(no|nope|n)$/i.test(body.trim())
}

function isCancel(body: string): boolean {
  return /^cancel\b/i.test(body.trim())
}

function choiceIndex(body: string): number | null {
  const match = body.trim().match(/^(\d{1,2})$/)
  if (!match) return null
  const n = Number(match[1])
  return n >= 1 ? n : null
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function mentions(text: string, label: string): boolean {
  const hay = norm(text)
  const needle = norm(label)
  if (needle.length < 3 || hay.length < 3) return false
  return hay.includes(needle) || needle.includes(hay)
}

function mentionsUnit(text: string, label: string): boolean {
  const hay = norm(text)
  const needle = norm(label)
  if (!needle || !hay) return false
  if (needle.length >= 3) return hay.includes(needle)
  return new RegExp(`(?:^| )${needle}(?: |$)`).test(hay)
}

function visibleUnits(property: HomeCheckGuideProperty) {
  return property.units.filter((unit) =>
    !shouldOmitUnitReference({ unitLabel: unit.label, propertyType: property.propertyType })
  )
}

function placeLabel(property: HomeCheckGuideProperty, unitLabel?: string | null): string {
  return formatLocationWithOptionalUnit({
    propertyLabel: property.label,
    unitLabel,
    propertyType: property.propertyType,
  })
}

function propertyList(properties: HomeCheckGuideProperty[]): string {
  const lines = properties.map((property, index) => `${index + 1}) ${property.label}`)
  return `Which property should we check?\n${lines.join('\n')}\nReply with a number, or CANCEL.`
}

function whoQuestion(): string {
  return 'Who should do it?\n1) Your tenant\n2) A contractor\n3) You\nReply 1, 2, or 3, or CANCEL.'
}

function touch(
  state: HomeCheckGuideState,
  now: Date,
  patch: Partial<HomeCheckGuideState>,
): HomeCheckGuideState {
  return { ...state, ...patch, updatedAt: now.toISOString() }
}

function blank(now: Date, role: HomeCheckRole | null): HomeCheckGuideState {
  return { step: 'pick_property', updatedAt: now.toISOString(), role, checkId: null }
}

function locatedVendors(catalog: HomeCheckGuideCatalog): HomeCheckGuideVendor[] {
  return catalog.vendors
    .filter((vendor) => vendor.distanceKm != null && vendor.name.trim())
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
}

function nearestVendor(catalog: HomeCheckGuideCatalog): HomeCheckGuideVendor | null {
  return locatedVendors(catalog)[0] ?? null
}

export function parseHomeCheckVisitWindow(
  body: string,
  now: Date,
  timeZone?: string | null,
): { label: string; endAt: string } | null {
  const parsed = parseAvailabilityResolved(body, now, timeZone?.trim() || 'America/New_York')
  if (!parsed?.scheduledAt) return null
  const endMs = Date.parse(parsed.endAt || parsed.scheduledAt)
  if (!Number.isFinite(endMs)) return null
  if (endMs <= now.getTime()) return null
  if (endMs > now.getTime() + 7 * 24 * 60 * 60 * 1000) return null
  return {
    label: parsed.windowLabel?.trim() || body.trim(),
    endAt: new Date(endMs).toISOString(),
  }
}

function presetWindow(window: string | null, now: Date, timeZone?: string | null) {
  if (!window) return null
  const iso = Date.parse(window)
  if (Number.isFinite(iso)) {
    if (iso <= now.getTime() || iso > now.getTime() + 7 * 24 * 60 * 60 * 1000) return null
    return { label: window, endAt: new Date(iso).toISOString() }
  }
  return parseHomeCheckVisitWindow(window, now, timeZone)
}

function tenantHandoff(state: HomeCheckGuideState, reason: 'silent' | 'opted_out'): string {
  const name = state.tenantName?.trim() || 'The tenant'
  const where = state.unitLabel?.trim()
    ? `${name} at ${state.unitLabel}`
    : name
  const phone = state.tenantPhone?.trim()
  const reach = reason === 'opted_out'
    ? `Ulo can't text ${where}.`
    : `Ulo couldn't reach ${where}.`
  const number = phone ? ` Their number is ${phone}.` : ''
  return `${reach}${number} Please call them. Reply with a time (for example, Thu 2–4pm) or CANCEL.`
}

function entryNote(body: string): string | null {
  const kind = accessInstructionKind(body)
  if (kind === 'allow') return 'The resident said you can enter without them being home.'
  if (kind === 'restrict') return 'The resident needs to be home.'
  return null
}

function contractorAsk(catalog: HomeCheckGuideCatalog): string {
  const nearest = nearestVendor(catalog)
  if (!nearest) {
    return 'Reply with the contractor’s name, or CANCEL. No located contractor is on file for this property.'
  }
  return `The nearest contractor is ${nearest.name}. Reply YES to use them, or reply with a contractor’s name. Reply CANCEL to stop.`
}

function afterPlace(
  state: HomeCheckGuideState,
  catalog: HomeCheckGuideCatalog,
  now: Date,
): HomeCheckGuideTurn {
  const property = catalog.properties.find((row) => row.id === state.propertyId)
  if (!property) return { state, replies: [propertyList(catalog.properties)], effects: [] }
  const units = visibleUnits(property)
  if (!state.unitId && units.length > 1) {
    const next = touch(state, now, {
      step: 'pick_unit',
      unitChoices: units.map((unit) => unit.id),
    })
    const lines = units.map((unit, index) => `${index + 1}) ${unit.label}`)
    return {
      state: next,
      replies: [`Which unit at ${property.label}?\n${lines.join('\n')}\nReply with a number, or CANCEL.`],
      effects: [],
    }
  }
  if (state.role === 'tenant' || state.role === 'landlord') {
    return finishCapture(touch(state, now, { step: 'pick_who' }), catalog)
  }
  if (state.role === 'contractor') {
    const next = touch(state, now, { step: 'pick_contractor' })
    return { state: next, replies: [contractorAsk(catalog)], effects: [] }
  }
  const next = touch(state, now, { step: 'pick_who' })
  return { state: next, replies: [whoQuestion()], effects: [] }
}

function finishCapture(
  state: HomeCheckGuideState,
  _catalog: HomeCheckGuideCatalog,
): HomeCheckGuideTurn {
  if (state.role === 'tenant') {
    if (!state.unitId) {
      return {
        state,
        replies: ['Choose the tenant’s unit before sending the check, or reply CANCEL.'],
        effects: [],
      }
    }
    return {
      state: null,
      replies: [`We'll text your tenant the photo steps for ${state.placeLabel}.`],
      effects: [{ type: 'start_tenant', propertyId: state.propertyId!, unitId: state.unitId }],
    }
  }
  return {
    state: null,
    replies: [`We'll text you the photo steps for ${state.placeLabel}.`],
    effects: [{
      type: 'start_self',
      propertyId: state.propertyId!,
      unitId: state.unitId ?? null,
    }],
  }
}

function beginTenantWait(
  state: HomeCheckGuideState,
  catalog: HomeCheckGuideCatalog,
  now: Date,
): HomeCheckGuideTurn {
  const tenant = catalog.tenant
  const next = touch(state, now, {
    tenantName: tenant?.name || state.tenantName,
    tenantPhone: tenant?.phone ?? state.tenantPhone ?? null,
  })
  if (!tenant?.phone || tenant.optedOut) {
    const handed = touch(next, now, { step: 'awaiting_landlord', handoffReason: 'opted_out' })
    return {
      state: handed,
      replies: [tenantHandoff(handed, 'opted_out')],
      effects: [],
    }
  }
  const waiting = touch(next, now, {
    step: 'awaiting_tenant',
    promptedAt: now.toISOString(),
    remindedAt: null,
  })
  return {
    state: waiting,
    replies: [`We'll ask ${tenant.name || 'the tenant'} what time works before the contractor gets a link.`],
    effects: [{ type: 'text_tenant', phone: tenant.phone, body: homeCheckTenantAsk(catalog) }],
  }
}

function sendContractor(
  state: HomeCheckGuideState,
  body: string,
  catalog: HomeCheckGuideCatalog,
  sender: 'landlord' | 'tenant',
): HomeCheckGuideTurn {
  if (!state.vendorId || !state.windowEnd || !state.windowLabel || !state.propertyId) {
    return {
      state,
      replies: ['Reply with a day and arrival window, for example Thu 2–4pm, or CANCEL.'],
      effects: [],
    }
  }
  const note = entryNote(body)
  const tenantConfirm = `We'll plan on ${state.windowLabel}.${
    note ? ` ${note}` : ''
  } The contractor will get the photo link for that visit.`
  const landlordConfirm =
    `The equipment check is set for ${state.windowLabel}. The contractor has the photo link.`
  const canTextTenant = Boolean(state.tenantPhone) && !catalog.tenant?.optedOut
  return {
    state: null,
    replies: [sender === 'tenant' ? tenantConfirm : landlordConfirm],
    effects: [{
      type: 'send_contractor',
      propertyId: state.propertyId,
      unitId: state.unitId ?? null,
      vendorId: state.vendorId,
      windowEnd: state.windowEnd,
      windowLabel: state.windowLabel,
      tenantBody: sender === 'landlord' && canTextTenant ? tenantConfirm : null,
      tenantPhone: sender === 'landlord' && canTextTenant ? state.tenantPhone ?? null : null,
      landlordBody: sender === 'tenant' ? landlordConfirm : null,
    }],
  }
}

function matchProperties(target: string, properties: HomeCheckGuideProperty[]) {
  const tokens = norm(target).split(' ').filter((token) =>
    token.length >= 3 && !['unit', 'the', 'for', 'ave', 'st', 'street', 'road'].includes(token)
  )
  if (!tokens.length) return []
  return properties.filter((property) => {
    const hay = norm(`${property.label} ${property.name ?? ''}`)
    return tokens.some((token) => hay.includes(token))
  })
}

function startGuide(
  body: string,
  catalog: HomeCheckGuideCatalog,
  now: Date,
): HomeCheckGuideTurn {
  const start = parseHomeCheckGuideStart(body)
  if (!start) {
    return { state: null, replies: [], effects: [] }
  }
  const window = presetWindow(start.window, now, catalog.timeZone)
  let state = blank(now, start.role)
  if (window) {
    state = { ...state, windowLabel: window.label, windowEnd: window.endAt }
  }
  if (!catalog.properties.length) {
    return {
      state: null,
      replies: ['Add a property before starting a home check.'],
      effects: [],
    }
  }
  const matches = matchProperties(start.target, catalog.properties)
  if (matches.length !== 1) {
    const choices = matches.length > 1 ? matches : catalog.properties
    const next = touch(state, now, {
      step: 'pick_property',
      propertyChoices: choices.map((property) => property.id),
    })
    return { state: next, replies: [propertyList(choices)], effects: [] }
  }
  const property = matches[0]
  const units = visibleUnits(property)
  const namedUnit = units.filter((unit) => mentionsUnit(start.target, unit.label))
  if (namedUnit.length > 1) {
    const next = touch(state, now, {
      step: 'pick_unit',
      propertyId: property.id,
      placeLabel: property.label,
      unitChoices: namedUnit.map((unit) => unit.id),
    })
    return {
      state: next,
      replies: [`Which unit at ${property.label}? Reply with the unit, or CANCEL.`],
      effects: [],
    }
  }
  const unit = namedUnit.length === 1
    ? namedUnit[0]
    : units.length === 1
    ? units[0]
    : units.length === 0
    ? property.units[0] ?? null
    : null
  const label = placeLabel(property, unit?.label)
  const next = touch(state, now, {
    step: 'confirm_place',
    propertyId: property.id,
    unitId: namedUnit.length === 1 || units.length <= 1 ? unit?.id ?? null : null,
    unitLabel: unit && (namedUnit.length === 1 || units.length <= 1)
      ? (shouldOmitUnitReference({ unitLabel: unit.label, propertyType: property.propertyType })
        ? null
        : unit.label)
      : null,
    placeLabel: label,
  })
  return {
    state: next,
    replies: [`Home check for ${label} — right? Reply YES or NO.`],
    effects: [],
  }
}

function pickVendor(
  state: HomeCheckGuideState,
  body: string,
  catalog: HomeCheckGuideCatalog,
  now: Date,
): HomeCheckGuideTurn {
  const nearest = nearestVendor(catalog)
  if (isAffirmativeReply(body) && nearest) {
    const next = touch(state, now, {
      step: state.windowEnd ? 'pick_window' : 'pick_window',
      vendorId: nearest.id,
      vendorName: nearest.name,
    })
    if (next.windowEnd && next.windowLabel) return beginTenantWait(next, catalog, now)
    return {
      state: next,
      replies: ['What visit window should we use? Reply with a day and arrival window, for example Thu 2–4pm.'],
      effects: [],
    }
  }
  const named = catalog.vendors.filter((vendor) => mentions(body, vendor.name))
  if (named.length === 1) {
    const next = touch(state, now, {
      step: 'pick_window',
      vendorId: named[0].id,
      vendorName: named[0].name,
    })
    if (next.windowEnd && next.windowLabel) return beginTenantWait(next, catalog, now)
    return {
      state: next,
      replies: [`What visit window should we use for ${named[0].name}? For example, Thu 2–4pm.`],
      effects: [],
    }
  }
  if (named.length > 1) {
    const lines = named.map((vendor, index) => `${index + 1}) ${vendor.name}`)
    return {
      state: touch(state, now, { step: 'pick_contractor' }),
      replies: [`Which contractor?\n${lines.join('\n')}\nReply with a number.`],
      effects: [],
    }
  }
  const index = choiceIndex(body)
  if (index && named.length === 0) {
    const choices = locatedVendors(catalog)
    const vendor = choices[index - 1]
    if (vendor) {
      const next = touch(state, now, {
        step: 'pick_window',
        vendorId: vendor.id,
        vendorName: vendor.name,
      })
      if (next.windowEnd) return beginTenantWait(next, catalog, now)
      return {
        state: next,
        replies: [`What visit window should we use for ${vendor.name}? For example, Thu 2–4pm.`],
        effects: [],
      }
    }
  }
  return { state, replies: [contractorAsk(catalog)], effects: [] }
}

export function tickHomeCheckGuide(
  state: HomeCheckGuideState | null,
  catalog: HomeCheckGuideCatalog,
  now: Date,
): HomeCheckGuideTurn {
  if (!state || state.step !== 'awaiting_tenant' || !state.promptedAt) {
    return { state, replies: [], effects: [] }
  }
  const age = now.getTime() - Date.parse(state.promptedAt)
  if (!Number.isFinite(age)) return { state, replies: [], effects: [] }
  if (age >= HOME_CHECK_TENANT_HANDOFF_MS) {
    const handed = touch(state, now, { step: 'awaiting_landlord', handoffReason: 'silent' })
    return { state: handed, replies: [tenantHandoff(handed, 'silent')], effects: [] }
  }
  if (age >= HOME_CHECK_TENANT_REMIND_MS && !state.remindedAt && state.tenantPhone) {
    const reminded = touch(state, now, { remindedAt: now.toISOString() })
    return {
      state: reminded,
      replies: [],
      effects: [{
        type: 'text_tenant',
        phone: state.tenantPhone,
        body: `Just a reminder.\n\n${homeCheckTenantAsk(catalog)}`,
      }],
    }
  }
  return { state, replies: [], effects: [] }
}

export function reduceHomeCheckGuide(input: {
  state: HomeCheckGuideState | null
  body: string
  catalog: HomeCheckGuideCatalog
  now: Date
  sender: 'landlord' | 'tenant'
}): HomeCheckGuideTurn {
  const body = input.body.trim()
  const now = input.now
  let state = input.state
  if (homeCheckGuideExpired(state, now)) {
    if (parseHomeCheckGuideStart(body) && input.sender === 'landlord') {
      state = null
    } else {
      return {
        state: null,
        replies: ['That home check conversation expired. Text HOME CHECK when you want to start again.'],
        effects: [],
      }
    }
  }
  if (state && isCancel(body) && input.sender === 'landlord') {
    return {
      state: null,
      replies: ['The equipment check is cancelled. No photo link was sent.'],
      effects: [{ type: 'cancel', checkId: state.checkId ?? null }],
    }
  }
  if (
    state && input.sender === 'landlord' && parseHomeCheckGuideStart(body) &&
    !/^(yes|no|\d+)$/i.test(body)
  ) {
    return startGuide(body, input.catalog, now)
  }
  if (!state) {
    if (input.sender !== 'landlord') return { state: null, replies: [], effects: [] }
    return startGuide(body, input.catalog, now)
  }
  if (input.sender === 'tenant' && state.step !== 'awaiting_tenant') {
    return { state, replies: [], effects: [] }
  }
  if (input.sender === 'landlord' && state.step === 'awaiting_tenant') {
    return {
      state,
      replies: [
        `We're still waiting on ${state.tenantName || 'the tenant'} for a time. The contractor will not get a link until then.`,
      ],
      effects: [],
    }
  }

  if (state.step === 'pick_property') {
    const choices = (state.propertyChoices ?? input.catalog.properties.map((property) => property.id))
      .map((id) => input.catalog.properties.find((property) => property.id === id))
      .filter((property): property is HomeCheckGuideProperty => Boolean(property))
    const index = choiceIndex(body)
    const property = index ? choices[index - 1] : choices.find((row) => mentions(body, row.label))
    if (!property) return { state, replies: [propertyList(choices)], effects: [] }
    const units = visibleUnits(property)
    const only = units.length === 1 ? units[0] : units.length === 0 ? property.units[0] ?? null : null
    const next = touch(state, now, {
      step: 'confirm_place',
      propertyId: property.id,
      unitId: only?.id ?? null,
      unitLabel: only && !shouldOmitUnitReference({
        unitLabel: only.label,
        propertyType: property.propertyType,
      })
        ? only.label
        : null,
      placeLabel: placeLabel(property, only?.label),
    })
    return {
      state: next,
      replies: [`Home check for ${next.placeLabel} — right? Reply YES or NO.`],
      effects: [],
    }
  }

  if (state.step === 'confirm_place') {
    if (isNo(body)) {
      const next = touch(state, now, {
        step: 'pick_property',
        propertyId: undefined,
        unitId: null,
        placeLabel: undefined,
        propertyChoices: input.catalog.properties.map((property) => property.id),
      })
      return { state: next, replies: [propertyList(input.catalog.properties)], effects: [] }
    }
    if (!isAffirmativeReply(body)) {
      return {
        state,
        replies: [`Home check for ${state.placeLabel} — right? Reply YES or NO.`],
        effects: [],
      }
    }
    return afterPlace(state, input.catalog, now)
  }

  if (state.step === 'pick_unit') {
    const property = input.catalog.properties.find((row) => row.id === state.propertyId)
    const units = (state.unitChoices ?? [])
      .map((id) => property?.units.find((unit) => unit.id === id))
      .filter((unit): unit is { id: string; label: string } => Boolean(unit))
    const index = choiceIndex(body)
    const unit = index ? units[index - 1] : units.find((row) => mentionsUnit(body, row.label))
    if (!property || !unit) {
      return {
        state,
        replies: [`Which unit at ${property?.label || 'that property'}? Reply with a number, or CANCEL.`],
        effects: [],
      }
    }
    const next = touch(state, now, {
      unitId: unit.id,
      unitLabel: shouldOmitUnitReference({
        unitLabel: unit.label,
        propertyType: property.propertyType,
      })
        ? null
        : unit.label,
      placeLabel: placeLabel(property, unit.label),
    })
    return afterPlace(next, input.catalog, now)
  }

  if (state.step === 'pick_who') {
    const index = choiceIndex(body)
    const role: HomeCheckRole | null = index === 1
      ? 'tenant'
      : index === 2
      ? 'contractor'
      : index === 3
      ? 'landlord'
      : null
    if (!role) return { state, replies: [whoQuestion()], effects: [] }
    const next = touch(state, now, { role, step: role === 'contractor' ? 'pick_contractor' : 'pick_who' })
    if (role === 'contractor') {
      return { state: next, replies: [contractorAsk(input.catalog)], effects: [] }
    }
    return finishCapture(next, input.catalog)
  }

  if (state.step === 'pick_contractor') return pickVendor(state, body, input.catalog, now)

  if (state.step === 'pick_window') {
    const window = parseHomeCheckVisitWindow(body, now, input.catalog.timeZone)
    if (!window) {
      return {
        state,
        replies: ['Reply with a day and arrival window in the next 7 days, for example Thu 2–4pm.'],
        effects: [],
      }
    }
    return beginTenantWait(touch(state, now, {
      windowLabel: window.label,
      windowEnd: window.endAt,
    }), input.catalog, now)
  }

  if (state.step === 'awaiting_tenant' && input.sender === 'tenant') {
    const window = parseHomeCheckVisitWindow(body, now, input.catalog.timeZone)
    if (!window) {
      return {
        state,
        replies: ['Reply with a day and arrival window this week, for example Thu 2–4pm.'],
        effects: [],
      }
    }
    return sendContractor(touch(state, now, {
      windowLabel: window.label,
      windowEnd: window.endAt,
    }), body, input.catalog, 'tenant')
  }

  if (state.step === 'awaiting_landlord' && input.sender === 'landlord') {
    const window = parseHomeCheckVisitWindow(body, now, input.catalog.timeZone)
    if (!window) {
      return { state, replies: [tenantHandoff(state, state.handoffReason ?? 'silent')], effects: [] }
    }
    return sendContractor(touch(state, now, {
      windowLabel: window.label,
      windowEnd: window.endAt,
    }), body, input.catalog, 'landlord')
  }

  return { state, replies: [], effects: [] }
}

/** True when this text might continue a guide, so the thread state is worth reading. */
export function mightContinueHomeCheckGuide(body: string, now = new Date()): boolean {
  const text = body.trim()
  if (!text || text.length > 80) return false
  if (/^(yes|y|yeah|yep|no|nope|n|cancel|\d{1,2})$/i.test(text)) return true
  if (/\b(be home|enter|without me|without you)\b/i.test(text)) return true
  return parseHomeCheckVisitWindow(text, now, 'America/New_York') != null
}
