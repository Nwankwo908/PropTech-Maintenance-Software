import { expect, it, vi } from 'vitest'
import { guidedBurstReply } from './guidedBurst.ts'
const input={landlordId:'account',conversationId:'thread',from:'+14705246084',to:'+18775803356',path:'first',reply:'Saved the water heater label. Next: whole water heater.'}
function fixture(media:unknown[]){
 const filters:any[]=[];const q:any={};for(const m of ['select','eq','contains','order','limit','gte','lte'])q[m]=(...a:any[])=>{filters.push([m,...a]);return q}
 q.maybeSingle=async()=>({data:{created_at:new Date().toISOString()},error:null})
 q.then=(r:any)=>Promise.resolve(r({data:media.map(media_urls=>({media_urls})),error:null}))
 return {db:{from:vi.fn(()=>q)},filters}
}
it('explains that extra burst photos are retained but not assigned',async()=>{
 const f=fixture([['first'],['second']]);const reply=await guidedBurstReply(f.db as never,input)
 expect(reply).toContain('Extra photos remain in this conversation but haven’t been assigned')
 expect(reply).toContain(input.reply)
 for(const [k,v] of [['landlord_id','account'],['conversation_id','thread'],['from_number',input.from],['to_number',input.to]])expect(f.filters).toContainEqual(['eq',k,v])
})
it('does not add a burst warning for a duplicate delivery or a normal single photo',async()=>{
 expect(await guidedBurstReply(fixture([['first'],['first']]).db as never,input)).toBe(input.reply)
})
