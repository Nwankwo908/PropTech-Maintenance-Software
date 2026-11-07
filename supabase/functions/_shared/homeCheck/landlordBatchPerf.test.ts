import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { beforeEach, expect, it, vi } from 'vitest'
import { homeCheckCaptureSms, HOME_CHECK_PHOTOS } from '../../../../shared/homeCheck.ts'
import { reduceHomeCheckGuide, type HomeCheckGuideCatalog } from './guide.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

vi.mock('../vendor_availability_parse.ts', () => ({
  parseAvailabilityResolved: vi.fn(),
}))
vi.mock('./vendorBatch.ts', () => ({
  identifyVendorHomeCheckBatch: vi.fn(async (paths: string[]) =>
    paths.map((path, index) => ({
      path,
      slot: HOME_CHECK_PHOTOS[index].slot,
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg',
    })),
  ),
}))
vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
vi.mock('./visitAct.ts', () => ({
  prepareHomeCheckVisitReply: vi.fn(async () => null),
  applyHomeCheckVisitReply: vi.fn(async () => ''),
  startDueHomeCheckPhotoPrompts: vi.fn(async () => 0),
  sendHomeCheckVendorAcceptance: vi.fn(async () => ({ deliveryError: null, alreadySent: false })),
}))
vi.mock('./photoSlot.ts', () => ({ readHomeCheckPhoto: vi.fn(async () => null) }))
vi.mock('../sms/landlordAccountPhone.ts', () => ({
  isLandlordAccountOrOpsPhone: vi.fn(async () => true),
}))

const pending = {
  id: 'check',
  reference: 'HC-AABBCCDDEEFF',
  property_label: '12 Oak St',
  unit_label: '2B',
  landlord_id: 'landlord',
  recipient_phone: '+15551112222',
  ulo_number: '+15550001111',
  role: 'landlord',
  status: 'collecting',
  visit: null,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  confirmed_at: null,
  workflow_run_id: 'run',
}

vi.mock('./service.ts', () => ({
  homeCheckEvent: vi.fn(async () => {}),
  requireData: ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error
    return data
  },
  checkLocation: (check: { property_label: string; unit_label: string }) =>
    `${check.property_label}, Unit ${check.unit_label}`,
  checked: (value: PromiseLike<unknown>) => Promise.resolve(value),
  sendHomeCheckSms: vi.fn(async () => {}),
  confirmHomeCheck: vi.fn(async () => {}),
  loadHomeCheck: vi.fn(async () => ({ ...pending })),
  pendingHomeCheckSystems: vi.fn(async () => []),
  saveHomeCheckAnswers: vi.fn(async () => true),
  notifyHomeCheckResult: vi.fn(async () => true),
  rebuildHomeCheckAssets: vi.fn(async () => []),
  uploadHomeCheckPhoto: vi.fn(async () => ({ feedback: [] })),
  analyzeHomeCheckBatch: vi.fn(async () => ({ feedback: [] })),
  createHomeCheck: vi.fn(async () => ({ check: pending, link: null, deliveryError: null })),
}))

import { identifyVendorHomeCheckBatch } from './vendorBatch.ts'
import { actHomeCheckSms, prepareHomeCheckSms } from './sms.ts'
import { analyzeHomeCheckBatch, uploadHomeCheckPhoto } from './service.ts'

const PATHS = ['sms/a.jpg', 'sms/b.jpg', 'sms/c.jpg', 'sms/d.jpg']
const COMPANY = 'Test Account'
const catalog: HomeCheckGuideCatalog = {
  companyName: COMPANY,
  timeZone: 'America/New_York',
  tenant: { name: 'Sam Resident', phone: '+15550100001', optedOut: false },
  vendors: [{ id: 'near', name: 'Test Contractor', distanceKm: 1.2 }],
  properties: [{
    id: 'prop',
    label: '12 Oak St',
    propertyType: 'multi_family',
    units: [{ id: 'unit', label: '2B' }],
  }],
}

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

function query(data: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve(resolve({ data, error: null })),
  }
  for (const method of ['select', 'eq', 'in', 'gt', 'not', 'is', 'update', 'contains', 'limit', 'order']) {
    builder[method] = () => builder
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })
  builder.single = builder.maybeSingle
  return {
    from: vi.fn(() => builder),
    rpc: vi.fn(async (name: string, args: { p_action?: string }) => {
      if (name === 'home_check_sms_capture_context' && args.p_action === 'claim') {
        return { data: { ok: true, claim: 'claim' }, error: null }
      }
      return { data: { ok: true, checkId: 'check', slot: 'water_heater_label', version: 'version0' }, error: null }
    }),
  }
}

function selectedDb(role: 'landlord' | 'contractor' | 'tenant' = 'landlord') {
  const db = query([])
  const slots = [...HOME_CHECK_PHOTOS.map((photo) => photo.slot)]
  let saved = 0
  db.from.mockImplementation((table: string) => {
    if (table === 'sms_conversations') return query([{ intake_state: {} }]).from(table)
    if (table === 'home_check_sms_capture_sessions') {
      return query([{
        check_id: 'check',
        expected_slot: slots[Math.min(saved, slots.length - 1)],
        version: `version${saved}`,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      }]).from(table)
    }
    if (table === 'home_check_photos') {
      return query(slots.slice(0, saved).map((slot) => ({ slot, storage_path: `sms/${slot}.jpg` }))).from(table)
    }
    if (table === 'home_checks') return query([{ ...pending, role }]).from(table)
    return query([]).from(table)
  })
  db.rpc.mockImplementation(async (name: string, args: { p_action?: string }) => {
    if (name === 'home_check_sms_capture_context' && args.p_action === 'claim') {
      return { data: { ok: true, claim: `claim${saved}` }, error: null }
    }
    if (name === 'record_home_check_sms_photo') {
      saved += 1
      return { data: true, error: null }
    }
    return { data: { ok: true, checkId: 'check', slot: slots[saved], version: `version${saved}` }, error: null }
  })
  vi.mocked(uploadHomeCheckPhoto).mockImplementation(async () => {
    saved += 1
    return { feedback: [] } as never
  })
  return db
}

function context(
  db: ReturnType<typeof query>,
  mediaUrls: string[],
): InboundSmsHandlerContext {
  return {
    supabase: db,
    landlordId: 'landlord',
    messageId: 'message',
    conversationId: 'conv',
    identity: { identity_type: 'landlord' },
    inbound: { body: '', mediaUrls, from: '+15551112222', to: '+15550001111' },
  } as unknown as InboundSmsHandlerContext
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(identifyVendorHomeCheckBatch).mockImplementation(async (paths: string[]) =>
    paths.map((path, index) => ({
      path,
      slot: HOME_CHECK_PHOTOS[index].slot,
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg',
    })),
  )
  vi.mocked(analyzeHomeCheckBatch).mockResolvedValue({ feedback: [] } as never)
  vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({ feedback: [] } as never)
})

it('times landlord SMS self-capture with four-photo batch option', async () => {
  const guideSamples: number[] = []
  const copySamples: number[] = []
  const admitSamples: number[] = []
  const batchSamples: number[] = []

  const guideOnce = () => {
    const start = performance.now()
    let state = reduceHomeCheckGuide({
      state: null,
      body: 'home check 12 Oak St / 2B',
      catalog,
      now: new Date(),
      sender: 'landlord',
    })
    state = reduceHomeCheckGuide({
      state: state.state,
      body: 'YES',
      catalog,
      now: new Date(),
      sender: 'landlord',
    })
    state = reduceHomeCheckGuide({
      state: state.state,
      body: '3',
      catalog,
      now: new Date(),
      sender: 'landlord',
    })
    expect(state.effects).toEqual([{ type: 'start_self', propertyId: 'prop', unitId: 'unit' }])
    guideSamples.push(performance.now() - start)
  }

  const copyOnce = () => {
    const start = performance.now()
    const text = homeCheckCaptureSms({
      role: 'landlord',
      location: '12 Oak St, Unit 2B',
      company: COMPANY,
      reference: '',
    })
    expect(text).toContain('Your Home Check for 12 Oak St, Unit 2B.')
    expect(text).toContain('attach all four photos in one text')
    expect(text).toContain('one at a time')
    copySamples.push(performance.now() - start)
  }

  const admitOnce = async () => {
    const start = performance.now()
    const action = await prepareHomeCheckSms(context(selectedDb('landlord'), PATHS))
    expect(action).toMatchObject({ kind: 'vendor_batch', check: { id: 'check', role: 'landlord' }, paths: PATHS })
    admitSamples.push(performance.now() - start)
  }

  const batchOnce = async () => {
    const start = performance.now()
    const db = selectedDb('landlord')
    const action = await prepareHomeCheckSms(context(db, PATHS))
    expect(action?.kind).toBe('vendor_batch')
    if (!action || action.kind !== 'vendor_batch') throw new Error('expected vendor_batch')
    const result = await actHomeCheckSms(db as never, 'landlord', action)
    expect(result.reply).toContain('All four photos are saved')
    expect(identifyVendorHomeCheckBatch).toHaveBeenCalled()
    expect(analyzeHomeCheckBatch).toHaveBeenCalled()
    batchSamples.push(performance.now() - start)
  }

  guideOnce()
  copyOnce()
  await admitOnce()
  await batchOnce()

  for (let i = 0; i < 40; i += 1) {
    guideOnce()
    copyOnce()
    await admitOnce()
    await batchOnce()
  }

  const report = [
    summarize('SMS landlord guide → self', guideSamples),
    summarize('SMS landlord batch capture copy', copySamples),
    summarize('SMS landlord admit 4-photo batch', admitSamples),
    summarize('SMS landlord 4-photo batch attach+analyze', batchSamples),
  ]
  if (process.env.HOME_CHECK_PERF_REPORT) {
    writeFileSync(
      process.env.HOME_CHECK_PERF_REPORT,
      JSON.stringify({
        evidence:
          'In-process landlord self-capture with mocked DB, identify, upload and analyze; excludes carrier and live AI',
        flows: report,
      }, null, 2),
    )
  }
  for (const row of report) expect(row.p95).toBeLessThan(50)
})
