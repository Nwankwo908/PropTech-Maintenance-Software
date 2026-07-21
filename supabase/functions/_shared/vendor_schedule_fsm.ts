/**
 * Vendor scheduling finite state machine.
 *
 * States: idle → awaiting_availability → awaiting_confirmation → scheduled
 * Cross-cutting: TTL expiry, context window, revision for out-of-order guards.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export const VENDOR_SCHEDULE_KEY = "vendor_schedule"
export const SCHEDULE_FSM_VERSION = 1 as const

/** How long a scheduling thread stays active without progress. */
export const SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000
/** Softer confirmations expire faster so a stale YES cannot lock an old slot. */
export const CONFIRM_TTL_MS = 2 * 60 * 60 * 1000
export const CONTEXT_WINDOW_MAX = 12
export const RECENT_OUTBOUND_MAX = 6

export type VendorScheduleStep =
  | "idle"
  | "awaiting_availability"
  | "awaiting_confirmation"
  | "scheduled"

export type ScheduleContextTurn = {
  role: "inbound" | "outbound"
  body: string
  at: string
  sid?: string
}

export type VendorScheduleFsmState = {
  v: typeof SCHEDULE_FSM_VERSION
  step: VendorScheduleStep
  ticketId: string
  /** Monotonic revision — reject stale writers / out-of-order applies. */
  revision: number
  enteredAt: string
  expiresAt: string
  lastProcessedInboundAt: string | null
  lastProcessedInboundSid: string | null
  pendingWindowText?: string
  pendingScheduledAt?: string | null
  pendingEndAt?: string | null
  pendingSince?: string
  contextWindow: ScheduleContextTurn[]
  recentOutboundNorm: string[]
}

export type ScheduleFsmEvent =
  | {
    type: "JOB_ACCEPTED"
    ticketId: string
    at: string
    inboundSid?: string
  }
  | {
    type: "AVAILABILITY_TEXT"
    at: string
    inboundSid?: string
    windowText: string
    scheduledAt: string | null
    endAt?: string | null
    outcome: "resolved" | "needs_confirmation" | "needs_clarification"
  }
  | {
    type: "CONFIRM_YES"
    at: string
    inboundSid?: string
  }
  | {
    type: "DECLINE"
    at: string
    inboundSid?: string
  }
  | {
    type: "SAVE_OK"
    at: string
    windowText: string
  }
  | {
    type: "SAVE_FAIL"
    at: string
    windowText: string
    scheduledAt: string | null
    endAt?: string | null
  }
  | {
    type: "OUTBOUND_SENT"
    at: string
    body: string
  }
  | {
    type: "TTL_CHECK"
    at: string
  }

export type ScheduleFsmEffect =
  | { kind: "ask_availability" }
  | { kind: "soft_confirm"; windowText: string }
  | { kind: "clarify"; prompt?: string }
  | {
    kind: "persist"
    windowText: string
    scheduledAt: string | null
  }
  | { kind: "save_retry"; windowText: string }
  | { kind: "confirmed_copy"; windowText: string }
  | { kind: "decline_ack" }
  | { kind: "expired"; prompt: string }
  | { kind: "noop"; reason: string }

export type ScheduleTransition = {
  state: VendorScheduleFsmState
  effect: ScheduleFsmEffect
  /** When true, caller must not send any SMS for this turn. */
  suppressReply: boolean
}

function iso(d = new Date()): string {
  return d.toISOString()
}

function addMs(at: string, ms: number): string {
  return new Date(new Date(at).getTime() + ms).toISOString()
}

export function normalizeSmsBody(body: string): string {
  return body.trim().toLowerCase().replace(/\s+/g, " ")
}

function pushContext(
  window: ScheduleContextTurn[],
  turn: ScheduleContextTurn,
): ScheduleContextTurn[] {
  const next = [...window, turn]
  if (next.length <= CONTEXT_WINDOW_MAX) return next
  return next.slice(next.length - CONTEXT_WINDOW_MAX)
}

function pushOutboundNorm(list: string[], body: string): string[] {
  const n = normalizeSmsBody(body)
  if (!n) return list
  const next = [...list, n]
  if (next.length <= RECENT_OUTBOUND_MAX) return next
  return next.slice(next.length - RECENT_OUTBOUND_MAX)
}

export function createIdleScheduleState(ticketId = ""): VendorScheduleFsmState {
  const at = iso()
  return {
    v: SCHEDULE_FSM_VERSION,
    step: "idle",
    ticketId,
    revision: 0,
    enteredAt: at,
    expiresAt: addMs(at, SCHEDULE_TTL_MS),
    lastProcessedInboundAt: null,
    lastProcessedInboundSid: null,
    contextWindow: [],
    recentOutboundNorm: [],
  }
}

/** Append a real inbound body to context (call after reduce with body). */
export function appendInboundContext(
  state: VendorScheduleFsmState,
  body: string,
  at: string,
  sid?: string,
): VendorScheduleFsmState {
  return {
    ...state,
    contextWindow: pushContext(state.contextWindow, {
      role: "inbound",
      body: body.slice(0, 280),
      at,
      sid,
    }),
  }
}

export function appendOutboundContext(
  state: VendorScheduleFsmState,
  body: string,
  at = iso(),
): VendorScheduleFsmState {
  return {
    ...state,
    recentOutboundNorm: pushOutboundNorm(state.recentOutboundNorm, body),
    contextWindow: pushContext(state.contextWindow, {
      role: "outbound",
      body: body.slice(0, 280),
      at,
    }),
  }
}

/**
 * True when this outbound would repeat a recent automated prompt
 * (circuit breaker / loop detector).
 */
export function wouldLoopOutbound(
  state: VendorScheduleFsmState | null | undefined,
  body: string,
  maxRepeats = 1,
): boolean {
  const n = normalizeSmsBody(body)
  if (!n || !state) return false
  const hits = state.recentOutboundNorm.filter((x) => x === n).length
  return hits >= maxRepeats
}

/** Stale / delayed inbound relative to last processed message. */
export function isStaleInbound(
  state: VendorScheduleFsmState | null | undefined,
  inboundAt: string,
  graceMs = 0,
): boolean {
  if (!state?.lastProcessedInboundAt) return false
  const last = new Date(state.lastProcessedInboundAt).getTime()
  const cur = new Date(inboundAt).getTime()
  if (Number.isNaN(last) || Number.isNaN(cur)) return false
  return cur + graceMs < last
}

export function isScheduleExpired(
  state: VendorScheduleFsmState | null | undefined,
  now = new Date(),
): boolean {
  if (!state || state.step === "idle" || state.step === "scheduled") return false
  const exp = new Date(state.expiresAt).getTime()
  return !Number.isNaN(exp) && now.getTime() > exp
}

function enterStep(
  state: VendorScheduleFsmState,
  step: VendorScheduleStep,
  at: string,
  ttlMs: number,
  patch: Partial<VendorScheduleFsmState> = {},
): VendorScheduleFsmState {
  return {
    ...state,
    ...patch,
    step,
    revision: state.revision + 1,
    enteredAt: at,
    expiresAt: addMs(at, ttlMs),
  }
}

/**
 * Pure FSM transition. Caller persists `state` and executes `effect`.
 */
export function reduceScheduleFsm(
  prev: VendorScheduleFsmState | null,
  event: ScheduleFsmEvent,
): ScheduleTransition {
  const base = prev ?? createIdleScheduleState(
    event.type === "JOB_ACCEPTED" ? event.ticketId : "",
  )

  // TTL gate (except when accepting a new job).
  if (
    event.type !== "JOB_ACCEPTED" &&
    event.type !== "TTL_CHECK" &&
    isScheduleExpired(base, new Date(event.at))
  ) {
    const cleared = enterStep(
      { ...base, ticketId: base.ticketId },
      "idle",
      event.at,
      SCHEDULE_TTL_MS,
      {
        pendingWindowText: undefined,
        pendingScheduledAt: undefined,
        pendingEndAt: undefined,
        pendingSince: undefined,
      },
    )
    return {
      state: cleared,
      effect: {
        kind: "expired",
        prompt:
          "That scheduling thread timed out. Reply YES if you still want the job and we will ask for your earliest availability again.",
      },
      suppressReply: false,
    }
  }

  if (event.type === "TTL_CHECK") {
    if (isScheduleExpired(base, new Date(event.at))) {
      return reduceScheduleFsm(base, {
        type: "DECLINE",
        at: event.at,
      })
    }
    return { state: base, effect: { kind: "noop", reason: "ttl_ok" }, suppressReply: true }
  }

  // Duplicate inbound SID — ignore.
  if (
    "inboundSid" in event &&
    event.inboundSid &&
    base.lastProcessedInboundSid &&
    event.inboundSid === base.lastProcessedInboundSid
  ) {
    return {
      state: base,
      effect: { kind: "noop", reason: "duplicate_inbound_sid" },
      suppressReply: true,
    }
  }

  // Delayed / out-of-order vs last processed inbound.
  if (
    "inboundSid" in event &&
    isStaleInbound(base, event.at, 500)
  ) {
    return {
      state: base,
      effect: { kind: "noop", reason: "stale_inbound" },
      suppressReply: true,
    }
  }

  switch (event.type) {
    case "JOB_ACCEPTED": {
      const next = enterStep(
        {
          ...base,
          ticketId: event.ticketId,
          pendingWindowText: undefined,
          pendingScheduledAt: undefined,
          pendingEndAt: undefined,
          pendingSince: undefined,
          lastProcessedInboundAt: event.at,
          lastProcessedInboundSid: event.inboundSid ?? null,
        },
        "awaiting_availability",
        event.at,
        SCHEDULE_TTL_MS,
      )
      return {
        state: next,
        effect: { kind: "ask_availability" },
        suppressReply: false,
      }
    }

    case "DECLINE": {
      const next = enterStep(
        {
          ...base,
          pendingWindowText: undefined,
          pendingScheduledAt: undefined,
          pendingEndAt: undefined,
          pendingSince: undefined,
          lastProcessedInboundAt: event.at,
          lastProcessedInboundSid: event.inboundSid ?? base.lastProcessedInboundSid,
        },
        "idle",
        event.at,
        SCHEDULE_TTL_MS,
      )
      return {
        state: next,
        effect: { kind: "decline_ack" },
        suppressReply: false,
      }
    }

    case "CONFIRM_YES": {
      if (base.step === "scheduled") {
        return {
          state: base,
          effect: { kind: "noop", reason: "already_scheduled" },
          suppressReply: true,
        }
      }
      const windowText = base.pendingWindowText?.trim()
      if (
        (base.step === "awaiting_confirmation" || windowText) &&
        windowText
      ) {
        const next: VendorScheduleFsmState = {
          ...base,
          revision: base.revision + 1,
          lastProcessedInboundAt: event.at,
          lastProcessedInboundSid: event.inboundSid ?? base.lastProcessedInboundSid,
        }
        return {
          state: next,
          effect: {
            kind: "persist",
            windowText,
            scheduledAt: base.pendingScheduledAt ?? null,
          },
          suppressReply: false,
        }
      }
      if (base.step === "awaiting_availability") {
        const next: VendorScheduleFsmState = {
          ...base,
          revision: base.revision + 1,
          lastProcessedInboundAt: event.at,
          lastProcessedInboundSid: event.inboundSid ?? base.lastProcessedInboundSid,
        }
        return {
          state: next,
          effect: {
            kind: "clarify",
            prompt: "What day and time works best? For example: Tomorrow 9am.",
          },
          suppressReply: false,
        }
      }
      return {
        state: base,
        effect: { kind: "noop", reason: "yes_without_context" },
        suppressReply: true,
      }
    }

    case "AVAILABILITY_TEXT": {
      if (base.step === "scheduled") {
        // Already booked — ignore late alternate times unless they force a new flow.
        return {
          state: {
            ...base,
            revision: base.revision + 1,
            lastProcessedInboundAt: event.at,
            lastProcessedInboundSid: event.inboundSid ?? base.lastProcessedInboundSid,
          },
          effect: { kind: "noop", reason: "already_scheduled" },
          suppressReply: true,
        }
      }

      const stepped =
        base.step === "idle"
          ? enterStep(base, "awaiting_availability", event.at, SCHEDULE_TTL_MS)
          : base

      const withInbound: VendorScheduleFsmState = {
        ...stepped,
        revision: stepped.revision + 1,
        lastProcessedInboundAt: event.at,
        lastProcessedInboundSid: event.inboundSid ?? stepped.lastProcessedInboundSid,
      }

      if (event.outcome === "needs_clarification") {
        return {
          state: withInbound,
          effect: { kind: "clarify" },
          suppressReply: false,
        }
      }

      if (event.outcome === "needs_confirmation") {
        const next = enterStep(
          {
            ...withInbound,
            pendingWindowText: event.windowText,
            pendingScheduledAt: event.scheduledAt,
            pendingEndAt: event.endAt ?? null,
            pendingSince: event.at,
          },
          "awaiting_confirmation",
          event.at,
          CONFIRM_TTL_MS,
        )
        return {
          state: next,
          effect: { kind: "soft_confirm", windowText: event.windowText },
          suppressReply: false,
        }
      }

      // High confidence — persist immediately.
      return {
        state: {
          ...withInbound,
          pendingWindowText: event.windowText,
          pendingScheduledAt: event.scheduledAt,
          pendingEndAt: event.endAt ?? null,
          pendingSince: event.at,
        },
        effect: {
          kind: "persist",
          windowText: event.windowText,
          scheduledAt: event.scheduledAt,
        },
        suppressReply: false,
      }
    }

    case "SAVE_OK": {
      const next = enterStep(
        {
          ...base,
          pendingWindowText: undefined,
          pendingScheduledAt: undefined,
          pendingEndAt: undefined,
          pendingSince: undefined,
        },
        "scheduled",
        event.at,
        SCHEDULE_TTL_MS,
      )
      return {
        state: next,
        effect: { kind: "confirmed_copy", windowText: event.windowText },
        suppressReply: false,
      }
    }

    case "SAVE_FAIL": {
      const next = enterStep(
        {
          ...base,
          pendingWindowText: event.windowText,
          pendingScheduledAt: event.scheduledAt,
          pendingEndAt: event.endAt ?? null,
          pendingSince: event.at,
        },
        "awaiting_confirmation",
        event.at,
        CONFIRM_TTL_MS,
      )
      return {
        state: next,
        effect: { kind: "save_retry", windowText: event.windowText },
        suppressReply: false,
      }
    }

    case "OUTBOUND_SENT": {
      return {
        state: appendOutboundContext(base, event.body, event.at),
        effect: { kind: "noop", reason: "outbound_recorded" },
        suppressReply: true,
      }
    }

    default:
      return {
        state: base,
        effect: { kind: "noop", reason: "unhandled" },
        suppressReply: true,
      }
  }
}

/** Parse persisted JSON (supports legacy 3-field shape). */
export function parseVendorScheduleFsm(
  raw: unknown,
): VendorScheduleFsmState | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const step = obj.step
  const ticketId = typeof obj.ticketId === "string" ? obj.ticketId : ""

  const legacyOk =
    step === "awaiting_availability" ||
    step === "awaiting_confirmation" ||
    step === "scheduled" ||
    step === "idle"
  if (!legacyOk) return null

  const at =
    typeof obj.enteredAt === "string" ? obj.enteredAt : iso()
  const expiresAt =
    typeof obj.expiresAt === "string"
      ? obj.expiresAt
      : addMs(at, step === "awaiting_confirmation" ? CONFIRM_TTL_MS : SCHEDULE_TTL_MS)

  const contextWindow = Array.isArray(obj.contextWindow)
    ? (obj.contextWindow as ScheduleContextTurn[]).filter(
      (t) =>
        t &&
        (t.role === "inbound" || t.role === "outbound") &&
        typeof t.body === "string" &&
        typeof t.at === "string",
    ).slice(-CONTEXT_WINDOW_MAX)
    : []

  const recentOutboundNorm = Array.isArray(obj.recentOutboundNorm)
    ? obj.recentOutboundNorm
      .filter((x): x is string => typeof x === "string")
      .map(normalizeSmsBody)
      .filter(Boolean)
      .slice(-RECENT_OUTBOUND_MAX)
    : []

  return {
    v: SCHEDULE_FSM_VERSION,
    step: step as VendorScheduleStep,
    ticketId,
    revision: typeof obj.revision === "number" ? obj.revision : 0,
    enteredAt: at,
    expiresAt,
    lastProcessedInboundAt:
      typeof obj.lastProcessedInboundAt === "string"
        ? obj.lastProcessedInboundAt
        : null,
    lastProcessedInboundSid:
      typeof obj.lastProcessedInboundSid === "string"
        ? obj.lastProcessedInboundSid
        : null,
    pendingWindowText: typeof obj.pendingWindowText === "string"
      ? obj.pendingWindowText
      : undefined,
    pendingScheduledAt: typeof obj.pendingScheduledAt === "string"
      ? obj.pendingScheduledAt
      : obj.pendingScheduledAt === null
      ? null
      : undefined,
    pendingEndAt: typeof obj.pendingEndAt === "string"
      ? obj.pendingEndAt
      : obj.pendingEndAt === null
      ? null
      : undefined,
    pendingSince: typeof obj.pendingSince === "string"
      ? obj.pendingSince
      : undefined,
    contextWindow,
    recentOutboundNorm,
  }
}

export function readVendorScheduleFsm(
  intakeState: Record<string, unknown> | null | undefined,
): VendorScheduleFsmState | null {
  if (!intakeState || typeof intakeState !== "object") return null
  return parseVendorScheduleFsm(intakeState[VENDOR_SCHEDULE_KEY])
}

export function withVendorScheduleFsm(
  intakeState: Record<string, unknown> | null | undefined,
  schedule: VendorScheduleFsmState | null,
): Record<string, unknown> {
  const base =
    intakeState && typeof intakeState === "object" ? { ...intakeState } : {}
  if (!schedule || (schedule.step === "idle" && !schedule.ticketId)) {
    delete base[VENDOR_SCHEDULE_KEY]
    return base
  }
  base[VENDOR_SCHEDULE_KEY] = schedule
  return base
}

/**
 * Optimistic write: only apply if conversation revision still matches
 * (guards concurrent / out-of-order processors).
 */
export async function persistVendorScheduleFsm(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    ticketId?: string | null
    next: VendorScheduleFsmState
    /** Expected revision before this transition (prev.revision). */
    expectedRevision?: number
  },
): Promise<{ ok: boolean; conflict: boolean }> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()

  const currentIntake =
    (convo?.intake_state as Record<string, unknown> | null) ?? {}
  const current = readVendorScheduleFsm(currentIntake)

  if (
    typeof params.expectedRevision === "number" &&
    current &&
    current.revision !== params.expectedRevision
  ) {
    console.warn("[vendor-schedule-fsm] revision conflict", {
      conversationId: params.conversationId,
      expected: params.expectedRevision,
      actual: current.revision,
    })
    return { ok: false, conflict: true }
  }

  const patch: Record<string, unknown> = {
    intake_state: withVendorScheduleFsm(currentIntake, params.next),
    updated_at: iso(),
  }
  if (params.ticketId) {
    patch.maintenance_request_id = params.ticketId
  }

  const { error } = await supabase
    .from("sms_conversations")
    .update(patch)
    .eq("id", params.conversationId)

  if (error) {
    console.error("[vendor-schedule-fsm] persist", error.message)
    return { ok: false, conflict: false }
  }
  return { ok: true, conflict: false }
}

/** Build a short prompt context string from the rolling window (for LLM). */
export function formatScheduleContextForPrompt(
  state: VendorScheduleFsmState | null | undefined,
): string {
  if (!state?.contextWindow?.length) return "(no prior scheduling turns)"
  return state.contextWindow
    .map((t) => `${t.role === "inbound" ? "Vendor" : "Ulo"}: ${t.body}`)
    .join("\n")
}
