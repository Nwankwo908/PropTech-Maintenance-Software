import { state } from "./sdk_stub.ts";
const called = (name: string, params: unknown) => {
  state.business.push({ name, params });
};
export async function reassignVendorByIdAndNotify(
  _db: unknown,
  ticketId: string,
  vendorId: string,
): Promise<{ ok: true } | { error: string }> {
  called("reassign", { ticketId, vendorId });
  state.writes++;
  return { ok: true };
}
export async function assignVendorAndNotify(
  _db: unknown,
  p: Record<string, unknown>,
) {
  called("assign", p);
  return { assigned: true, vendorId: p.preferVendorId, skipReason: null };
}
export async function logGraphEvent(_db: unknown, p: unknown) {
  called("graph", p);
}
export async function runMaintenanceRequestViaEngine(_db: unknown, p: unknown) {
  called("engine", p);
}
export function resolveLandlordId(): string {
  throw Error("Unexpected unscoped landlord fallback");
}
export async function beginVendorAvailabilityAsk(_db: unknown, p: unknown) {
  called("availability", p);
  return { sentSms: true, conversationId: "unit-conversation" };
}
export function buildVendorScheduleConfirmedSms(_p: unknown) {
  return "Unit-test scheduling message";
}
export function formatWorkOrderRef(_p: unknown) {
  return "WO-UNIT";
}
export async function sendVendorJobAlert(_db: unknown, p: unknown) {
  called("notify", p);
  return {
    ok: true as const,
    conversationId: "unit-conversation",
    error: undefined,
  };
}
export const uloAppUrl = {
  workOrder: (_t: unknown) => "https://unit.invalid",
  workOrderToken: (_t: unknown) => "https://unit.invalid",
};
export async function applyAdminStageMove(
  _db: unknown,
  p: {
    landlordId: string;
    ticketId: string;
    runId: string;
    toStage: string;
    [key: string]: unknown;
  },
) {
  const run = state.rows.workflow_runs.find((r) =>
      r.id === p.runId && r.landlord_id === p.landlordId
    ),
    ticket = state.rows.maintenance_requests.find((r) =>
      r.id === p.ticketId && r.landlord_id === p.landlordId
    );
  if (!run || !ticket) {
    return {
      ok: false as const,
      status: 404,
      error: "Not found",
      currentStage: undefined,
    };
  }
  called("stage", p);
  state.writes++;
  ticket.vendor_work_status = p.toStage;
  return {
    ok: true as const,
    stage: p.toStage,
    vendorWorkStatus: p.toStage,
    assignedVendorId: ticket.assigned_vendor_id,
  };
}
export async function setManualVisitTime(
  _db: unknown,
  p: { landlordId: string; ticketId: string; [key: string]: unknown },
) {
  if (
    !state.rows.maintenance_requests.some((r) =>
      r.id === p.ticketId && r.landlord_id === p.landlordId
    )
  ) return { ok: false, status: 404, error: "Not found" };
  called("visit", p);
  state.writes++;
  return {
    ok: true,
    scheduledAt: "unit date",
    scheduledWindowText: "unit window",
    vendorTexted: false,
  };
}
export async function activateInspectionNoticeWorkOrder(
  _db: unknown,
  p: { landlordId: string; inspectionReportId: string },
) {
  if (
    !state.rows.inspection_reports.some((r) =>
      r.id === p.inspectionReportId && r.landlord_id === p.landlordId
    )
  ) return { ok: false, status: 404, error: "Not found" };
  called("activate", p);
  state.writes++;
  return {
    ok: true,
    ticketId: "unit job",
    requestRef: "WO-UNIT",
    alreadyActivated: false,
    vendorAssigned: false,
  };
}
