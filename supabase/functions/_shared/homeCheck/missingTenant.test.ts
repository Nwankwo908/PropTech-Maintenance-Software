import { parseAvailabilityResolved } from '../vendor_availability_parse.ts'
import { expect, it, vi } from 'vitest'
import { reduceHomeCheckGuide } from './guide.ts'
vi.mock('../vendor_availability_parse.ts',()=>({parseAvailabilityResolved:vi.fn()}))
const now=new Date('2026-11-01T17:00:00Z')
const state={step:'awaiting_landlord',role:'contractor',updatedAt:now.toISOString(),propertyId:'test-property',vendorId:'test-vendor',vendorName:'Test Vendor',windowLabel:'Today 2–4pm',windowEnd:'2026-11-01T21:00:00Z',handoffReason:'opted_out'}
const catalog={properties:[],vendors:[{id:'test-vendor',name:'Test Vendor',distanceKm:null}],tenant:null}
function turn(body:string, patch:Record<string,unknown>={},tenant:any=null){return reduceHomeCheckGuide({state:{...state,...patch} as never,body,sender:'landlord',catalog:{...catalog,tenant},now})}
it('explains the missing contact without telling the landlord to call a nonexistent tenant',()=>{
 const result=turn('what next')
 expect(result.replies[0]).toContain('No tenant contact is linked')
 expect(result.replies[0]).toContain('Can you arrange access for Today 2–4pm?')
 expect(result.replies[0]).not.toMatch(/call|can.t text|opted out/i)
 expect(result.effects).toEqual([])
})
it('recovers the existing mislabeled handoff and accepts explicit landlord access confirmation',()=>{
 const result=turn('YES')
 expect(result.effects).toHaveLength(1)
 expect(result.effects[0]).toMatchObject({type:'send_contractor',vendorId:'test-vendor',tenantPhone:null,tenantBody:null})
})
it('NO does not send instructions or contact anyone',()=>{
 const result=turn('NO')
 expect(result.effects).toEqual([])
 expect(result.replies[0]).toContain('when you can arrange access')
})
it('never confirms a past window',()=>{
 const result=turn('YES',{windowEnd:'2026-11-01T16:00:00Z'})
 expect(result.effects).toEqual([])
 expect(result.state?.step).toBe('pick_window')
})
it('distinguishes a known tenant with a missing SMS number',()=>{
 const result=turn('what next',{}, {name:'Test Tenant',phone:null,optedOut:false})
 expect(result.replies[0]).toContain('There is no SMS number for Test Tenant')
 expect(result.effects).toEqual([])
})
it('does not convert an actual tenant opt-out into automatic owner-access approval',()=>{
 const result=turn('YES',{}, {name:'Test Tenant',phone:'+15550000000',optedOut:true})
 expect(result.effects).toEqual([])
 expect(result.replies[0]).not.toContain('No tenant contact')
})

it('asks for owner-arranged access on the first valid window when no tenant is linked',()=>{
 vi.mocked(parseAvailabilityResolved).mockReturnValueOnce({scheduledAt:'2026-11-01T19:00:00Z',endAt:state.windowEnd,windowLabel:state.windowLabel} as never)
 const result=turn('Today 2-4pm',{step:'pick_window'})
 expect(result.state?.handoffReason).toBe('no_tenant')
 expect(result.replies[0]).toContain('No tenant contact is linked')
 expect(result.effects).toEqual([])
})
it('retains normal tenant scheduling when a reachable tenant is linked',()=>{
 vi.mocked(parseAvailabilityResolved).mockReturnValueOnce({scheduledAt:'2026-11-01T19:00:00Z',endAt:state.windowEnd,windowLabel:state.windowLabel} as never)
 const result=turn('Today 2-4pm',{step:'pick_window'},{name:'Test Tenant',phone:'+15550000000',optedOut:false})
 expect(result.state?.step).toBe('awaiting_tenant')
 expect(result.effects[0]).toMatchObject({type:'text_tenant',phone:'+15550000000'})
})

it('preserves opt-out status even when the tenant phone is missing',()=>{
 vi.mocked(parseAvailabilityResolved).mockReturnValueOnce({scheduledAt:'2026-11-01T19:00:00Z',endAt:state.windowEnd,windowLabel:state.windowLabel} as never)
 const result=turn('Today 2-4pm',{step:'pick_window'},{name:'Test Tenant',phone:null,optedOut:true})
 expect(result.state?.handoffReason).toBe('opted_out')
 expect(result.effects).toEqual([])
})

it('keeps the scheduling confirmation focused on the visit and vendor instructions',()=>{
 const result=turn('YES')
 expect(result.replies[0]).toContain('accept the Home Check')
 expect(result.replies[0]).toContain('before confirming the schedule')
 expect(result.replies[0]).not.toContain('sent the photo instructions')
 expect(result.replies[0]).not.toContain('No repairs are authorized')
})
