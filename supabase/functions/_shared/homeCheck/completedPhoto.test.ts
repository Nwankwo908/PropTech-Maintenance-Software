import { expect, it, vi } from 'vitest'
import { prepareCompletedPhoto, actCompletedPhoto, type CompletedPhotoAction } from './completedPhoto.ts'
vi.mock('../sms/inbound_db.ts',()=>({normalizeSmsPhone:(p:string)=>p}))
const KEY='home_check_completed_photo'
const PHOTO='sms/disposable/original.jpg'
function fixture() {
 const check={id:'check',role:'contractor',landlord_id:'account',recipient_phone:'+15550000001',ulo_number:'+15550000002',vendor_id:'vendor',status:'confirmed',confirmed_at:new Date(Date.now()-3600000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),property_label:'Internal title · 100 Test Lane',unit_label:null}
 const tables:Record<string,any[]>={home_checks:[check],sms_conversations:[{id:'thread',landlord_id:'account',external_phone_number:'+15550000001',intake_state:{unrelated:'keep'}}],home_check_sms_capture_sessions:[{landlord_id:'account',conversation_id:'thread',check_id:'check',version:'v',expected_slot:null,expires_at:new Date(Date.now()-3600000).toISOString()}],sms_messages:[{id:'photo',landlord_id:'account',conversation_id:'thread',direction:'inbound',from_number:'+15550000001',to_number:'+15550000002',media_urls:[PHOTO]}],home_check_events:[],maintenance_requests:[{id:'3b0047aa-1111-4222-8333-444444444444',landlord_id:'account',assigned_vendor_id:'vendor',vendor_work_status:'in_progress',completed_at:null,description:'Kitchen drain',photo_paths:['sms/existing.jpg']},{id:'9f3c0000-1111-4222-8333-444444444444',landlord_id:'foreign',assigned_vendor_id:'vendor',vendor_work_status:'in_progress',completed_at:null,description:'PRIVATE FOREIGN JOB',photo_paths:[]}]}
 const writes:Array<{table:string;value:any}>=[]
 const db={failCas:false,failWrite:false,rpc:vi.fn(async()=>({data:!db.failCas,error:db.failWrite?{message:'failure'}:null})),from(table:string){
  const filters:Array<(r:any)=>boolean>=[];let mode='read',value:any,limit=Infinity
  const run=()=>{
   let rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r))).slice(0,limit)
   if(mode!=='read'){
    if(db.failWrite)return {data:null,error:{message:'simulated failure'}}
    if(mode==='update'){
     if(db.failCas)return {data:null,error:null}
     rows.forEach(r=>Object.assign(r,value))
    }else if(!tables[table].some(r=>r.id===value.id))tables[table].push(value)
    writes.push({table,value})
   }
   return {data:rows,error:null}
  }
  const b:any={select:()=>b,order:()=>b,limit:(n:number)=>{limit=n;return b},eq:(k:string,v:any)=>{filters.push(r=>JSON.stringify(r[k])===JSON.stringify(k==='intake_state'&&typeof v==='string'?JSON.parse(v):v));return b},is:(k:string,v:any)=>{filters.push(r=>r[k]===v);return b},in:(k:string,v:any[])=>{filters.push(r=>v.includes(r[k]));return b},gt:(k:string,v:string)=>{filters.push(r=>r[k]>v);return b},gte:(k:string,v:string)=>{filters.push(r=>r[k]>=v);return b},update:(v:any)=>{mode='update';value=v;return b},upsert:(v:any)=>{mode='upsert';value=v;return b},maybeSingle:async()=>{const r=run();return {...r,data:r.data?.[0]??null}},then:(resolve:any,reject:any)=>Promise.resolve().then(run).then(resolve,reject)}
  return b
 }}
 const ctx={supabase:db,landlordId:'account',conversationId:'thread',messageId:'photo',identity:{identity_type:'vendor',vendor_id:'vendor'},inbound:{body:'',from:'+15550000001',to:'+15550000002',mediaUrls:[PHOTO]}}
 const held=(phase='choice')=>{tables.sms_conversations[0].intake_state[KEY]={checkId:'check',messageId:'photo',phase,expiresAt:new Date(Date.now()+86400000).toISOString()}}
 const action=(body='',phase:CompletedPhotoAction['phase']='initial'):CompletedPhotoAction=>({kind:'completed_photo',check:check as never,conversationId:'thread',vendorId:'vendor',phone:ctx.inbound.from,line:ctx.inbound.to,originalMessageId:'photo',body,phase,newPhoto:phase==='initial'})
 return {db,tables,writes,ctx,held,action,check}
}
it('uses only the explicitly selected completed check and asks about the received photo',async()=>{
 const f=fixture(),action=await prepareCompletedPhoto(f.ctx as never)
 expect(action).toMatchObject({kind:'completed_photo',originalMessageId:'photo',phase:'initial'})
 expect(f.writes).toEqual([])
 const result=await actCompletedPhoto(f.db as never,action!)
 expect(result.reply).toContain('I received your photo')
 expect(result.reply).toContain('100 Test Lane is already complete')
 expect(result.reply).toContain('CORRECTION or ANOTHER JOB')
 expect(result.reply).not.toContain('multiple active work orders')
 expect(f.tables.sms_conversations[0].intake_state).toMatchObject({unrelated:'keep',[KEY]:{messageId:'photo'}})
 expect(f.writes.every(w=>w.table==='sms_conversations')).toBe(true)
})
it.each(['landlord','resident'])('does not intercept %s photos',async role=>{
 const f=fixture();f.ctx.identity.identity_type=role
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
})
it.each(['STOP','HELP','START','HOME CHECK','RETRY PHOTOS'])('preserves %s routing',async body=>{
 const f=fixture();f.ctx.inbound.body=body
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
})
it('preserves active Home Check routing and explicit new job references',async()=>{
 const f=fixture();f.tables.home_checks.push({...f.check,id:'active',status:'collecting',confirmed_at:null})
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
 f.tables.home_checks.pop();f.ctx.inbound.body='Photo for WO-3B00'
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
})
it.each(['landlord_id','recipient_phone','ulo_number','vendor_id'])('does not reveal a completed check with a mismatched %s',async key=>{
 const f=fixture();(f.check as any)[key]='foreign'
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
})
it('ignores stale completed context and never guesses a newer confirmed check',async()=>{
 const f=fixture();f.check.confirmed_at=new Date(Date.now()-8*86400000).toISOString()
 f.tables.home_checks.push({...f.check,id:'other',confirmed_at:new Date().toISOString()})
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull()
})
it.each(['CORRECTION',"it's a correction",'this is a correction','1'])('retains %s for review without changing confirmed equipment',async body=>{
 const f=fixture();f.held();const original=JSON.stringify(f.check)
 const response=await actCompletedPhoto(f.db as never,f.action(body,'choice'))
 expect(response.reply).toContain('retained in this conversation')
 expect(response.reply).toContain('have not changed')
 expect(JSON.stringify(f.check)).toBe(original)
 expect(f.db.rpc).toHaveBeenCalledWith('resolve_completed_home_check_photo',expect.objectContaining({p_check_id:'check',p_message_id:'photo',p_choice:'correction',p_vendor_id:'vendor',p_conversation_id:'thread',p_landlord_id:'account'}))
 expect(f.writes.some(w=>['home_checks','home_check_photos','property_inspection_photos','maintenance_requests'].includes(w.table))).toBe(false)
})
it('does not claim a correction was saved if the atomic resolver fails',async()=>{
 const f=fixture();f.held();f.db.failWrite=true;
 expect((await actCompletedPhoto(f.db as never,f.action('CORRECTION','choice'))).reply).toContain('could not save');
})
it('shows only assigned account-scoped open jobs after ANOTHER JOB',async()=>{
 const f=fixture();f.held();const result=await actCompletedPhoto(f.db as never,f.action('ANOTHER JOB','choice'))
 expect(result.reply).toContain('WO-3B00');expect(result.reply).not.toContain('PRIVATE FOREIGN JOB')
 expect(f.tables.sms_conversations[0].intake_state[KEY].phase).toBe('job')
 expect(f.writes.some(w=>w.table==='maintenance_requests')).toBe(false)
})
it('attaches the original retained photo only after an explicit scoped job choice',async()=>{
 const f=fixture();f.held('job')
 const result=await actCompletedPhoto(f.db as never,f.action('WO-3B00','job'))
 expect(result.reply).toContain('saved to WO-3B00')
 expect(f.db.rpc).toHaveBeenCalledWith('resolve_completed_home_check_photo',expect.objectContaining({p_ticket_id:'3b0047aa-1111-4222-8333-444444444444',p_message_id:'photo',p_choice:'job'}))
 expect(f.writes.some(w=>w.table==='maintenance_requests')).toBe(false)
})
it('rejects foreign job references and never selects a job from a bare YES',async()=>{
 for(const body of ['WO-9F3C','YES']){const f=fixture();f.held('job');const r=await actCompletedPhoto(f.db as never,f.action(body,'job'));expect(r.reply).toContain('still unassigned');expect(f.writes.some(w=>w.table==='maintenance_requests')).toBe(false)}
})
it('rejects forged original media and a changed selection without writing',async()=>{
 for(const change of ['sender','selection']){const f=fixture();f.held();if(change==='sender')f.tables.sms_messages[0].from_number='foreign';else f.tables.home_check_sms_capture_sessions[0].check_id='other';const r=await actCompletedPhoto(f.db as never,f.action('CORRECTION','choice'));expect(r.reply).toMatch(/not verify|changed/);expect(f.writes).toHaveLength(0)}
})
it('does not overwrite competing thread state or claim a failed job write succeeded',async()=>{
 const f=fixture();f.held('job');f.db.failCas=true
 expect((await actCompletedPhoto(f.db as never,f.action('WO-3B00','job'))).reply).toContain('could not save')
 expect(f.tables.maintenance_requests[0].photo_paths).toEqual(['sms/existing.jpg'])
})
it('keeps the original pending photo when another photo arrives',async()=>{
 const f=fixture();f.held();const a={...f.action('','choice'),newPhoto:true};expect((await actCompletedPhoto(f.db as never,a)).reply).toContain('earlier photo');expect(f.writes).toHaveLength(0)
})
it('cancels assignment without deleting the original SMS photo',async()=>{
 const f=fixture();f.held();expect((await actCompletedPhoto(f.db as never,f.action('CANCEL','choice'))).reply).toContain('cancelled');expect(f.tables.sms_messages[0].media_urls).toEqual([PHOTO])
})

it('lets a newer explicit vendor job offer win over the older completed Home Check',async()=>{
 const f=fixture();f.tables.sms_conversations[0].intake_state.pending_vendor_job_offer={vendorId:'vendor',ticketId:'new-job',sentAt:new Date().toISOString()};
 expect(await prepareCompletedPhoto(f.ctx as never)).toBeNull();expect(f.writes).toHaveLength(0)
})
it('does not accept malformed original media as a stored photo',async()=>{
 const f=fixture();f.held();f.tables.sms_messages[0].media_urls=[123];
 expect((await actCompletedPhoto(f.db as never,f.action('CORRECTION','choice'))).reply).toContain('could not verify');expect(f.db.rpc).not.toHaveBeenCalled()
})
