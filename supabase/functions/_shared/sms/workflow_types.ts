import type { InboundSMSMessage } from "./types.ts"
import type { SmsIdentityRow } from "./inbound_db.ts"
import type { IdentityResolutionSource, SelfHealingPhase } from "./resolveIdentity.ts"

export type SmsWorkflowRoute =
  | "resident_maintenance_intake"
  | "lease_renewal"
  | "rent_collection"
  | "vendor_response"
  | "landlord_command"
  | "unknown_sender_onboarding"

export type WorkflowContext = {
  inbound: InboundSMSMessage
  landlordId: string
  identity: SmsIdentityRow
  conversationId: string
  messageId: string
  maintenanceRequestId: string | null
  selfHealed: boolean
  continueIntake: boolean
  resolutionSource: IdentityResolutionSource
  selfHealingPhase: SelfHealingPhase
  suggestedUnit: string | null
}

export type WorkflowResult = {
  route: SmsWorkflowRoute
  replyHint?: string
  metadata: Record<string, unknown>
}
