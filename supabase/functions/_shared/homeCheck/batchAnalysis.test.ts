import { afterEach, expect, it, vi } from 'vitest'
import { analyzeHomeCheckBatch, uploadHomeCheckPhoto } from './service.ts'
import { analyzeHomeCheckEquipmentPair } from './equipmentPair.ts'
import { processInspectionUpload } from '../vision/ingestInspectionUpload.ts'
vi.mock('./equipmentPair.ts', () => ({ analyzeHomeCheckEquipmentPair: vi.fn() }))
vi.mock(
  '../vision/ingestInspectionUpload.ts',
  () => ({ inspectionBytesToBase64: vi.fn(), processInspectionUpload: vi.fn() }),
)
vi.mock(
  '../engine/workflowRuns.ts',
  () => ({ logPipelineStageEvent: vi.fn(), updateWorkflowRun: vi.fn() }),
)
vi.mock(
  '../engine/startMaintenanceRequestWorkflow.ts',
  () => ({ startMaintenanceRequestWorkflow: vi.fn() }),
)
vi.mock('../uloAppUrl.ts', () => ({ uloAppOrigin: () => 'https://app.ulohome.io' }))
vi.mock(
  '../sms/inbound_db.ts',
  () => ({
    normalizeSmsPhone: (phone: string) => phone,
    findOrCreateConversation: vi.fn(async () => ({ conversationId: 'thread' })),
  }),
)
vi.mock(
  '../sms/inboundReply.ts',
  () => ({
    sendInboundAutoReply: vi.fn(async () => ({
      ok: true,
      messageId: 'sent',
      providerMessageSid: 'fixture',
    })),
  }),
)
vi.mock(
  '../sms/landlordSmsOnboarding.ts',
  () => ({
    resolveOutboundLandlordSmsLine: vi.fn(async () => ({ id: 'line', phone: '+15550001111' })),
  }),
)
vi.mock(
  '../sms/landlordAccountPhone.ts',
  () => ({ isLandlordAccountOrOpsPhone: vi.fn(async () => true) }),
)


const check = { id: 'check', landlord_id: 'disposable', role: 'contractor', property_label: 'Test',
  status: 'completed', confirmed_at: null, expires_at: '2027-01-01T00:00:00Z', answers: {} }
const slots = ['water_heater_label', 'water_heater_whole', 'heating_label', 'heating_whole']
function client(overrides = {}, received = slots) {
  const calls: unknown[][] = [], updates: unknown[] = []
  const rpc = vi.fn(async () => ({ data: true, error: null }))
  return { calls, updates, rpc, from(table: string) {
    let mutation = false
    const data = () => mutation ? null : table === 'home_checks' ? { ...check, ...overrides }
      : table === 'home_check_photos' ? received.map((slot, i) => ({ slot, inspection_photo_id: `photo-${i}`, storage_path: `test/${i}` }))
      : []
    const b: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: data(), error: null })) }
    for (const method of ['select', 'eq', 'in']) b[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return b }
    b.update = (value: unknown) => { mutation = true; updates.push(value); return b }
    b.single = () => b
    return b
  } }
}
const reading = (description: string) => ({ deficiencies: [{severity: 'repair_recommended', description}] }) as never

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('overlaps the two scoped readings, combines both warnings, and persists once after the slower reading', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T16:00:00Z'))
  const db = client(), events: unknown[] = []
  vi.mocked(analyzeHomeCheckEquipmentPair).mockImplementation(async (_db, id, slot) => {
    expect(id).toBe('check')
    await new Promise(resolve => setTimeout(resolve, slot === 'water_heater_whole' ? 26000 : 20000))
    return reading(slot === 'water_heater_whole' ? 'Water heater has a visible leak.' : 'Heating system has a visible leak.')
  })
  let done = false
  const job = analyzeHomeCheckBatch(db as never, check as never, e => events.push(e)).then(value => { done = true; return value })
  await vi.advanceTimersByTimeAsync(0)
  expect(analyzeHomeCheckEquipmentPair).toHaveBeenCalledTimes(2)
  expect(analyzeHomeCheckEquipmentPair).toHaveBeenNthCalledWith(1, db, 'check', 'water_heater_whole')
  expect(analyzeHomeCheckEquipmentPair).toHaveBeenNthCalledWith(2, db, 'check', 'heating_whole')
  await vi.advanceTimersByTimeAsync(20000)
  expect(done).toBe(false); expect(db.rpc).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(6000)
  await job
  expect(done).toBe(true)
  expect(db.updates).toEqual([{ detected_warning: 'Water heater has a visible leak.; Heating system has a visible leak.' }])
  expect(db.rpc).toHaveBeenCalledTimes(1)
  expect(db.rpc).toHaveBeenCalledWith('persist_home_check_assets', expect.objectContaining({p_check_id: 'check'}))
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({system: 'water_heater', outcome: 'success'}),
    expect.objectContaining({system: 'heating', outcome: 'success'}),
  ]))
  expect(JSON.stringify(events)).not.toMatch(/visible leak|corrosion|photo-|disposable/)
  expect(db.calls).toContainEqual(['home_checks','eq','landlord_id','disposable'])
})
it('waits for the other reading after a rejection and does not persist a misleading combined summary', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-04T16:00:00Z'))
  const db = client(), events: unknown[] = []
  vi.mocked(analyzeHomeCheckEquipmentPair).mockImplementation(async (_db, _id, slot) => {
    if (slot === 'water_heater_whole') throw Error('Simulated unavailable reader')
    await new Promise(resolve => setTimeout(resolve, 1000)); return reading('Visible corrosion.')
  })
  let done = false
  const job = analyzeHomeCheckBatch(db as never, check as never, e => events.push(e)).catch(e => { done = true; return e })
  await vi.advanceTimersByTimeAsync(0)
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(await job).toBeInstanceOf(Error)
  expect(events).toHaveLength(2); expect(db.rpc).not.toHaveBeenCalled()
})
it.each([{confirmed_at: '2026-11-04'}, {role: 'tenant'}, {expires_at: '2020-01-01'}])('rejects an ended or non-batch check before calling AI (%j)', async overrides => {
  await expect(analyzeHomeCheckBatch(client(overrides) as never, check as never)).rejects.toThrow('ended')
  expect(analyzeHomeCheckEquipmentPair).not.toHaveBeenCalled()
})
it('does not analyze incomplete attachments', async () => {
  await expect(analyzeHomeCheckBatch(client({}, slots.slice(0, 3)) as never, check as never)).rejects.toThrow('All four')
  expect(analyzeHomeCheckEquipmentPair).not.toHaveBeenCalled()
})
it('rejects deferred tenant uploads before storing a photo', async () => {
  await expect(uploadHomeCheckPhoto(client() as never, {...check,role:'tenant'} as never, {
    slot:'water_heater_label',bytes:new Uint8Array([1]),contentType:'image/jpeg',source:'photo_text',
    deferEquipmentAnalysis:true,skipOutreach:true,capture:{conversationId:'test',claim:'claim'},
  })).rejects.toThrow('four-photo batch')
  expect(processInspectionUpload).not.toHaveBeenCalled()
})
it('allows deferred landlord batch uploads before analysis', async () => {
  const db = client()
  vi.mocked(processInspectionUpload).mockResolvedValueOnce({photo:{id:'new-photo',storage_path:'test/new'}} as never)
  await uploadHomeCheckPhoto(db as never, {...check,role:'landlord'} as never, {
    slot:'water_heater_label',bytes:new Uint8Array([1]),contentType:'image/jpeg',source:'photo_text',
    deferEquipmentAnalysis:true,skipOutreach:true,capture:{conversationId:'landlord-thread',claim:'claim'},
  })
  expect(analyzeHomeCheckEquipmentPair).not.toHaveBeenCalled()
  expect(db.rpc).toHaveBeenCalledWith('record_home_check_sms_photo',expect.objectContaining({p_check_id:'check',p_claim:'claim',p_conversation_id:'landlord-thread'}))
})

it('attaches a vendor photo without invoking AI or rebuilding assets before the batch is complete', async () => {
  const db = client()
  vi.mocked(processInspectionUpload).mockResolvedValueOnce({photo:{id:'new-photo',storage_path:'test/new'}} as never)
  await uploadHomeCheckPhoto(db as never, check as never, {
    slot:'water_heater_label',bytes:new Uint8Array([1]),contentType:'image/jpeg',source:'photo_text',
    deferEquipmentAnalysis:true,skipOutreach:true,capture:{conversationId:'vendor-thread',claim:'claim'},
  })
  expect(analyzeHomeCheckEquipmentPair).not.toHaveBeenCalled()
  expect(db.rpc).toHaveBeenCalledTimes(1)
  expect(db.rpc).toHaveBeenCalledWith('record_home_check_sms_photo',expect.objectContaining({p_check_id:'check',p_claim:'claim',p_conversation_id:'vendor-thread'}))
})
it('does not let a failed timing observer fail the equipment analysis', async () => {
  vi.mocked(analyzeHomeCheckEquipmentPair).mockResolvedValue(reading('No defects.'))
  await expect(analyzeHomeCheckBatch(client() as never, check as never, () => { throw Error('logging failed') })).resolves.toMatchObject({id:'check'})
})
