import {state} from '../routing/sdk_stub.ts'
function send(name:string,params:unknown){state.business.push({name,params});return Promise.resolve({ok:true,conversationId:'synthetic',messageId:'synthetic',error:undefined as string|undefined,balanceDueAfterWaiver:null,lateFeeWaived:null})}
export function sendLateRentAccountSms(_s:unknown,p:unknown){return send('rent',p)}
export function sendLeaseRenewalIncentiveSms(_s:unknown,p:unknown){return send('lease',p)}
export function normalizePhoneFlexible(s:string){const n=s.replace(/\D/g,'');return n.length===11?'+'+n:n.length===10?'+1'+n:null}
