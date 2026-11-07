import {it,expect,vi} from 'vitest'
vi.mock('../sms/landlordAccountPhone.ts',()=>({isLandlordAccountOrOpsPhone:vi.fn(async()=>true)}))
vi.mock('../sms/inbound_db.ts',()=>({normalizeSmsPhone:(s:string)=>s}))
vi.mock('./service.ts',()=>({checkLocation:(c:any)=>c.property_label}))
import {bindHomeCheckResultsReview} from './reviewBinding.ts'
import {prepareHomeCheckReview} from './reviewSelection.ts'
const input={landlordId:'account',conversationId:'landlord-thread',checkId:'vendor-check',phone:'+14705246084',uloNumber:'+18775803356',messageId:'summary',checkExpiresAt:new Date(Date.now()+7*86400000).toISOString()}
function fixture(options:{conflicts?:number;failWrites?:boolean;message?:Record<string,unknown>;mutateOnConflict?:boolean}={}) {
 let state:any={unrelated:'preserved',home_check_photo_pending:{checkId:'other-photo-check'}}
 let conflicts=options.conflicts??0
 let message:any={id:'summary',from_number:input.uloNumber,to_number:input.phone,provider_status:'delivered',...options.message}
 const filters:any[]=[]
 const check={id:'vendor-check',role:'contractor',completed_at:new Date().toISOString(),confirmed_at:null,created_at:new Date().toISOString(),property_label:'Test Lane'}
 const db:any={from:(table:string)=>{let patch:any,expected:any;const q:any={};for(const method of ['select','eq','is','gt','order','limit','like'])q[method]=(...args:any[])=>{filters.push([table,method,...args]);if(method==='eq'&&args[0]==='intake_state')expected=JSON.parse(args[1]);return q};q.update=(v:any)=>{patch=v;return q};q.maybeSingle=async()=>{
  if(!patch)return{data:{intake_state:structuredClone(state)},error:null}
  if(options.failWrites)return{data:null,error:{message:'unavailable'}}
  if(conflicts-- >0){state.concurrent='kept';if(options.mutateOnConflict){message={...message,id:'newer-summary'};state.home_check_results_review={ids:['newer-check'],selectedId:'newer-check'}}return{data:null,error:null}}
  if(expected&&JSON.stringify(expected)!==JSON.stringify(state))return{data:null,error:null}
  state=patch.intake_state;return{data:{id:input.conversationId},error:null}
 };q.then=(r:any)=>Promise.resolve(r({data:table==='sms_messages'?[message]:[check],error:null}));return q}}
 return {db,filters,state:()=>state,setMessage:(m:any)=>{message={...message,...m}},ctx:()=>({supabase:db,landlordId:'account',conversationId:'landlord-thread',identity:{identity_type:'landlord'},inbound:{body:'OK',mediaUrls:[],from:input.phone,to:input.uloNumber}} as any)}
}
it('first OK after automatic vendor Results confirms that exact check without resending Results',async()=>{
 const f=fixture();expect(await bindHomeCheckResultsReview(f.db,input)).toBe(true)
 expect(f.state().home_check_results_review).toMatchObject({ids:['vendor-check'],selectedId:'vendor-check',summaryMessageId:'summary'})
 expect(f.state().unrelated).toBe('preserved')
 expect(await prepareHomeCheckReview(f.ctx())).toMatchObject({kind:'confirm',check:{id:'vendor-check'}})
 expect(f.filters).toContainEqual(['sms_conversations','eq','landlord_id','account'])
 expect(f.filters).toContainEqual(['sms_conversations','eq','external_phone_number',input.phone])
})
it('retries a concurrent unrelated state change without dropping it',async()=>{const f=fixture({conflicts:1});expect(await bindHomeCheckResultsReview(f.db,input)).toBe(true);expect(f.state().concurrent).toBe('kept')})
it('an older send cannot overwrite a newer summary selection',async()=>{const f=fixture({conflicts:1,mutateOnConflict:true});expect(await bindHomeCheckResultsReview(f.db,input)).toBe(false);expect(f.state().home_check_results_review.selectedId).toBe('newer-check')})
it.each([{id:'other-summary'},{from_number:'+15550000000'},{to_number:'+15550000000'},{provider_status:'failed'}])('does not bind a mismatched or failed summary: %j',async message=>{const f=fixture({message});expect(await bindHomeCheckResultsReview(f.db,input)).toBe(false);expect(f.state().home_check_results_review).toBeUndefined()})
it('a changed latest summary cannot confirm a stale review',async()=>{const f=fixture();await bindHomeCheckResultsReview(f.db,input);f.setMessage({id:'other-summary'});expect(await prepareHomeCheckReview(f.ctx())).toMatchObject({kind:'clarify',reply:expect.stringContaining('changed')})})
it('an expired Home Check cannot establish confirmation context',async()=>{const f=fixture();expect(await bindHomeCheckResultsReview(f.db,{...input,checkExpiresAt:'2020-01-01'})).toBe(false);expect(f.filters).toHaveLength(0)})
it('failed or repeatedly conflicting writes do not claim binding succeeded',async()=>{for(const opts of [{failWrites:true},{conflicts:3}]){const f=fixture(opts);expect(await bindHomeCheckResultsReview(f.db,input)).toBe(false);expect(f.state().home_check_results_review).toBeUndefined()}})
