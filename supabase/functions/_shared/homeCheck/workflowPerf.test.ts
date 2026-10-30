import { performance } from 'node:perf_hooks'
import { expect, it, vi } from 'vitest'
import {
  HOME_CHECK_PHOTOS,
  homeCheckCaptureSms,
  type HomeCheckSlot,
} from '../../../../shared/homeCheck.ts'
import {
  homeCheckLandlordStatus,
  homeCheckVendorAcceptanceSms,
  homeCheckVisitPhotoDue,
  homeCheckVisitPhotoSms,
  homeCheckWorkflowStep,
  type HomeCheckVisit,
} from '../../../../shared/homeCheckVisit.ts'
import { reduceHomeCheckGuide, type HomeCheckGuideCatalog } from './guide.ts'

vi.mock('../vendor_availability_parse.ts', () => ({
  parseAvailabilityResolved: (body: string) => {
    const when = /thu/i.test(body) ? 3 : /wed/i.test(body) ? 2 : 0
    if (!when) return null
    const at = Date.now() + when * 24 * 60 * 60 * 1000
    return {
      scheduledAt: new Date(at).toISOString(),
      endAt: new Date(at + 3 * 60 * 60 * 1000).toISOString(),
      windowLabel: /thu/i.test(body) ? 'Thu 1pm–4pm' : 'Wed 9am–12pm',
    }
  },
}))
vi.mock('../engine/workflowRuns.ts', () => ({
  updateWorkflowRun: vi.fn(async () => null),
}))
vi.mock('../graph/recordActivityLog.ts', () => ({
  recordActivityLog: vi.fn(async () => {}),
}))
vi.mock('../sms/inbound_db.ts', () => ({
  normalizeSmsPhone: (phone: string) => phone,
}))
vi.mock('./service.ts', () => ({
  checkLocation: () => '12 Oak St, Unit 2B',
  checked: async (result: Promise<{ error?: { message: string } | null }>) => {
    const value = await result
    if (value?.error) throw new Error(value.error.message)
    return value
  },
  homeCheckEvent: vi.fn(async () => {}),
  loadHomeCheck: vi.fn(async () => null),
  sendHomeCheckSms: vi.fn(async (_db: unknown, _check: unknown, phone: string, body: string) => {
    sent.push({ phone, body })
  }),
}))

const sent: Array<{ phone: string; body: string }> = []
const LOCATION = '12 Oak St, Unit 2B'
const COMPANY = 'Test Account'
const VENDOR = '+15550100004'
const TENANT = '+15550100001'
const LANDLORD = 'd15a0000-0000-4000-8000-000000000001'

const catalog: HomeCheckGuideCatalog = {
  companyName: COMPANY,
  timeZone: 'America/New_York',
  tenant: { name: 'Sam Resident', phone: TENANT, optedOut: false },
  vendors: [{ id: 'near', name: 'Test Contractor', distanceKm: 1.2 }],
  properties: [{
    id: 'prop',
    label: '12 Oak St',
    propertyType: 'multi_family',
    units: [{ id: 'unit', label: '2B' }],
  }],
}

type Sample = { name: string; ms: number }

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarize(name: string, samples: number[]) {
  return {
    flow: name,
    runs: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    max: Math.max(...samples),
  }
}

function guideTurn(body: string, state: ReturnType<typeof reduceHomeCheckGuide>['state']) {
  return reduceHomeCheckGuide({
    state,
    body,
    catalog,
    now: new Date(),
    sender: 'landlord',
  })
}

function photoSequence(role: 'tenant' | 'landlord' | 'contractor') {
  const first = role === 'contractor'
    ? homeCheckVisitPhotoSms({ location: LOCATION, company: COMPANY, filled: [] })
    : homeCheckCaptureSms({ role, location: LOCATION, company: COMPANY, reference: '' })
  const texts = [first]
  const filled: HomeCheckSlot[] = []
  for (const photo of HOME_CHECK_PHOTOS) {
    texts.push(homeCheckVisitPhotoSms({
      location: LOCATION,
      company: COMPANY,
      savedSlot: photo.slot,
      filled,
    }))
    filled.push(photo.slot)
  }
  return texts
}

function assertPhotoFollowThrough(texts: string[]) {
  expect(texts[0]).toContain('Reply with the photo here')
  expect(texts[0]).not.toMatch(/availability|what times work|coordinate a visit/i)
  expect(texts[1]).toContain('Saved as the water heater label')
  expect(texts[1]).toContain('Next, send a photo of the whole water heater, including the base')
  expect(texts[2]).toContain('Next, send a photo of the furnace or boiler label')
  expect(texts[3]).toContain('Next, send a photo of the whole furnace or boiler')
  expect(texts[4]).toContain('All four photos are in')
  expect(texts).toHaveLength(5)
}

type CheckRow = {
  id: string
  landlord_id: string
  property_id: string
  unit_id: string
  vendor_id: string
  resident_id: string | null
  recipient_phone: string
  workflow_run_id: string
  ticket_id: string | null
  status: string
  expires_at: string
  visit: HomeCheckVisit | Record<string, never>
}

function memoryDb(initial: CheckRow) {
  let check: CheckRow = initial
  const builder = (table: string) => {
    let action: 'select' | 'update' = 'select'
    let patch: Partial<CheckRow> | null = null
    const exec = () => {
      if (table === 'occupancy') return { data: [{ resident_id: 'resident-1' }], error: null }
      if (table === 'users') {
        return {
          data: { id: 'resident-1', phone: TENANT, sms_consent_status: 'opted_in' },
          error: null,
        }
      }
      if (table === 'vendors') return { data: { name: 'Test Contractor' }, error: null }
      if (table === 'landlords') {
        return { data: { name: COMPANY, phone: '+15550100003' }, error: null }
      }
      if (table === 'maintenance_requests') return { data: null, error: null }
      if (table === 'home_checks') {
        if (action === 'update' && patch) check = { ...check, ...patch }
        return { data: [{ ...check }], error: null }
      }
      return { data: [], error: null }
    }
    const query: Record<string, unknown> = {
      select() { return query },
      update(value: Partial<CheckRow>) {
        action = 'update'
        patch = value
        return query
      },
      eq() { return query },
      gt() { return query },
      maybeSingle: async () => {
        const result = exec()
        const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data
        return { data, error: result.error }
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject)
      },
    }
    return query
  }
  return {
    from: builder,
    read: () => check,
  }
}

function freshCheck(): CheckRow {
  return {
    id: 'check-1',
    landlord_id: LANDLORD,
    property_id: 'prop',
    unit_id: 'unit',
    vendor_id: 'near',
    resident_id: null,
    recipient_phone: VENDOR,
    workflow_run_id: 'run-1',
    ticket_id: null,
    status: 'collecting',
    expires_at: '2026-12-01T00:00:00.000Z',
    visit: {},
  }
}

async function vendorVisit(steps: Sample[]) {
  const { sendHomeCheckVendorAcceptance, prepareHomeCheckVisitReply, applyHomeCheckVisitReply, startDueHomeCheckPhotoPrompts } = await import('./visitAct.ts')
  const db = memoryDb(freshCheck())
  const before = sent.length
  const time = async (name: string, run: () => Promise<void>) => {
    const start = performance.now()
    await run()
    steps.push({ name, ms: performance.now() - start })
  }
  await time('acceptance text', async () => {
    const acceptance = await sendHomeCheckVendorAcceptance(db as never, db.read())
    expect(acceptance).toEqual({ deliveryError: null, alreadySent: false })
  })
  const acceptance = sent[sent.length - 1]
  expect(acceptance.phone).toBe(VENDOR)
  expect(acceptance.body).toBe(homeCheckVendorAcceptanceSms(LOCATION))
  expect(acceptance.body).toContain('Reply YES to accept or NO to decline')
  expect(acceptance.body).toContain('coordinate a visit time with the tenant')
  expect(acceptance.body).not.toContain('Next: send a clear photo')
  expect(homeCheckLandlordStatus(homeCheckWorkflowStep('awaiting_acceptance'))).toBe('Awaiting vendor acceptance')

  await time('silence stays awaiting', async () => {
    expect(db.read().visit).toMatchObject({ phase: 'awaiting_acceptance' })
    expect(sent.length).toBe(before + 1)
  })

  const reply = async (from: string, body: string, id: string) => {
    const prepared = await prepareHomeCheckVisitReply({
      supabase: db as never,
      landlordId: LANDLORD,
      messageId: id,
      inbound: { body, from, mediaUrls: [] },
    } as never)
    expect(prepared?.kind).toBe('visit_reply')
    if (!prepared || prepared.kind !== 'visit_reply') return
    return applyHomeCheckVisitReply(db as never, prepared.check, prepared.event)
  }

  await time('vendor YES', async () => {
    const body = await reply(VENDOR, 'YES', 'yes-1')
    expect(body).toContain('What’s your earliest availability?')
    expect(db.read().visit).toMatchObject({ phase: 'scheduling', awaiting: 'vendor_window' })
    expect(homeCheckLandlordStatus('scheduling_visit')).toBe('Scheduling visit')
  })
  await time('duplicate YES', async () => {
    const body = await reply(VENDOR, 'YES', 'yes-1')
    expect(body).toBe('')
  })
  await time('vendor offers Wed', async () => {
    const body = await reply(VENDOR, 'Wed 9am-12pm', 'wed-1')
    expect(body).toContain('asking the tenant if Wed 9am–12pm works')
    const tenantText = sent.find((row) => row.phone === TENANT && row.body.includes('Wed 9am–12pm'))
    expect(tenantText?.body).toContain('Reply YES if that time works, or NO if it does not')
    expect(tenantText?.body).toContain('No repairs are authorized')
  })
  await time('tenant rejects time', async () => {
    const body = await reply(TENANT, 'NO', 'no-1')
    expect(body).toContain('What day and arrival window works for you?')
    expect(db.read().visit).toMatchObject({ phase: 'scheduling', awaiting: 'vendor_window' })
    expect(homeCheckLandlordStatus('scheduling_visit')).toBe('Scheduling visit')
  })
  await time('tenant offers Thu', async () => {
    const body = await reply(TENANT, 'Thu 1pm-4pm', 'thu-1')
    expect(body).toBe('')
    const vendorText = sent.filter((row) => row.phone === VENDOR).at(-1)
    expect(vendorText?.body).toContain('The tenant can do Thu 1pm–4pm')
    expect(vendorText?.body).toContain('Reply YES if that time works')
  })
  await time('vendor confirms Thu', async () => {
    const body = await reply(VENDOR, 'YES', 'yes-2')
    expect(body).toContain('The Home Check at 12 Oak St, Unit 2B is set for Thu 1pm–4pm')
    expect(body).toContain('Photo instructions will arrive by text when it’s time for the visit')
    expect(body).not.toContain('Next: send a clear photo')
    const tenantDetails = sent.filter((row) => row.phone === TENANT && row.body.includes('is set for Thu 1pm–4pm'))
    expect(tenantDetails).toHaveLength(1)
    expect(tenantDetails[0].body).toBe(body)
    expect(db.read().visit).toMatchObject({ phase: 'scheduled', confirmedWindow: 'Thu 1pm–4pm' })
    expect(homeCheckLandlordStatus('visit_scheduled')).toBe('Visit scheduled')
  })
  await time('photos wait until the visit', async () => {
    const started = await startDueHomeCheckPhotoPrompts(db as never, LANDLORD, new Date())
    expect(started).toBe(0)
    expect(homeCheckVisitPhotoDue(db.read().visit as HomeCheckVisit, Date.now())).toBe(false)
  })
  await time('photo instructions at visit time', async () => {
    const visitAt = Date.parse((db.read().visit as HomeCheckVisit).visitAt || '')
    const started = await startDueHomeCheckPhotoPrompts(
      db as never,
      LANDLORD,
      new Date(visitAt + 1000),
    )
    expect(started).toBe(1)
    const prompt = sent.filter((row) => row.phone === VENDOR).at(-1)
    expect(prompt?.body).toContain('Home Check visit for 12 Oak St, Unit 2B')
    expect(prompt?.body).toContain('Next: send a clear photo of the water heater label')
    expect(db.read().visit).toMatchObject({ phase: 'in_progress' })
    expect(homeCheckLandlordStatus('home_check_in_progress')).toBe('Home Check in progress')
  })
  await time('four photos', async () => {
    const texts = photoSequence('contractor').slice(1)
    assertPhotoFollowThrough([sent.filter((row) => row.phone === VENDOR).at(-1)!.body, ...texts])
    expect(homeCheckLandlordStatus('four_photos_received')).toBe('Completed')
  })
  const again = await sendHomeCheckVendorAcceptance(db as never, db.read())
  expect(again.alreadySent).toBe(true)
}

it('runs the full desktop and SMS home check workflows', async () => {
  const desktopSteps: Sample[] = []
  const smsVendorSteps: Sample[] = []
  const tenantSamples: number[] = []
  const landlordSamples: number[] = []
  const desktopSamples: number[] = []
  const smsVendorSamples: number[] = []

  const tenantOnce = () => {
    const start = performance.now()
    let state = guideTurn('home check 12 Oak St / 2B', null)
    expect(state.replies[0]).toContain('Home check for')
    state = guideTurn('YES', state.state)
    expect(state.replies[0]).toContain('Who should do it?')
    expect(state.replies[0]).toContain('takes the photos where they live')
    state = guideTurn('1', state.state)
    expect(state.state).toBeNull()
    expect(state.effects).toEqual([{ type: 'start_tenant', propertyId: 'prop', unitId: 'unit' }])
    expect(state.replies[0]).toContain('photo instructions')
    expect(state.replies.join('\n')).not.toMatch(/availability|what times work|visit time/i)
    const texts = photoSequence('tenant')
    expect(texts[0]).toContain('please take the equipment photos where you live, at 12 Oak St, Unit 2B')
    assertPhotoFollowThrough(texts)
    tenantSamples.push(performance.now() - start)
  }

  const landlordOnce = () => {
    const start = performance.now()
    let state = guideTurn('home check 12 Oak St / 2B', null)
    state = guideTurn('YES', state.state)
    state = guideTurn('3', state.state)
    expect(state.state).toBeNull()
    expect(state.effects).toEqual([{ type: 'start_self', propertyId: 'prop', unitId: 'unit' }])
    expect(state.replies).toEqual([])
    const texts = photoSequence('landlord')
    expect(texts[0]).toContain('Your Home Check for 12 Oak St, Unit 2B.')
    expect(texts[0]).not.toContain('where you live')
    assertPhotoFollowThrough(texts)
    landlordSamples.push(performance.now() - start)
  }

  const smsVendorGuide = () => {
    let state = guideTurn('home check 12 Oak St / 2B', null)
    state = guideTurn('YES', state.state)
    state = guideTurn('2', state.state)
    expect(state.state?.step).toBe('pick_contractor')
    expect(state.replies[0]).toContain('ask them to accept')
    expect(state.replies[0]).toContain('Photo instructions go out when it is time for the visit')
    state = guideTurn('YES', state.state)
    expect(state.state).toBeNull()
    expect(state.effects[0]).toMatchObject({
      type: 'invite_contractor',
      vendorId: 'near',
      vendorName: 'Test Contractor',
    })
    expect(state.effects.some((effect) => effect.type === 'text_tenant' || effect.type === 'send_contractor')).toBe(false)
    expect(state.replies[0]).toContain('asked Test Contractor to accept')
    expect(state.replies[0]).toContain('set a visit time with the tenant')
  }

  tenantOnce()
  landlordOnce()
  smsVendorGuide()
  await vendorVisit(desktopSteps)
  sent.length = 0
  await vendorVisit(smsVendorSteps)

  for (let i = 0; i < 40; i += 1) {
    tenantOnce()
    landlordOnce()
    const desktopStart = performance.now()
    sent.length = 0
    await vendorVisit([])
    desktopSamples.push(performance.now() - desktopStart)
    const smsStart = performance.now()
    smsVendorGuide()
    sent.length = 0
    await vendorVisit([])
    smsVendorSamples.push(performance.now() - smsStart)
  }

  const report = [
    summarize('SMS tenant, photos only', tenantSamples),
    summarize('SMS landlord, photos only', landlordSamples),
    summarize('Desktop vendor request through 4 photos', desktopSamples),
    summarize('SMS vendor choice through 4 photos', smsVendorSamples),
  ]
  for (const row of report) expect(row.p95).toBeLessThan(50)
})
