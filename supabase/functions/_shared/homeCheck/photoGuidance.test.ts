vi.mock('../vendor_availability_parse.ts',()=>({parseAvailabilityResolved:vi.fn()}))
import { reduceHomeCheckGuide } from './guide.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  actHomeCheckSms,
  prepareHomeCheckSms,
  resolveHomeCheckLandlord,
  runHomeCheckReminder,
} from './sms.ts'
import { homeCheckEvent, createHomeCheck, sendHomeCheckSms, uploadHomeCheckPhoto, analyzeHomeCheckBatch, saveHomeCheckAnswers, pendingHomeCheckSystems, notifyHomeCheckResult, confirmHomeCheck, loadHomeCheck } from './service.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'

vi.mock('../sms/inbound_db.ts', () => ({ normalizeSmsPhone: (phone: string) => phone }))
vi.mock('./visitAct.ts', () => ({
  prepareHomeCheckVisitReply: vi.fn(async () => null),
  applyHomeCheckVisitReply: vi.fn(async () => ''),
  startDueHomeCheckPhotoPrompts: vi.fn(async () => 0),
  sendHomeCheckVendorAcceptance: vi.fn(async () => ({ deliveryError: null, alreadySent: false })),
}))
vi.mock('./photoSlot.ts', () => ({ readHomeCheckPhoto: vi.fn(async () => null) }))
vi.mock(
  '../sms/landlordAccountPhone.ts',
  () => ({ isLandlordAccountOrOpsPhone: vi.fn(async () => true) }),
)
vi.mock('./service.ts', () => ({
  homeCheckEvent: vi.fn(async () => {}),
  requireData: ({ data, error }: { data: unknown; error: unknown }) => {
    if (error) throw error
    return data
  },
  checkLocation: (check: { property_label: string; unit_label: string }) =>
    `${check.property_label} / ${check.unit_label}`,
  checked: (value: PromiseLike<unknown>) => Promise.resolve(value),
  sendHomeCheckSms: vi.fn(async () => {}),
  confirmHomeCheck: vi.fn(async () => {}),
  loadHomeCheck: vi.fn(async () => ({...pending,confirmed_at:null})),
  pendingHomeCheckSystems: vi.fn(async () => []),
  saveHomeCheckAnswers: vi.fn(async () => true),
  notifyHomeCheckResult: vi.fn(async () => true),
  rebuildHomeCheckAssets: vi.fn(async () => []),
  uploadHomeCheckPhoto: vi.fn(async () => ({ feedback: [] })),
  analyzeHomeCheckBatch: vi.fn(async () => ({ feedback: [] })),
  createHomeCheck: vi.fn(async () => ({
    check: { ...pending, role: 'landlord', workflow_run_id: 'run' },
    link: 'https://app.ulohome.io/c/check#fixture',
    deliveryError: null,
  })),
}))
function query(data: unknown) {
  const filters: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve(resolve({ data, error: null })),
  }
  for (const method of ['select', 'eq', 'in', 'gt', 'not', 'is', 'update', 'contains', 'limit', 'order']) {
    builder[method] = (...args: unknown[]) => {
      filters.push([method, args])
      return builder
    }
  }
  builder.maybeSingle = () =>
    Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null })
  builder.single = builder.maybeSingle
  return { from: vi.fn(() => builder), filters, rpc: vi.fn(async () => ({ data: true as unknown, error: null })) }
}
function actDb(photoSlots: string[]) {
  const updates: unknown[] = []
  const base = query([])
  base.from.mockImplementation((table: string) => {
    const q = query(table === 'home_check_photos' ? photoSlots.map((slot) => ({ slot })) : table === 'sms_messages' ? [{ id: 'incoming' }] : [{ intake_state: {} }]).from(table) as Record<string, unknown>
    const update = q.update as (...args: unknown[]) => unknown
    q.update = (value: unknown) => {
      updates.push(value)
      return update(value)
    }
    return q
  })
  base.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'hold_home_check_sms_photo') { updates.push({ intake_state: { home_check_photo_pending: args.p_pending } }); return { data: true, error: null } }
    return { data: { ok: true, checkId: 'check', slot: 'water_heater_label', version: 'version', claim: 'claim' }, error: null }
  })
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  return Object.assign(base, {
    updates,
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
  })
}
const pending = {
  id: 'check',
  reference: 'HC-AABBCCDDEEFF',
  property_label: 'Birch',
  unit_label: '12A',
  landlord_id: 'landlord',
  recipient_phone: '+15551112222',
  ulo_number: '+15550001111',
  role: 'contractor',
  status: 'collecting',
}
function context(
  db: ReturnType<typeof query>,
  body: string,
  mediaUrls: string[] = [],
  landlord = false,
): InboundSmsHandlerContext {
  return {
    supabase: db,
    landlordId: 'landlord',
    messageId: 'message',
    conversationId: 'conv',
    identity: { identity_type: landlord ? 'landlord' : 'vendor' },
    inbound: { body, mediaUrls, from: '+15551112222', to: '+15550001111' },
  } as unknown as InboundSmsHandlerContext
}

describe('guided photo framing dispatch',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({feedback:[]} as never)})
 const cases=[['water_heater_label','water_heater','label_closeup'],['water_heater_whole','water_heater','whole_appliance'],['heating_label','heating_system','label_closeup'],['heating_whole','heating_system','whole_appliance']] as const
 it.each(cases)('saves confident %s directly in the selected check without a numbered menu',async(slot,equipment,framing)=>{
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:equipment==='water_heater'?'water_heater':'hvac',photoView:{equipment,framing,confidence:'high'}})
  const db=actDb([])
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot,expectedVersion:'version',path:'sms/a.jpg',conversationId:'conv'})
  expect(uploadHomeCheckPhoto).toHaveBeenCalledWith(db,expect.objectContaining({id:'check'}),expect.objectContaining({slot,capture:{conversationId:'conv',claim:'claim'}}))
  expect(result.reply).not.toContain('What does this photo show')
  expect(db.rpc.mock.calls.filter(([name,args])=>name==='hold_home_check_sms_photo' && args.p_pending!==null)).toHaveLength(0)
  expect(db.rpc).toHaveBeenCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'claim',p_check_id:'check',p_slot:slot,p_version:'version'}))
 })
 it.each([null,{category:'water_heater',photoView:{equipment:'water_heater',framing:'whole_appliance',confidence:'low'}},{category:'hvac',photoView:{equipment:'heating_system',framing:'label_closeup',confidence:'high'}}])('holds unavailable, uncertain or conflicting views without guessing',async reading=>{
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce(reading as never)
  const db=actDb([]);const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_whole',expectedVersion:'version',path:'sms/a.jpg',conversationId:'conv'})
  expect(uploadHomeCheckPhoto).not.toHaveBeenCalled();expect(result.reply).toMatch(/What does this photo show|Is this the whole water heater/)
  expect(db.rpc).toHaveBeenCalledWith('hold_home_check_sms_photo',expect.objectContaining({p_landlord_id:'landlord',p_conversation_id:'conv',p_pending:expect.objectContaining({checkId:'check',path:'sms/a.jpg'})}))
 })
 it('rejects foreign media before classification',async()=>{
  const db=actDb([]);db.from.mockImplementation(table=>query(table==='sms_messages'?[]:[]).from(table))
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_label',expectedVersion:'version',path:'foreign/a.jpg',conversationId:'conv'})
  expect(result.reply).toContain('could not verify');expect(readHomeCheckPhoto).not.toHaveBeenCalled();expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 })
 it('rejects a stale capture version after recognition rather than assigning elsewhere',async()=>{
  vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:'water_heater',photoView:{equipment:'water_heater',framing:'whole_appliance',confidence:'high'}})
  const db=actDb([]);db.rpc.mockResolvedValue({data:{ok:false},error:null} as never)
  const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'water_heater_whole',expectedVersion:'stale',path:'sms/a.jpg',conversationId:'conv'})
  expect(result.reply===undefined || result.reply.includes('step changed')).toBe(true);expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 })
})

it('unverified appliance type asks for the whole view, not another label or a false mismatch',async()=>{
 vi.clearAllMocks();vi.mocked(uploadHomeCheckPhoto).mockResolvedValueOnce({feedback:[{slot:'heating_label',retakeReason:'system_unverified',retakeMessage:'Please send a clearer overview'}]} as never)
 const db=actDb([]);const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'heating_whole',path:'sms/a.jpg',conversationId:'conv'})
 expect(result.reply).toContain('could not verify the appliance type');expect(result.reply).not.toContain('different equipment');expect(result.reply).not.toContain('label clearly');expect(db.rpc).toHaveBeenLastCalledWith('home_check_sms_capture_context',expect.objectContaining({p_action:'bind',p_slot:'heating_whole'}))
})
