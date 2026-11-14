import {state} from '../routing/sdk_stub.ts'
export type InspectionType='move_in'|'move_out'|'periodic'|'annual'|'common_area'
export type StartWorkflowInitialAction={moveIn?:{action:'register_and_outreach'|'send_outreach'};moveOut?:{action:'send_outreach'};inspection?:{action:'register_and_outreach'|'send_outreach'}}
function start(name:string,p:unknown){state.business.push({name,params:p});return Promise.resolve({workflow_run_id:'synthetic-run'})}
export function startInspectionWorkflow(_s:unknown,p:unknown){return start('inspection',p)}
export function startMoveInWorkflow(_s:unknown,p:unknown){return start('move_in',p)}
export function startMoveOutWorkflow(_s:unknown,p:unknown){return start('move_out',p)}
export function triggerMoveOutFromLeaseRenewal(_s:unknown,p:unknown){state.business.push({name:'renewal',params:p});return Promise.resolve({ok:true,error:undefined as string|undefined,leaseRenewalRunId:'synthetic',moveOutRunId:'synthetic',conversationId:null})}
export function startInsightInspectorScheduling(_s:unknown,p:unknown){state.business.push({name:'insight',params:p});return Promise.resolve({ok:true,error:undefined as string|undefined,status:'probing',requestId:'synthetic',ticketId:'synthetic',targetDay:'2099-01-01'})}
