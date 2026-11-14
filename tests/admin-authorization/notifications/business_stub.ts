import {state} from '../routing/sdk_stub.ts'
function note(name:string,params:unknown){state.business.push({name,params})}
export function sendLandlordOnboardingWelcome(_s:unknown,params:unknown){note('welcome',params);return Promise.resolve({ok:true})}
export function sendResendEmail(...params:unknown[]){note('email',params);return Promise.resolve({id:'synthetic'})}
export function recordActivityLog(...params:unknown[]){note('activity',params);return Promise.resolve(null)}
export function loadLandlordSupportContact(_s:unknown,id:string){return Promise.resolve({landlordEmail:'qa@example.invalid',organizationSupportEmail:null,id})}
export function normalizeOpsEmail(v:string){return v||null}
export function primaryLandlordSupportEmail(v:{accountSetupEmail?:string|null;landlordEmail?:string|null;organizationSupportEmail?:string|null}){return v.accountSetupEmail||v.landlordEmail||null}
export function getSMSProvider(){return {sendMessage:(params:unknown)=>{note('sms',params);return Promise.resolve({messageId:'synthetic',providerMessageSid:'synthetic',error:undefined as string|undefined})}}}
export function resolveOutboundLandlordSmsLine(_s:unknown,id:string){note('line',id);return Promise.resolve({from:'+15550102000',phoneNumber:'+15550102000',phone:'+15550102000',provider:'twilio'})}
export function abortFailedVendorOnboardingInvite(...p:unknown[]){note('abort',p);return Promise.resolve(null)}
export function completeVendorOnboardingAfterOverride(...p:unknown[]){note('complete',p);return Promise.resolve(null)}
export function startVendorOnboardingRun(...p:unknown[]){note('start',p);return Promise.resolve({id:'synthetic-run'})}
export function findLandlordVendorByContact(_s:unknown,id:string,p:{vendorId?:string|null;email?:string|null;phone?:string|null}){note('find',{id,...p});return Promise.resolve(p.vendorId||null)}
export function deliverVendorInvite(_s:unknown,p:unknown){note('invite',p);return Promise.resolve({anyDelivered:true,verificationId:'synthetic-id',token:'synthetic-token',link:'https://qa.invalid',delivery:{sms:'sent',email:'skipped'}})}
export function vendorInviteFailureUserMessage(_v:unknown){return 'Synthetic failed invite'}
export function sendVendorOnboardingOverrideActivatedSms(_s:unknown,p:unknown){note('override',p);return Promise.resolve({sms:'sent' as const})}
export function dispatchUnassignedTicketsAfterOverride(_s:unknown,p:unknown){note('dispatch',p);return Promise.resolve({assignedCount:0})}

export function formatWorkOrderRef(id:string){return id}
export function sendVendorJobAlert(...p:unknown[]){note("job-alert",p);return Promise.resolve(null)}
export function assignVendorAndNotify(...p:unknown[]){note("assign",p);return Promise.resolve({assigned:false,vendorId:null,skipReason:"synthetic"})}
