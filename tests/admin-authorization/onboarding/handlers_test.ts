import {assertEquals as deepEqual} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {handlers} from '../inspection-activation/server_stub.ts'
import {reset,state} from '../routing/sdk_stub.ts'
import {ACCOUNT_A,ACCOUNT_B,token,user,env,authRuntime,equal,type AuthOptions} from '../routing/runtime.ts'
await import('../../../supabase/functions/landlord-sms-onboarding/index.ts')
await import('../../../supabase/functions/register-unit/index.ts')
await import('../../../supabase/functions/provision-sms-number/index.ts')
const UNIT_A='11111111-1111-4111-8111-111111111111',UNIT_B='22222222-2222-4222-8222-222222222222',RES_A='33333333-3333-4333-8333-333333333333',RES_B='44444444-4444-4444-8444-444444444444'
async function run(index:number, options:{body?:unknown;headers?:Record<string,string>;auth?:AuthOptions;staff?:unknown;staffStatus?:number;errorTable?:string;method?:string}={}) {
 reset();state.rows.units=[{id:UNIT_A,landlord_id:ACCOUNT_A,unit_label:'1',building:'North'},{id:UNIT_B,landlord_id:ACCOUNT_B,unit_label:'2',building:'South'}];state.rows.users=[{id:RES_A,landlord_id:ACCOUNT_A},{id:RES_B,landlord_id:ACCOUNT_B}];state.errorTable=options.errorTable??''
 const original=globalThis.fetch,keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],saved=keys.map(k=>Deno.env.get(k));keys.forEach(k=>Deno.env.set(k,env(k)!));const runtime=authRuntime(options.auth)
 globalThis.fetch=async(input,init)=>{if(String(input).endsWith('/rpc/is_platform_staff')){equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token());return Response.json(options.staff??false,{status:options.staffStatus??200})}return runtime.runtime.fetch(input,init)}
 try {const method=options.method??'POST';const r=await handlers[index](new Request('https://handler.invalid',{method,headers:{'Content-Type':'application/json',...(options.headers??{Authorization:'Bearer '+token()})},...(method==='POST'?{body:JSON.stringify(options.body===undefined?{landlordId:ACCOUNT_A}:options.body)}:{})}));return {status:r.status,body:await r.json().catch(()=>null),headers:r.headers}}
 finally{globalThis.fetch=original;keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!))}
}
function untouched(){equal(state.clients,0);equal(state.reads,[]);equal(state.writes,0);equal(state.business,[])}
for(const index of [0,1,2]){
 for(const c of [{name:'no session',headers:{},auth:{},status:401},{name:'legacy only',headers:{'x-admin-reassign-secret':'public-old-secret'},auth:{},status:401},{name:'API key',headers:{Authorization:'Bearer unit-anon-key'},auth:{},status:401},{name:'foreign account',auth:{access:false},status:403},{name:'expired session',auth:{authStatus:401},status:401},{name:'banned user',auth:{account:{...user(),banned_until:'2099-01-01T00:00:00Z'}},status:403}] as Array<{name:string;headers?:Record<string,string>;auth:AuthOptions;status:number}>){Deno.test(`onboarding ${index} rejects ${c.name} before effects`,async()=>{const r=await run(index,c);equal(r.status,c.status);untouched()})}
 for(const body of [null,[],{}, {landlordId:'bad'},{landlordId:2}])Deno.test(`onboarding ${index} rejects malformed scope ${JSON.stringify(body)}`,async()=>{equal((await run(index,{body})).status,400);untouched()})
 Deno.test(`onboarding ${index} preflight permits user sessions without effects`,async()=>{const r=await run(index,{method:'OPTIONS',headers:{}});equal(r.status,200);equal(r.headers.get('Access-Control-Allow-Headers')?.includes('authorization'),true);untouched()})
 Deno.test(`onboarding ${index} unsupported method has no effects`,async()=>{equal((await run(index,{method:'GET'})).status,405);untouched()})
}
Deno.test('own onboarding scopes the domain call to the authorized account',async()=>{const r=await run(0);equal(r.status,200);equal(Object.keys(r.body.smsNumber).sort(),['phone_number','provider']);equal(state.business[0],{name:'ensure',params:ACCOUNT_A})})
for(const staff of [false,'true',1,{}])Deno.test(`raw provisioning fails closed for non-platform/malformed authority ${JSON.stringify(staff)}`,async()=>{equal((await run(2,{staff})).status,staff===false?403:503);untouched()})
Deno.test('platform authority outage denies before provisioning',async()=>{equal((await run(2,{staff:true,staffStatus:500})).status,503);untouched()})
Deno.test('verified platform session can call fake provisioning only for explicit authorized account',async()=>{equal((await run(2,{staff:true})).status,200);equal(state.business,[{name:'provision',params:{landlordId:ACCOUNT_A}}])})
for(const body of [
 {unitLabel:'1',residentId:RES_B}, {unitLabel:'2',unitId:UNIT_B}, {unitLabel:'9',unitId:UNIT_A}, {unitLabel:'1',unitId:UNIT_A,building:'South'},
 {units:[{unitLabel:'1',unitId:UNIT_A},{unitLabel:'2',unitId:UNIT_B}]},
])Deno.test(`registration refuses foreign/conflicting nested targets ${JSON.stringify(body)}`,async()=>{const r=await run(1,{body:{landlordId:ACCOUNT_A,...body}});equal([400,404].includes(r.status),true);equal(state.business,[]);equal(state.writes,0)})
for(const body of [{unitLabel:'1',unitId:'bad'},{unitLabel:'1',residentId:'bad'},{unitLabel:'1',tenantPhone:'+15550102000'},{units:[null]},{units:[]},{units:'bad'},{units:[{unitLabel:'1'}],residentId:RES_A}])Deno.test(`registration rejects malformed nested input ${JSON.stringify(body)}`,async()=>{equal((await run(1,{body:{landlordId:ACCOUNT_A,...body}})).status,400);untouched()})
Deno.test('registration own resident and canonical unit pass only authorized IDs',async()=>{equal((await run(1,{body:{landlordId:ACCOUNT_A,unitLabel:'1',unitId:UNIT_A,residentId:RES_A}})).status,200);deepEqual(state.business,[{name:'unit',params:{landlordId:ACCOUNT_A,unitLabel:'1',unitId:UNIT_A,building:'North',residentId:RES_A,tenantPhone:null}}])})
Deno.test('bulk registration validates every target before the single domain call',async()=>{equal((await run(1,{body:{landlordId:ACCOUNT_A,units:[{unitLabel:'1',unitId:UNIT_A}]}})).status,200);equal(state.business[0].name,'units')})
Deno.test('registration lookup outage never reaches domain effects',async()=>{equal((await run(1,{body:{landlordId:ACCOUNT_A,unitLabel:'1',unitId:UNIT_A},errorTable:'units'})).status,503);equal(state.business,[]);equal(state.writes,0)})
