import { resolveTenant } from './visitAct.ts'
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


function fixture(options: {foreign?:boolean;optedOut?:boolean;error?:boolean;count?:number}={}) {
 const tables:Record<string,any[]>={
  units:[{id:'unit',landlord_id:options.foreign?'other':'account',property_id:'property'}],
  occupancy:Array.from({length:options.count??1},(_,i)=>({resident_id:'resident'+i,landlord_id:'account',unit_id:'unit',property_id:null,status:'active'})),
  users:[{id:'resident0',landlord_id:'account',phone:'+19088843069',sms_consent_status:options.optedOut?'opted_out':'opted_in'}],
 }
 return {from(table:string){
  const filters:Array<[string,unknown]>=[]
  const result=()=>({data:(tables[table]??[]).filter(row=>filters.every(([key,value])=>row[key]===value)),error:options.error&&table==='occupancy'?{message:'injected failure'}:null})
  const q:any={select(){return q},eq(key:string,value:unknown){filters.push([key,value]);return q},then(resolve:any){return Promise.resolve(result()).then(resolve)},async maybeSingle(){const r=result();return {...r,data:r.data[0]??null}}}
  return q
 }}
}
const check={landlord_id:'account',property_id:'property',unit_id:'unit'}
it('resolves a tenant through the scoped unit when occupancy.property_id is null',async()=>{
 expect(await resolveTenant(fixture() as never,check as never)).toEqual({id:'resident0',phone:'+19088843069'})
})
it('rejects a unit from another account even when an occupancy row has a matching unit id',async()=>{
 await expect(resolveTenant(fixture({foreign:true}) as never,check as never)).rejects.toThrow('verify')
})
it('does not turn a lookup error into a missing-tenant fallback',async()=>{
 await expect(resolveTenant(fixture({error:true}) as never,check as never)).rejects.toThrow('load')
})
it('respects tenant opt-out',async()=>{
 expect(await resolveTenant(fixture({optedOut:true}) as never,check as never)).toBeNull()
})
it.each([0,2])('does not guess among %s active occupancies',async count=>{
 expect(await resolveTenant(fixture({count}) as never,check as never)).toBeNull()
})

const sent: Array<{phone:string;body:string}>=[]
