/**
 * In-process perf for phone-camera video on the Home Check SMS attach path.
 * Excludes carrier latency and live Gemini; measures gate + act with mocked I/O.
 */
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { beforeEach, expect, it, vi } from 'vitest'
import { gateHomeCheckSmsMedia } from './homeCheckMedia.ts'

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
  readHomeCheckPhoto: vi.fn(async () => ({
    category: 'water_heater',
    photoView: { equipment: 'water_heater', framing: 'label_closeup', confidence: 'high' },
  })),
}))
vi.mock('../sms/landlordAccountPhone.ts', () => ({
  isLandlordAccountOrOpsPhone: vi.fn(async () => true),
}))

const pending = {
  id: 'check',
  reference: 'HC-AABBCCDDEEFF',
  property_label: '78 Maple Ave',
  unit_label: '1',
  landlord_id: 'landlord',
  recipient_phone: '+15551112222',
  ulo_number: '+15550001111',
  role: 'landlord',
  status: 'collecting',
  visit: null,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  confirmed_at: null,
  workflow_run_id: 'run',
  ticket_id: null,
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
  loadHomeCheck: vi.fn(async () => ({ ...pending })),
  pendingHomeCheckSystems: vi.fn(async () => []),
  saveHomeCheckAnswers: vi.fn(async () => true),
  notifyHomeCheckResult: vi.fn(async () => true),
  rebuildHomeCheckAssets: vi.fn(async () => []),
  uploadHomeCheckPhoto: vi.fn(async () => ({ feedback: [] })),
  analyzeHomeCheckBatch: vi.fn(async () => ({ feedback: [] })),
  createHomeCheck: vi.fn(async () => ({ check: pending, link: null, deliveryError: null })),
}))

import { actHomeCheckSms } from './sms.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'
import { uploadHomeCheckPhoto } from './service.ts'

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
    rpc: vi.fn(async (name: string, args: { p_action?: string }) => {
      if (name === 'home_check_sms_capture_context') {
        if (args.p_action === 'bind') return { data: { ok: true, version: 'v1' }, error: null }
        if (args.p_action === 'claim') return { data: { ok: true, claim: 'claim1' }, error: null }
        if (args.p_action === 'release') return { data: { ok: true }, error: null }
      }
      return { data: true, error: null }
    }),
  }
}

function actDb(contentType: string) {
  const db = query([])
  db.from.mockImplementation((table: string) => {
    if (table === 'sms_messages') return query([{ id: 'msg' }]).from(table)
    if (table === 'home_check_photos') return query([]).from(table)
    if (table === 'home_checks') return query([{ ...pending }]).from(table)
    if (table === 'sms_conversations') return query([{ intake_state: {} }]).from(table)
    return query([]).from(table)
  })
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: contentType })
  return Object.assign(db, {
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readHomeCheckPhoto).mockResolvedValue({
    category: 'water_heater',
    photoView: { equipment: 'water_heater', framing: 'label_closeup', confidence: 'high' },
  } as never)
  vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({ feedback: [] } as never)
})

it('times phone-camera video gate and SMS attach vs JPEG', async () => {
  const gateVideoSamples: number[] = []
  const gateJpegSamples: number[] = []
  const attachVideoSamples: number[] = []
  const attachJpegSamples: number[] = []

  const gateOnce = (contentType: string, samples: number[]) => {
    const start = performance.now()
    const gate = gateHomeCheckSmsMedia({ contentType, sizeBytes: 2_000_000 })
    expect(gate.ok).toBe(true)
    samples.push(performance.now() - start)
  }

  const attachOnce = async (contentType: string, path: string, samples: number[]) => {
    const start = performance.now()
    const db = actDb(contentType)
    const result = await actHomeCheckSms(db as never, 'landlord', {
      kind: 'photo',
      check: pending as never,
      path,
      conversationId: 'conv',
    })
    expect(result.reply).not.toMatch(/JPEG, PNG or WebP/i)
    expect(result.reply).toBeTruthy()
    expect(readHomeCheckPhoto).toHaveBeenCalled()
    samples.push(performance.now() - start)
  }

  // Warmup
  gateOnce('video/mp4', gateVideoSamples)
  gateOnce('image/jpeg', gateJpegSamples)
  await attachOnce('video/mp4', 'sms/clip.mp4', attachVideoSamples)
  await attachOnce('image/jpeg', 'sms/a.jpg', attachJpegSamples)
  gateVideoSamples.length = 0
  gateJpegSamples.length = 0
  attachVideoSamples.length = 0
  attachJpegSamples.length = 0
  vi.clearAllMocks()
  vi.mocked(readHomeCheckPhoto).mockResolvedValue({
    category: 'water_heater',
    photoView: { equipment: 'water_heater', framing: 'label_closeup', confidence: 'high' },
  } as never)
  vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({ feedback: [] } as never)

  for (let i = 0; i < 40; i += 1) {
    gateOnce('video/mp4', gateVideoSamples)
    gateOnce('image/jpeg', gateJpegSamples)
    await attachOnce('video/mp4', 'sms/clip.mp4', attachVideoSamples)
    await attachOnce('image/jpeg', 'sms/a.jpg', attachJpegSamples)
  }

  const report = [
    summarize('SMS media gate video/mp4', gateVideoSamples),
    summarize('SMS media gate image/jpeg', gateJpegSamples),
    summarize('SMS single attach video/mp4 (mocked AI)', attachVideoSamples),
    summarize('SMS single attach image/jpeg (mocked AI)', attachJpegSamples),
  ]

  const out = {
    evidence:
      'In-process Home Check SMS video vs JPEG attach with mocked DB/storage/vision; excludes carrier and live Gemini',
    flows: report,
  }
  if (process.env.HOME_CHECK_PERF_REPORT) {
    writeFileSync(process.env.HOME_CHECK_PERF_REPORT, JSON.stringify(out, null, 2))
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2))

  for (const row of report) {
    if (row.flow.startsWith('SMS media gate')) expect(row.p95).toBeLessThan(5)
    else expect(row.p95).toBeLessThan(50)
  }
})
