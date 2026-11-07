import {it,expect,vi} from 'vitest'
vi.mock('../sms/landlordAccountPhone.ts',()=>({isLandlordAccountOrOpsPhone:vi.fn(async()=>true)}))
vi.mock('../sms/inbound_db.ts',()=>({normalizeSmsPhone:(p:string)=>p}))
vi.mock('./service.ts',()=>({checkLocation:(c:any)=>c.property_label}))
import {prepareHomeCheckReview,readHomeCheckReview} from './reviewSelection.ts'
const check=(id:string,date:string)=>({id,created_at:date,completed_at:date,confirmed_at:null,property_label:'200 Test Lane'})
function fixture(state:any={},checks:any[]=[check('old','2026-10-30T12:00:00Z'),check('new','2026-11-02T12:00:00Z')],conflict=false,prompt='Any leaks, unusual noises or smells?'){
 const filters:any[]=[];let saved:any=null
 const from=(table:string)=>{let update:any;const q:any={};for(const m of ['select','eq','is','gt','not','order','limit','like'])q[m]=(...args:any[])=>{filters.push([table,m,...args]);return q};q.update=(v:any)=>{update=v;return q};q.maybeSingle=async()=>({data:update?(conflict?null:(saved=update,{id:'thread'})):{intake_state:state},error:null});q.then=(r:any)=>Promise.resolve(r({data:table==='sms_messages'?[{body:prompt}]:checks,error:null}));return q}
 const ctx:any={supabase:{from},landlordId:'account',conversationId:'thread',identity:{identity_type:'landlord'},inbound:{body:'RESULTS',mediaUrls:[],from:'+14705246084',to:'+18775803356'}}
 return {ctx,filters,saved:()=>saved}
}
it('offers dated numbered choices and stores exact IDs in this conversation',async()=>{
 const f=fixture();const result=await prepareHomeCheckReview(f.ctx,true)
 expect(result).toMatchObject({kind:'clarify',reply:expect.stringContaining('1) 200 Test Lane — started Nov 2')})
 expect(f.saved().intake_state.home_check_results_review.ids).toEqual(['new','old'])
 expect(f.filters).toContainEqual(['home_checks','eq','landlord_id','account'])
 expect(f.filters).toContainEqual(['home_checks','eq','ulo_number','+18775803356'])
 expect(f.filters).toContainEqual(['home_checks','gt','expires_at',expect.any(String)])
 expect(f.filters).not.toContainEqual(['home_checks','eq','recipient_phone','+14705246084'])
})
const state=(extra:any={})=>({other:'preserved',home_check_results_review:{ids:['new','old'],expiresAt:new Date(Date.now()+600000).toISOString(),...extra}})
it('number selects the stored ID, not the current query order, and preserves other state',async()=>{
 const f=fixture(state());f.ctx.inbound.body='1'
 expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'results',check:{id:'new'}})
 expect(f.saved().intake_state.other).toBe('preserved')
 expect(f.saved().intake_state.home_check_results_review.selectedId).toBe('new')
})
it('OK confirms only the explicitly selected review',async()=>{const f=fixture(state({selectedId:'new'}));f.ctx.inbound.body='OK';expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'confirm',check:{id:'new'}})})
it('OK before selection asks for a number',async()=>{const f=fixture(state());f.ctx.inbound.body='OK';expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'clarify'});expect(f.saved()).toBeNull()})
it('does not select a removed or newly confirmed check',async()=>{const f=fixture(state(),[check('old','2026-10-30')]);f.ctx.inbound.body='1';expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'clarify',reply:expect.stringContaining('changed')});expect(f.saved()).toBeNull()})
it('concurrent state changes cannot silently overwrite the choice',async()=>{const f=fixture(state(),undefined,true);f.ctx.inbound.body='1';expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'clarify',reply:expect.stringContaining('changed')})})
it('cancel clears only review state',async()=>{const f=fixture(state());f.ctx.inbound.body='CANCEL';await prepareHomeCheckReview(f.ctx);expect(f.saved().intake_state).toEqual({other:'preserved'})})
it('expired menus, invalid IDs, resident replies and photos cannot select records',async()=>{
 expect(readHomeCheckReview(state({expiresAt:'2020-01-01'}))).toBeNull()
 expect(readHomeCheckReview(state({selectedId:'foreign'}))).toBeNull()
 for(const role of ['resident','vendor']){const f=fixture(state());f.ctx.identity.identity_type=role;f.ctx.inbound.body='1';expect(await prepareHomeCheckReview(f.ctx)).toBeNull()}
 const f=fixture(state());f.ctx.inbound.mediaUrls=['photo'];expect(await prepareHomeCheckReview(f.ctx)).toBeNull()
})

it('unbound OK offers completed results instead of using a different photo capture',async()=>{
 const f=fixture({home_check_photo_pending:{checkId:'photo-check'},unrelated:'preserved'});f.ctx.inbound.body='OK';
 expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'clarify',reply:expect.stringContaining('Which Home Check results')});
 expect(f.saved().intake_state.home_check_results_review.ids).toEqual(['new','old']);
 expect(f.saved().intake_state.home_check_photo_pending.checkId).toBe('photo-check');
 expect(f.saved().intake_state.unrelated).toBe('preserved');
});
it('unbound OK with one completed result displays it before allowing confirmation',async()=>{
 const f=fixture({home_check_photo_pending:{checkId:'other'}},[check('vendor','2026-11-03')]);f.ctx.inbound.body='OK';
 expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'results',check:{id:'vendor'}});
 expect(f.saved().intake_state.home_check_results_review.selectedId).toBe('vendor');
});

it('can review a completed check even if its result notification never ran',async()=>{
 const f=fixture({},[{...check('recovered','2026-11-03'),summary_sent_at:null}]);
 expect(await prepareHomeCheckReview(f.ctx,true)).toMatchObject({kind:'results',check:{id:'recovered'}});
 expect(f.filters).not.toContainEqual(['home_checks','not','summary_sent_at','is',null]);
});
it('accepts an observation for the selected landlord review after the exact question',async()=>{
 const row={...check('new','2026-11-03'),role:'landlord',recipient_phone:'+14705246084',answers:{warningSigns:null}};
 for(const [body,warningSigns,warningDetails] of [['NONE',false,''],['UNSURE',null,''],['YES leaking',true,'leaking']] as const){
  const f=fixture(state({selectedId:'new'}),[row]);f.ctx.inbound.body=body;
  expect(await prepareHomeCheckReview(f.ctx)).toMatchObject({kind:'answers',check:{id:'new'},answers:{observationsConfirmed:true,warningSigns,warningDetails}});
 }
});
it('does not borrow another check, observer, expired choice or unrelated question',async()=>{
 const row={...check('new','2026-11-03'),role:'landlord',recipient_phone:'+14705246084',answers:{warningSigns:null}};
 for(const f of [fixture(state(),[row]),fixture(state({selectedId:'new',expiresAt:'2000-01-01'}),[row]),fixture(state({selectedId:'new'}),[{...row,role:'contractor'}]),fixture(state({selectedId:'new'}),[{...row,recipient_phone:'other'}]),fixture(state({selectedId:'new'}),[row],false,'Does Tuesday work?')]){
  f.ctx.inbound.body='NONE';expect(await prepareHomeCheckReview(f.ctx)).toBeNull();
 }
});
