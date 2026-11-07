/**
 * In-process perf for Home Check Results follow-up (manufacture-year correction).
 * Excludes carrier latency; measures parse + prepare/act with mocked I/O.
 */
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { beforeEach, expect, it, vi } from 'vitest'
import { parseHomeCheckManufactureCorrection } from './manufactureCorrectionParse.ts'

vi.mock('../vendor_availability_parse.ts', () => ({
  parseAvailabilityResolved: vi.fn(),
}))
vi.mock('./vendorBatch.ts', () => ({
  identifyVendorHomeCheckBatch: vi.fn(async () => null),
}))
vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
vi.mock('./visitAct.ts', () => ({
  prepareHomeCheckVisitReply: vi.fn(async () => null),
  applyHomeCheckVisitReply: vi.fn(async () => ''),
  startDueHomeCheckPhotoPrompts: vi.fn(async () => 0),
  sendHomeCheckVendorAcceptance: vi.fn(async () => ({ deliveryError: null, alreadySent: false })),
}))
vi.mock('./photoSlot.ts', () => ({
  readHomeCheckPhoto: vi.fn(async () => null),
}))
vi.mock('../sms/landlordAccountPhone.ts', () => ({
  isLandlordAccountOrOpsPhone: vi.fn(async () => true),
}))

const ready = {
  id: 'check',
  reference: 'HC-AABBCCDDEEFF',
  property_label: '78 Maple Ave',
  unit_label: '2',
  landlord_id: 'landlord',
  recipient_phone: '+15551112222',
  ulo_number: '+15550001111',
  role: 'landlord',
  status: 'completed',
  visit: null,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  completed_at: new Date().toISOString(),
  confirmed_at: null,
  workflow_run_id: 'run',
  ticket_id: null,
  answers: {
    warningSigns: false,
    observationsConfirmed: true,
    warningDetails: '',
    lastService: '',
    lastFilterChange: '',
  },
}

vi.mock('./service.ts', () => ({
  homeCheckEvent: vi.fn(async () => {}),
  requireData: ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error
    return data
  },
  checkLocation: (check: { property_label: string; unit_label?: string | null }) =>
    check.unit_label ? `${check.property_label}, Unit ${check.unit_label}` : check.property_label,
  checked: (value: PromiseLike<unknown>) => Promise.resolve(value),
  sendHomeCheckSms: vi.fn(async () => {}),
  confirmHomeCheck: vi.fn(async () => {}),
  loadHomeCheck: vi.fn(async () => ({ ...ready })),
  pendingHomeCheckSystems: vi.fn(async () => []),
  saveHomeCheckAnswers: vi.fn(async () => true),
  notifyHomeCheckResult: vi.fn(async () => true),
  rebuildHomeCheckAssets: vi.fn(async () => []),
  uploadHomeCheckPhoto: vi.fn(async () => ({ feedback: [] })),
  analyzeHomeCheckBatch: vi.fn(async () => ({ feedback: [] })),
  createHomeCheck: vi.fn(async () => ({ check: ready, link: null, deliveryError: null })),
}))

vi.mock('./manufactureCorrection.ts', () => ({
  applyHomeCheckSmsManufactureCorrection: vi.fn(async () => ([
    { system: 'heating', verified: false, manufactureDate: { year: 2014, month: null }, fields: {} },
  ])),
}))

import { actHomeCheckSms, prepareHomeCheckSms } from './sms.ts'
import { notifyHomeCheckResult } from './service.ts'
import { applyHomeCheckSmsManufactureCorrection } from './manufactureCorrection.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]
}

function summarize(name: string, samples: number[]) {
  return {
    flow: name,
    runs: samples.length,
    p50: Number(percentile(samples, 0.5).toFixed(3)),
    p95: Number(percentile(samples, 0.95).toFixed(3)),
    max: Number(Math.max(...samples).toFixed(3)),
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
    rpc: vi.fn(async () => ({ data: true, error: null })),
  }
}

function followUpDb() {
  const summary = {
    id: 'summary',
    body: 'Results: 78 Maple Ave\nHeating system: Slant/Fin.\nAge unknown.\nReply OK to confirm these records.',
    raw_payload: { source: 'home_check' },
    provider_status: 'delivered',
    from_number: '+15550001111',
    to_number: '+15551112222',
  }
  const db = query([])
  db.from.mockImplementation((table: string) => {
    if (table === 'sms_conversations') {
      return query([{
        intake_state: {
          home_check_results_review: {
            ids: ['check'],
            selectedId: 'check',
            summaryMessageId: 'summary',
            expiresAt: new Date(Date.now() + 600000).toISOString(),
          },
        },
      }]).from(table)
    }
    if (table === 'sms_messages') return query([summary]).from(table)
    if (table === 'home_checks') return query([ready]).from(table)
    return query([]).from(table)
  })
  return db
}

function ctx(db: ReturnType<typeof followUpDb>, body: string): InboundSmsHandlerContext {
  return {
    supabase: db,
    landlordId: 'landlord',
    messageId: 'message',
    conversationId: 'conv',
    identity: { identity_type: 'landlord' },
    inbound: { body, mediaUrls: [], from: '+15551112222', to: '+15550001111' },
  } as unknown as InboundSmsHandlerContext
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('times Home Check Results manufacture-year follow-up path', async () => {
  const parseSamples: number[] = []
  const prepareSamples: number[] = []
  const actSamples: number[] = []

  const parseOnce = (samples: number[]) => {
    const start = performance.now()
    const parsed = parseHomeCheckManufactureCorrection('Age of heating system 2014', new Date('2026-11-07T12:00:00Z'))
    expect(parsed).toEqual({ system: 'heating', year: 2014, month: null })
    samples.push(performance.now() - start)
  }

  const prepareOnce = async (samples: number[]) => {
    const start = performance.now()
    const action = await prepareHomeCheckSms(ctx(followUpDb(), 'Age of heating system 2014'))
    expect(action).toMatchObject({ kind: 'correct_manufacture', correction: { year: 2014 } })
    samples.push(performance.now() - start)
  }

  const actOnce = async (samples: number[]) => {
    const start = performance.now()
    const result = await actHomeCheckSms(followUpDb() as never, 'landlord', {
      kind: 'correct_manufacture',
      check: ready as never,
      correction: { system: 'heating', year: 2014, month: null },
    })
    expect(applyHomeCheckSmsManufactureCorrection).toHaveBeenCalled()
    expect(notifyHomeCheckResult).toHaveBeenCalled()
    expect(result.reply).toBeUndefined()
    samples.push(performance.now() - start)
  }

  parseOnce(parseSamples)
  await prepareOnce(prepareSamples)
  await actOnce(actSamples)
  parseSamples.length = 0
  prepareSamples.length = 0
  actSamples.length = 0
  vi.clearAllMocks()

  for (let i = 0; i < 40; i += 1) {
    parseOnce(parseSamples)
    await prepareOnce(prepareSamples)
    await actOnce(actSamples)
  }

  const report = [
    summarize('parse manufacture correction', parseSamples),
    summarize('prepare Results follow-up', prepareSamples),
    summarize('act manufacture correction (mocked I/O)', actSamples),
  ]

  const out = {
    evidence:
      'In-process Home Check Results follow-up (Age of heating system 2014) with mocked DB; excludes carrier and live Gemini',
    flows: report,
  }
  if (process.env.HOME_CHECK_PERF_REPORT) {
    writeFileSync(process.env.HOME_CHECK_PERF_REPORT, JSON.stringify(out, null, 2))
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2))

  for (const row of report) {
    if (row.flow.startsWith('parse')) expect(row.p95).toBeLessThan(5)
    else expect(row.p95).toBeLessThan(50)
  }
})
