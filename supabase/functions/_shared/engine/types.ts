import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { WorkflowContext } from "../sms/workflow_types.ts"

/** Pipeline stages every workflow run passes through. */
export type WorkflowStage =
  | "trigger"
  | "classify"
  | "route"
  | "act"
  | "escalate"
  | "log"

export type WorkflowTriggerType =
  | "sms_inbound"
  | "cron"
  | "dashboard"
  | "webhook"
  | "vendor_portal"
  | "automation"

export type WorkflowTemplateId =
  | "maintenance_intake"
  | "lease_renewal"
  | "rent_collection"
  | "vendor_job_response"
  | "identity_onboarding"
  | "landlord_command"
  // Seeded in workflow_templates; register in registry.ts when handlers ship:
  // | "move_in"
  // | "move_out"
  // | "inspection"

export type WorkflowRunStatus = "active" | "completed" | "escalated" | "cancelled"

/** Run state: graph links + template-specific keys. Core scope lives in top-level columns. */
export type WorkflowRunMetadata = {
  landlord_id?: string
  trigger_type?: WorkflowTriggerType
  lease_end_date?: string
  /** Rent collection billing period key (YYYY-MM). */
  billing_period?: string
  /** Outstanding balance when the run started. */
  amount_due?: number
  rent_due_date?: string
  due_at?: string
  /** rent_due_today | rent_overdue | partial_payment | paid | payment_plan_needed */
  rent_classification?: string
  classified_at?: string
  classification_source?: string
  payment_intent?: string
  payment_link?: string
  payment_requested?: boolean
  payment_provider?: string
  route_channels?: string[]
  /** Lease renewal and other multi-step flows. */
  step_state?: Record<string, unknown>
  /** SMS maintenance intake wizard state (mirrors sms_conversations.intake_state). */
  intake_state?: Record<string, unknown>
  escalated_at?: string
  submitted_at?: string
  unit_label?: string
}

export type WorkflowEntityType =
  | "sms_conversation"
  | "maintenance_request"
  | "user"
  | "unit"
  | "occupancy"
  | "inspection"
  | "task"

export type ClassifiedIntent = {
  templateId: WorkflowTemplateId | string
  confidence: "high" | "medium" | "low"
  reason: string
  runId?: string | null
}

export type WorkflowRunRow = {
  id: string
  template_id: WorkflowTemplateId
  workflow_type: string | null
  status: WorkflowRunStatus
  landlord_id: string | null
  trigger_type: WorkflowTriggerType | null
  entity_type: string | null
  entity_id: string | null
  property_id: string | null
  unit_id: string | null
  resident_id: string | null
  current_stage: string | null
  current_step: string | null
  started_at: string
  completed_at: string | null
  created_at: string
  updated_at: string
  metadata: WorkflowRunMetadata & Record<string, unknown>
}

export type WorkflowExecutionContext = {
  trigger: WorkflowTriggerType
  landlordId: string
  runId?: string | null
  activeRun?: WorkflowRunRow | null
  sms?: WorkflowContext
  cron?: {
    templateId: WorkflowTemplateId
    noticeDays?: number
    noResponseDays?: number
    /** Rent collection: day of month rent is due (1–28). */
    rentDueDay?: number
  }
}

export type WorkflowActResult = {
  templateId: WorkflowTemplateId
  route: string
  runId?: string | null
  replyHint?: string
  metadata: Record<string, unknown>
  shouldEscalate?: boolean
  escalationReason?: string
}

export type EscalationResult = {
  escalated: boolean
  reason: string
  metadata?: Record<string, unknown>
}

export type WorkflowTemplate = {
  id: WorkflowTemplateId
  name: string
  supportedTriggers: WorkflowTriggerType[]
  /** Score this template for the given context (null = not applicable). */
  classify(ctx: WorkflowExecutionContext): ClassifiedIntent | null
  act(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    intent: ClassifiedIntent,
  ): Promise<WorkflowActResult>
  escalate?(
    supabase: SupabaseClient,
    ctx: WorkflowExecutionContext,
    result: WorkflowActResult,
  ): Promise<EscalationResult | null>
}

export type WorkflowEngineResult = WorkflowActResult & {
  stages: WorkflowStage[]
  classified: ClassifiedIntent
}

/** POST body for programmatic workflow invocation (run-workflow-engine). */
export type InvokeWorkflowRequest = {
  template_type: string
  entity_type: WorkflowEntityType
  entity_id: string
  metadata?: Record<string, unknown>
  landlord_id?: string
  trigger_type?: WorkflowTriggerType
  property_id?: string | null
  resident_id?: string | null
  unit_id?: string | null
}

export type WorkflowNextAction = {
  template_id: string
  route: string
  action: string | null
  handler: string | null
  label: string | null
  domain: string | null
}

export type InvokeWorkflowResult = {
  workflow_run_id: string
  template_type: string
  classified: ClassifiedIntent
  next_action: WorkflowNextAction
  stages: WorkflowStage[]
  template: {
    id: string
    name: string
    type: string
    active: boolean
  }
}
