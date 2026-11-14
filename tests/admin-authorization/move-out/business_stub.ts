import {state} from '../routing/sdk_stub.ts'
export type MoveOutAdminEngineAction='send_reminder'|'schedule_inspection'|'mark_keys_returned'|'complete_cleaning'|'complete_move_out'|'cancel_move_out'
export const mode={activeRun:null as string|null}
export function findActiveMoveOutRunForUnit(_s:unknown,p:unknown){state.business.push({name:'lookup-run',params:p});return Promise.resolve(mode.activeRun)}
export function markUnitVacant(_s:unknown,p:unknown){state.business.push({name:'vacant',params:p});return Promise.resolve({unitId:'synthetic',promptMessage:'synthetic'})}
export function runMoveOutViaEngine(_s:unknown,p:unknown){state.business.push({name:'engine',params:p});return Promise.resolve({metadata:{ok:true,error:undefined as string|undefined,inspection_run_id:null as string|null}})}
