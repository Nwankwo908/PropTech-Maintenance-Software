import { state } from "./sdk_stub.ts";
export type InspectionAdminEngineAction = "send_reminder" | "mark_no_show" | "record_outcome" | "complete_inspection" | "cancel_inspection";
export function runInspectionViaEngine(_db: unknown, params: unknown) {
  state.business.push({ name: "inspection", params });
  return Promise.resolve({ metadata: { ok: true, error: undefined } });
}
export function activateUnit(_db: unknown, params: unknown) {
  state.business.push({ name: "activation", params });
  return Promise.resolve({ unitId: "synthetic-unit", residentId: null });
}
export function startMoveInWorkflow(_db: unknown, params: unknown) {
  state.business.push({ name: "move-in", params });
  return Promise.resolve({ workflow_run_id: "synthetic-run", engineResult: { metadata: { ok: true, error: undefined, residentId: null } } });
}
