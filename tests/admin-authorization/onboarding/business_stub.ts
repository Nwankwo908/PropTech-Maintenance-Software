import { state } from "../routing/sdk_stub.ts"
export function record(name:string,params:unknown) { state.business.push({name,params}) }
// deno-lint-ignore no-explicit-any
export async function ensureLandlordMainSmsNumber(_db:unknown,id:string):Promise<any> {
 record('ensure',id);return {number:{id:'synthetic-line',phone_number:'+15550100000',provider:'twilio',provider_number_sid:null},created:false,source:'existing'}
}
export async function onUnitCreated(_db:unknown,input:unknown) {record('unit',input);return {unitAssociated:true}}
export async function onUnitsCreated(_db:unknown,input:unknown) {record('units',input);return {unitAssociated:true}}
export async function provisionLandlordMainNumber(_db:unknown,input:unknown) {record('provision',input);return {created:false,source:'existing'}}
export async function logGraphEvent(_db:unknown,input:unknown) {record('graph',input);return 'synthetic-event'}
export async function findUnitRow(_db:unknown,input:{landlordId:string;unitLabel:string;building?:string|null}) {
 const key=(s:unknown)=>String(s??'').trim().toLowerCase().replace(/^(unit|apt|#)\s*/,'')
 const rows=(state.rows.units??[]).filter(r=>r.landlord_id===input.landlordId&&key(r.unit_label)===key(input.unitLabel)&&(!input.building||key(r.building)===key(input.building)))
 return rows.length===1?rows[0]:null
}
