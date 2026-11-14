import { effects } from "./business_stub.ts"
import { handlers } from "../inspection-activation/server_stub.ts"
import { reset, state } from "../routing/sdk_stub.ts"
import { ACCOUNT_A, ACCOUNT_B, authRuntime, env, equal, token, user, type AuthOptions } from "../routing/runtime.ts"
await import("../../../supabase/functions/landlord-stripe-connect/index.ts")
await import("../../../supabase/functions/invoice-payment-checkout/index.ts")
async function run(index: number, body: unknown, headers = { Authorization: "Bearer " + token() } as Record<string,string>, auth: AuthOptions = {}) {
 reset(); effects.length=0; state.rows.landlords = [{id:ACCOUNT_A,name:"QA A",stripe_connect_account_id:null},{id:ACCOUNT_B,name:"QA B",stripe_connect_account_id:null}]
 const original=globalThis.fetch, keys=["SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","STRIPE_SECRET_KEY"],saved=keys.map(k=>Deno.env.get(k));
 for(const k of keys){const value=env(k);if(value)Deno.env.set(k,value);else Deno.env.delete(k)}
 const runtime=authRuntime(auth);globalThis.fetch=runtime.runtime.fetch;
 try { const r=await handlers[index](new Request("https://handler.invalid",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)}));return {status:r.status,body:await r.json(),authCalls:runtime.calls} }
 finally {globalThis.fetch=original;keys.forEach((k,i)=>saved[i]===undefined?Deno.env.delete(k):Deno.env.set(k,saved[i]!))}
}
const untouched=()=>{equal(state.clients,0);equal(state.reads.length,0);equal(state.writes,0);equal(effects,[])}
for(const [index,actions] of [[0,["status","clear_connect","create_account_session","create_connect_account_link","refresh_connect_status"]],[1,["create","complete"]]] as const){
 for(const action of actions){
  for(const c of [{name:"no session",headers:{},auth:{},status:401},{name:"legacy only",headers:{"x-admin-reassign-secret":"synthetic-old-secret"},auth:{},status:401},{name:"anon key",headers:{Authorization:"Bearer unit-anon-key"},auth:{},status:401},{name:"foreign account",headers:undefined,auth:{access:false},status:403},{name:"expired session",headers:undefined,auth:{authStatus:401},status:401},{name:"banned user",headers:undefined,auth:{account:{...user(),banned_until:"2099-01-01T00:00:00Z"}},status:403}] as Array<{name:string;headers?:Record<string,string>;auth:AuthOptions;status:number}>){
   Deno.test(`financial ${index} ${action} rejects ${c.name} before privileged effects`,async()=>{const r=await run(index,{action,landlordId:ACCOUNT_A,invoiceId:"11111111-1111-4111-8111-111111111111",sessionId:"cs_synthetic"},c.headers,c.auth);equal(r.status,c.status);untouched()})
  }
 }
}
Deno.test("authorized payout status reads only the requested account without Stripe or writes",async()=>{const r=await run(0,{action:"status",landlordId:ACCOUNT_A});equal(r.status,200);equal(r.body.accountId,null);equal(state.reads,[{table:"landlords",filters:[["id",ACCOUNT_A]]}]);equal(state.writes,0);equal(effects,[])})
Deno.test("authorized invoice create and complete remain hard-disabled before any provider/database operation",async()=>{for(const action of ["create","complete"]){const r=await run(1,{action,landlordId:ACCOUNT_A});equal(r.status,503);untouched()}})
Deno.test("malformed JSON shapes fail without privileged effects",async()=>{for(const index of [0,1])for(const body of [null,[],"text"]){const r=await run(index,body);equal(r.status,400);untouched()}})
Deno.test("missing account fails before privileged effects",async()=>{for(const index of [0,1]){const r=await run(index,{action:"status"});equal(r.status,400);untouched()}})
