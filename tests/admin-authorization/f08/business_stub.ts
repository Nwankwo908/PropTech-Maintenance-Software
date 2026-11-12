import { state } from "./sdk_stub.ts";
export type TerminateMode = "cancel" | "archive" | "release";
export type TerminateSource =
  | "dashboard"
  | "admin_api"
  | "cleanup"
  | "emergency_decline";
export async function terminateWorkOrder(
  _db: unknown,
  params: Record<string, unknown>,
) {
  state.business.push({ name: "terminate", params });
  return {
    ok: true,
    vendorNotify: "not-sent-test-stub",
    terminationId: "test-only",
    error: undefined,
  };
}
export async function detachDeletedTicketFromSmsConversations(
  _db: unknown,
  params: Record<string, unknown>,
) {
  state.business.push({ name: "detach", params });
  return { conversationsUpdated: 0 };
}
export async function approveMaintenanceInvoice(
  _db: unknown,
  params: Record<string, unknown>,
): Promise<{ recognizedAmount: number } | { error: string }> {
  state.business.push({ name: "approve", params });
  return { recognizedAmount: 25 };
}
