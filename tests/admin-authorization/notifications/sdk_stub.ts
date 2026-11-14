import {createClient as fakeClient} from '../routing/sdk_stub.ts'
export function createClient(url:string,key:string,options?:unknown){const client=fakeClient(url,key,options);return {from:(table:string)=>{const query=client.from(table);return Object.assign(query,{not:(_column:string,_op:string,_value:unknown)=>query})}}}
export type SupabaseClient=ReturnType<typeof createClient>
