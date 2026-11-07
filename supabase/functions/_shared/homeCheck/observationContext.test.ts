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


const owner={...pending,id:'own100',role:'landlord',property_label:'100 Test Lane',completed_at:'2026-11-06T00:00:00Z',confirmed_at:null,expires_at:'2099-01-01',status:'completed',answers:{warningSigns:null}}
const tenant={...owner,id:'tenant200',role:'tenant',recipient_phone:'+15559990000',property_label:'200 Test Lane',answers:{warningSigns:false,observationsConfirmed:true}}
function routedDb(options:any={}){
 const latest={id:'summary200',body:'Results: 200 Test Lane. The tenant reported no leaks. Reply OK.',raw_payload:{source:'home_check'},provider_status:'delivered',from_number:pending.ulo_number,to_number:pending.recipient_phone,...options.latest}
 const state={home_check_results_review:{ids:['tenant200'],selectedId:'tenant200',summaryMessageId:'summary200',expiresAt:'2099-01-01',...options.review}}
 const mutations:any[]=[];const db:any={rpc:vi.fn(async()=>({data:null,error:null})),from(table:string){let filters:any[]=[];let single=false;const q:any={then(resolve:any){let rows:any=table==='home_check_sms_capture_sessions'?(options.noCapture?[]:[{check_id:'own100',expected_slot:null,version:'v',expires_at:'2099-01-01'}]):table==='sms_conversations'?[{intake_state:state}]:table==='home_checks'?[{...owner,...options.owner},{...tenant,...options.tenant}]:table==='sms_messages'?[latest]:[];for(const [m,key,value] of filters){if(m==='eq'&&key==='id'&&table==='home_checks')rows=rows.filter((x:any)=>x.id===value);if(m==='eq'&&key==='recipient_phone'&&table==='home_checks')rows=rows.filter((x:any)=>x.recipient_phone===value)}return Promise.resolve(resolve({data:single?rows[0]??null:rows,error:null}))}};for(const m of ['select','eq','in','is','gt','not','order','limit'])q[m]=(...args:any[])=>{filters.push([m,...args]);return q};q.maybeSingle=()=>{single=true;return q};q.update=(data:any)=>{mutations.push(data);return q};return q}};return {db,mutations}
}
describe('landlord observations after another property Results',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(isLandlordAccountOrOpsPhone).mockResolvedValue(true)})
 it.each([['NONE',false],['NO',false],['UNSURE',null],['YES small drip',true]])('routes %s only to the explicit unfinished landlord capture',async(body,warning)=>{
  const {db,mutations}=routedDb();const result=await prepareHomeCheckSms(context(db,body as string,[],true));expect(result).toMatchObject({kind:'answers',check:{id:'own100'},answers:{warningSigns:warning,observationsConfirmed:true}});expect(mutations).toEqual([]);expect(tenant.answers.warningSigns).toBe(false)
 })
 it('asks for details on YES rather than recording a blank warning',async()=>{const {db}=routedDb();expect(await prepareHomeCheckSms(context(db,'YES',[],true))).toMatchObject({kind:'clarify',reply:expect.stringContaining('For example')})})
 it('does not borrow a different unanswered summary even if its body contains the observation question',async()=>{
  const {db}=routedDb({tenant:{answers:{warningSigns:null}},latest:{body:'Results: 200 Test Lane. Any leaks, unusual noises or smells?'}});const result=await prepareHomeCheckSms(context(db,'NONE',[],true));expect(result).toMatchObject({kind:'clarify',reply:expect.stringContaining('100 Test Lane')});expect(result?.kind).not.toBe('answers')
 })
 it.each([{review:{summaryMessageId:'old'}},{review:{expiresAt:'2000-01-01'}}])('stale Results context requires explicit clarification',async(options)=>{const {db}=routedDb(options);expect(await prepareHomeCheckSms(context(db,'NONE',[],true))).toMatchObject({kind:'clarify'})})
 it.each([{latest:{raw_payload:{source:'other_workflow'}}},{latest:{provider_status:'failed'}},{latest:{from_number:'+15557770000'}},{latest:{to_number:'+15557770000'}},{latest:{body:'Can the vendor visit now? Reply YES or NO.'}},{noCapture:true},{owner:{confirmed_at:'2026-11-06'}}])('does not save an observation without valid current capture and summary provenance',async(options)=>{const {db}=routedDb(options);expect((await prepareHomeCheckSms(context(db,'NONE',[],true)))?.kind).not.toBe('answers')})
})
