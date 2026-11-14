/**
 * SMS sandbox: replays a scripted conversation through the real inbound SMS
 * pipeline (`processInboundSms`) against an in-memory database.
 *
 * Safety:
 * - No network. `fetch` is replaced when a run starts and stays blocked. Twilio sends
 *   are captured, not sent. Every other request (AI models, Thumbtack,
 *   Supabase REST) fails fast, so the pipeline uses its deterministic
 *   fallbacks.
 * - No real accounts. Sandbox ids and +1555 numbers only; LA1/LA2 ids are
 *   rejected.
 * - Time is simulated, so "25 hours later" turns run instantly.
 */
import { FakeDb, type Row, type Tables } from "./fakeSupabase.ts"
import {
  LIMITED_ALPHA_LANDLORD_IDS,
} from "../../../../../shared/landlordCapabilities.ts"

export const SIM_LANDLORD_ID = "5a4d0000-0000-4000-8000-000000000001"
export const SIM_ULO_NUMBER = "+15550100001"
export const SIM_PROPERTY_ID = "5a4d0000-0000-4000-8000-0000000000a1"
export const SIM_UNIT_ID = "5a4d0000-0000-4000-8000-0000000000b1"
export const SIM_RESIDENT_ID = "5a4d0000-0000-4000-8000-0000000000c1"
export const SIM_RESIDENT_PHONE = "+15550102001"
export const SIM_VENDOR_ID = "5a4d0000-0000-4000-8000-0000000000d1"
export const SIM_VENDOR_PHONE = "+15550103001"
export const SIM_LANDLORD_PHONE = "+15550104001"

export const SIM_START = "2026-11-10T14:00:00.000Z"

export type SimSender = "resident" | "vendor" | "landlord"

export type SimTurn = {
  from: SimSender
  body: string
  /** Minutes after the previous turn (default 1). */
  minutesLater?: number
}

export type SimTurnResult = {
  turn: SimTurn
  at: string
  route: string | null
  /** SMS bodies Ulo would have sent during this turn (any recipient). */
  outbound: Array<{ to: string; body: string }>
  error: string | null
}

export type SimRun = {
  turns: SimTurnResult[]
  db: FakeDb
}

/** Base portfolio: one property, one unit, one resident, one plumber. */
export function baseSandboxTables(): Tables {
  const t = SIM_START
  return {
    landlords: [{
      id: SIM_LANDLORD_ID,
      name: "Sandbox Properties",
      phone: SIM_LANDLORD_PHONE,
      created_at: t,
    }],
    profiles: [{
      id: SIM_LANDLORD_ID,
      landlord_id: SIM_LANDLORD_ID,
      role: "landlord",
      phone: SIM_LANDLORD_PHONE,
      full_name: "Sam Sandbox",
    }],
    sms_numbers: [{
      id: "5a4d0000-0000-4000-8000-0000000000e1",
      landlord_id: SIM_LANDLORD_ID,
      vendor_id: null,
      phone_number: SIM_ULO_NUMBER,
      provider: "twilio",
      purpose: "landlord",
      status: "active",
      release_auto_reply: null,
    }],
    properties: [{
      id: SIM_PROPERTY_ID,
      landlord_id: SIM_LANDLORD_ID,
      name: "12 Sandbox St",
      address_line1: "12 Sandbox St",
      city: "Springfield",
      state: "NJ",
      postal_code: "07081",
      property_type: "multi_family",
    }],
    units: [{
      id: SIM_UNIT_ID,
      landlord_id: SIM_LANDLORD_ID,
      property_id: SIM_PROPERTY_ID,
      unit_label: "2B",
      building: "12 Sandbox St",
    }],
    users: [{
      id: SIM_RESIDENT_ID,
      resident_id: SIM_RESIDENT_ID,
      landlord_id: SIM_LANDLORD_ID,
      full_name: "Riley Resident",
      email: null,
      phone: SIM_RESIDENT_PHONE,
      unit: "2B",
      unit_id: SIM_UNIT_ID,
      building: "12 Sandbox St",
      property_id: SIM_PROPERTY_ID,
      status: "active",
      sms_consent: true,
      sms_opt_in_at: t,
      created_at: t,
    }],
    vendors: [{
      id: SIM_VENDOR_ID,
      landlord_id: SIM_LANDLORD_ID,
      name: "Sandbox Plumbing",
      phone: SIM_VENDOR_PHONE,
      email: null,
      category: "plumbing",
      active: true,
      notification_channel: "sms",
      roster_status: null,
      created_at: t,
    }],
    vendor_verifications: [{
      id: "5a4d0000-0000-4000-8000-0000000000f1",
      vendor_id: SIM_VENDOR_ID,
      landlord_id: SIM_LANDLORD_ID,
      status: "verified",
      availability: "accepting",
      updated_at: t,
    }],
    sms_identities: [{
      id: "5a4d0000-0000-4000-8000-0000000000f2",
      landlord_id: SIM_LANDLORD_ID,
      phone_number: SIM_RESIDENT_PHONE,
      identity_type: "resident",
      resident_id: SIM_RESIDENT_ID,
      vendor_id: null,
      unit: "2B",
      created_at: t,
    }],
  }
}

function senderPhone(from: SimSender): string {
  if (from === "vendor") return SIM_VENDOR_PHONE
  if (from === "landlord") return SIM_LANDLORD_PHONE
  return SIM_RESIDENT_PHONE
}

const SIM_ENV: Record<string, string> = {
  SUPABASE_URL: "https://sim.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "sim-service-role",
  TWILIO_ACCOUNT_SID: "ACsim00000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "sim-token",
  TWILIO_FROM_NUMBER: SIM_ULO_NUMBER,
}

/** Swap global time so Date.now() / new Date() follow the simulated clock. */
function installClock(getNow: () => number): () => void {
  const RealDate = Date
  class SimDate extends RealDate {
    constructor(...args: unknown[]) {
      super(...((args.length === 0 ? [getNow()] : args) as [string | number | Date]))
    }
    static override now(): number {
      return getNow()
    }
  }
  ;(globalThis as { Date: DateConstructor }).Date = SimDate as DateConstructor
  return () => {
    ;(globalThis as { Date: DateConstructor }).Date = RealDate
  }
}

function installEnv(): () => void {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(SIM_ENV)) {
    previous.set(key, Deno.env.get(key))
    Deno.env.set(key, value)
  }
  // Model keys must be absent so the pipeline cannot reach a live model.
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_API_KEY"]) {
    previous.set(key, Deno.env.get(key))
    Deno.env.delete(key)
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

function installFetch(capture: (to: string, body: string) => void): () => void {
  const realFetch = globalThis.fetch
  let sidCounter = 0
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url
    if (url.includes("api.twilio.com") && url.includes("/Messages")) {
      const raw = init?.body
      const params = new URLSearchParams(
        typeof raw === "string" ? raw : raw instanceof URLSearchParams ? raw.toString() : "",
      )
      const to = params.get("To") ?? ""
      const body = params.get("Body") ?? ""
      capture(to, body)
      sidCounter += 1
      return new Response(
        JSON.stringify({
          sid: `SMsim${String(sidCounter).padStart(29, "0")}`,
          status: "queued",
          to,
          body,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response(JSON.stringify({ error: "sandbox: network disabled" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  return () => {
    // Fire-and-forget work from the last turn may still be running. It must
    // never reach the real network, so the block stays after the run; only
    // Twilio capture stops. Sandbox runs belong in their own process (the
    // replay test file and the CLI).
    void realFetch
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "sandbox: network disabled" }), { status: 503 }),
      )) as typeof fetch
  }
}

export type SimOptions = {
  /** Extra or replacement rows merged over the base tables. */
  tables?: Tables
  /** Patch the resident's sms_conversations row (created on first turn). */
  conversation?: Row
}

export async function runSmsSandbox(
  turns: SimTurn[],
  opts: SimOptions = {},
): Promise<SimRun> {
  const tables = { ...baseSandboxTables(), ...(opts.tables ?? {}) }
  for (const row of tables.landlords ?? []) {
    if ((LIMITED_ALPHA_LANDLORD_IDS as readonly string[]).includes(String(row.id))) {
      throw new Error("SMS sandbox refuses Limited Alpha landlord ids")
    }
  }
  if (opts.conversation) {
    tables.sms_conversations = [{
      id: "5a4d0000-0000-4000-8000-000000000101",
      landlord_id: SIM_LANDLORD_ID,
      sms_number_id: "5a4d0000-0000-4000-8000-0000000000e1",
      external_phone_number: SIM_RESIDENT_PHONE,
      conversation_type: "resident",
      status: "open",
      resident_id: SIM_RESIDENT_ID,
      created_at: SIM_START,
      updated_at: SIM_START,
      last_message_at: SIM_START,
      ...opts.conversation,
    }]
  }

  let nowMs = Date.parse(SIM_START)
  const db = new FakeDb(tables, {}, {
    sms_messages: [["provider_message_sid"]],
  }, () => new Date(nowMs).toISOString())

  const pending: Array<{ to: string; body: string }> = []
  const restoreEnv = installEnv()
  const restoreFetch = installFetch((to, body) => pending.push({ to, body }))
  const restoreClock = installClock(() => nowMs)
  const { processInboundSms } = await import("../inbound_processor.ts")
  const { resetSMSProviderCache } = await import("../providerFactory.ts")
  resetSMSProviderCache()

  const results: SimTurnResult[] = []
  try {
    let n = 0
    for (const turn of turns) {
      n += 1
      nowMs += (turn.minutesLater ?? 1) * 60_000
      pending.length = 0
      let route: string | null = null
      let error: string | null = null
      try {
        const sid = `SMsimin${String(n).padStart(27, "0")}`
        const result = await processInboundSms(db.client(), {
          provider: "twilio",
          providerMessageSid: sid,
          messageId: sid,
          from: senderPhone(turn.from),
          to: SIM_ULO_NUMBER,
          body: turn.body,
          mediaUrls: [],
          rawPayload: {},
        })
        route = "workflowRoute" in result ? result.workflowRoute : null
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
      // Let fire-and-forget work (activity logs, async sends) settle.
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
      results.push({
        turn,
        at: new Date(nowMs).toISOString(),
        route,
        outbound: [...pending],
        error,
      })
    }
  } finally {
    restoreClock()
    restoreFetch()
    restoreEnv()
    resetSMSProviderCache()
  }
  return { turns: results, db }
}
