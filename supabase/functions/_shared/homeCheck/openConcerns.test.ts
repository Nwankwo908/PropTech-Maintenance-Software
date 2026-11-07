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


beforeEach(()=>{vi.clearAllMocks();vi.mocked(uploadHomeCheckPhoto).mockResolvedValue({feedback:[]} as never)})
it('asks only about the explicit requested step after an inconclusive reading',async()=>{
 vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:'unknown',photoView:{equipment:'unknown',framing:'unknown',confidence:'low'}})
 const db=actDb([])
 const result=await actHomeCheckSms(db as never,'landlord',{kind:'photo',check:pending as never,slot:'heating_label',expectedVersion:'version',path:'sms/a.jpg',conversationId:'conv'})
 expect(result.reply).toContain('Is this the furnace or boiler label')
 expect(result.reply).toContain('Reply YES or NO');expect(result.reply).not.toContain('1) Water heater')
 expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
 expect(db.rpc).toHaveBeenCalledWith('hold_home_check_sms_photo',expect.objectContaining({p_pending:expect.objectContaining({expectedSlot:'heating_label',checkId:'check',path:'sms/a.jpg'})}))
})
function heldDb(open=[pending],expectedSlot='heating_label'){
 const held={step:'kind',checkId:'check',path:'sms/held.jpg',at:new Date().toISOString(),expectedSlot}
 const db=query([]);db.from.mockImplementation(table=>query(table==='sms_conversations'?[{intake_state:{home_check_photo_pending:held}}]:open).from(table));return db
}
it('YES assigns only the retained photo to its accessible check and remembered step',async()=>{
 expect(await prepareHomeCheckSms(context(heldDb(),'YES'))).toMatchObject({kind:'photo',check:{id:'check'},slot:'heating_label',path:'sms/held.jpg'})
})
it('NO retains the photo and offers choices without assigning it',async()=>{
 const db=heldDb();expect(await prepareHomeCheckSms(context(db,'NO'))).toMatchObject({kind:'clarify',reply:expect.stringContaining('What does this photo show?')})
 expect(db.rpc).toHaveBeenCalledWith('hold_home_check_sms_photo',expect.objectContaining({p_pending:expect.not.objectContaining({expectedSlot:expect.anything()})}))
})
it('an ended or inaccessible check cannot accept the retained photo',async()=>{
 expect(await prepareHomeCheckSms(context(heldDb([]),'YES'))).toMatchObject({kind:'clarify',reply:expect.stringContaining('has ended')})
})
it('a positively recognized conflicting appliance still needs a choice rather than a suggested slot',async()=>{
 vi.mocked(readHomeCheckPhoto).mockResolvedValueOnce({category:'water_heater',photoView:{equipment:'water_heater',framing:'whole_appliance',confidence:'high'}})
 const result=await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'photo',check:pending as never,slot:'heating_label',expectedVersion:'version',path:'sms/a.jpg',conversationId:'conv'})
 expect(result.reply).toContain('What does this photo show?');expect(result.reply).not.toContain('Reply YES or NO');expect(uploadHomeCheckPhoto).not.toHaveBeenCalled()
})
it('routing telemetry records only bounded timing and status fields and never breaks classification',async()=>{
 vi.mocked(readHomeCheckPhoto).mockImplementationOnce(async(_bytes,_mime,observe)=>{observe?.({provider:'openai',outcome:'success',phase:'complete',durationMs:245,status:200});return {category:'hvac',photoView:{equipment:'heating_system',framing:'label_closeup',confidence:'high'}} as never})
 vi.mocked(homeCheckEvent).mockRejectedValueOnce(Error('telemetry unavailable'))
 await actHomeCheckSms(actDb([]) as never,'landlord',{kind:'photo',check:pending as never,slot:'heating_label',expectedVersion:'version',path:'sms/PRIVATE_PATH.jpg',conversationId:'conv'})
 expect(uploadHomeCheckPhoto).toHaveBeenCalled();const event=vi.mocked(homeCheckEvent).mock.calls.find(c=>c[2]==='photo_routing_read')!
 expect(event[3]).toMatchObject({expectedSlot:'heating_label',placedSlot:'heating_label',attempts:[{provider:'openai',outcome:'success',durationMs:245}]})
 expect(JSON.stringify(event[3])).not.toContain('PRIVATE_PATH')
})
