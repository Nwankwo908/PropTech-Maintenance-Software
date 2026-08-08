import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { InboundSMSMessage } from "./types.ts"
import type { SmsIdentityRow } from "./inbound_db.ts"
import type {
  IdentityResolutionSource,
  SelfHealingPhase,
} from "./resolveIdentity.ts"

export type ProcessInboundSmsResult =
  | {
      ok: true
      releasedPending: true
      conversationId: string
      messageId: string
      outboundMessageId?: string
    }
  | {
      ok: true
      releasedPending?: false
      conversationId: string
      messageId: string
      outboundMessageId?: string
      workflowRoute: string
      identityType: string
      landlordId: string
      resolutionSource: IdentityResolutionSource
      selfHealingPhase: SelfHealingPhase
    }

export class InboundSmsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = "InboundSmsError"
  }
}

/** Shared context passed to every inbound SMS handler adapter. */
export type InboundSmsHandlerContext = {
  supabase: SupabaseClient
  inbound: InboundSMSMessage
  landlordId: string
  conversationId: string
  conversationType: string
  messageId: string
  identity: SmsIdentityRow
  maintenanceRequestId: string | null
  selfHealed: boolean
  resolutionSource: IdentityResolutionSource
  selfHealingPhase: SelfHealingPhase
  /** Skip START/YES consent hijack during active maintenance intake. */
  activeMaintenanceIntake: boolean
}

export type InboundSmsHandlerReply = {
  /** Reply was already sent inside the handler (e.g. consent). */
  alreadySent?: boolean
  outboundMessageId?: string
  body?: string
  source: string
  skipGenericFallback?: boolean
}

export type InboundSmsHandlerResult =
  | { handled: false }
  | {
      handled: true
      workflowRoute: string
      maintenanceRequestId?: string | null
      workflowMetadata?: Record<string, unknown>
      reply?: InboundSmsHandlerReply
    }

/**
 * Registry handler contract (`.cursor/rules/sms-handler-registry.mdc`):
 * - R1 atomic: one message → one domain helper
 * - R2 pending gate before `{ handled: true }` (STOP/HELP global exception)
 * - R3 handled messages must not also run `routeInboundSmsWorkflow`
 * - R4 multi-turn / cron / escalation → workflow templates only
 */
export type InboundSmsHandler = {
  id: string
  /** Lower priority runs first (first match wins). */
  priority: number
  try: (
    ctx: InboundSmsHandlerContext,
  ) => Promise<InboundSmsHandlerResult>
}
