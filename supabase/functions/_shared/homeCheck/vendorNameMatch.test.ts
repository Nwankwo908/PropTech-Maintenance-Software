import { expect, it, vi } from 'vitest'
import { matchHomeCheckVendorNames } from './vendorNameMatch.ts'
import { reduceHomeCheckGuide } from './guide.ts'
vi.mock('../vendor_availability_parse.ts',()=>({parseAvailabilityResolved:vi.fn()}))
vi.mock('../sms/inboundInterpretation.ts',()=>({accessInstructionKind:vi.fn()}))
vi.mock('../sms/residentIntakeTypes.ts',()=>({isAffirmativeReply:(body:string)=>/^(yes|y|yep)$/i.test(body)}))
const roster=[{id:'test',name:'Disposable test vendor',distanceKm:null},{id:'other',name:'River Plumbing',distanceKm:2}]
it.each(['disposble test vendor','vendor test disposable','please use disposabel vendor','DISPOSABLE TEST VENDOR','can you use disposble vendor'])('recognizes %s from this roster',body=>{
 expect(matchHomeCheckVendorNames(body,roster).map(v=>v.id)).toEqual(['test'])
})
it('handles punctuation and reversed company words',()=>{
 expect(matchHomeCheckVendorNames('Plumbing, Rvier!',roster).map(v=>v.id)).toEqual(['other'])
})
it('returns both similar vendors instead of silently choosing one',()=>{
 expect(matchHomeCheckVendorNames('river',[...roster,{id:'another',name:'River Heating'}])).toHaveLength(2)
})
it('never invents or retrieves an out-of-account vendor',()=>{
 expect(matchHomeCheckVendorNames('Acme Plumbing',roster)).toEqual([])
 expect(matchHomeCheckVendorNames('Disposable',[])).toEqual([])
})
it.each(['not River Plumbing','do not use River','vendor','123','x'.repeat(161)])('rejects ambiguous or unsuitable input %s',body=>{
 expect(matchHomeCheckVendorNames(body,roster)).toEqual([])
})
const state={step:'pick_contractor',role:'contractor',updatedAt:new Date().toISOString(),propertyId:'property',placeLabel:'Disposable Test Lane'}
const catalog={properties:[],vendors:roster,tenant:null}
function turn(body:string,current:any=state, vendors=roster){return reduceHomeCheckGuide({body,state:current,catalog:{...catalog,vendors},now:new Date(),sender:'landlord' } as never)}
it('asks for confirmation before any selection effect, then resumes the existing flow',()=>{
 const suggested=turn('vendor test disposble')
 expect(suggested.replies[0]).toContain('Did you mean Disposable test vendor?')
 expect(suggested.effects).toEqual([])
 const confirmed=turn('YES',suggested.state)
 expect(confirmed.state?.vendorId==='test'||confirmed.effects.some((effect:any)=>effect.vendorId==='test')).toBe(true)
})
it('NO clears the proposed vendor without sending anything',()=>{
 const rejected=turn('NO',turn('disposable').state)
 expect(rejected.effects).toEqual([])
 expect(rejected.state?.vendorConfirmId).toBeUndefined()
})
it('persists ambiguity choices and confirms the chosen account-scoped vendor',()=>{
 const vendors=[...roster,{id:'another',name:'River Heating',distanceKm:1}]
 const list=turn('river',state,vendors)
 expect(list.state?.vendorChoices).toEqual(['other','another'])
 const chosen=turn('2',list.state,vendors)
 expect(chosen.state?.vendorConfirmId).toBe('another')
 expect(chosen.effects).toEqual([])
 const invalid=turn('9',list.state,vendors)
 expect(invalid.effects).toEqual([])
 expect(invalid.state?.vendorConfirmId).toBeUndefined()
})
it('cannot confirm a vendor removed from the eligible roster',()=>{
 const result=turn('YES',turn('disposable').state,[])
 expect(result.effects).toEqual([])
 expect(result.replies[0]).toContain('no longer available')
})
