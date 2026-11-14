/**
 * Fixture format and checker for SMS sandbox replays.
 *
 * A fixture is a short conversation plus what Ulo should do with it. Each one
 * is a bug that was found once (in production, or by a simulation run) and
 * must never come back. See ./README.md.
 */
import type { Row } from "./fakeSupabase.ts"
import {
  runSmsSandbox,
  SIM_LANDLORD_ID,
  SIM_PROPERTY_ID,
  SIM_RESIDENT_ID,
  SIM_UNIT_ID,
  SIM_VENDOR_ID,
  type SimRun,
  type SimSender,
} from "./smsSandbox.ts"

export const SIM_TICKET_ID = "5a4d0000-0000-4000-8000-000000000201"

export type TurnExpect = {
  /** Workflow route Ulo must take. */
  route?: string
  /** Routes Ulo must not take. */
  routeNot?: string[]
  /** Every pattern must match at least one outbound SMS (case-insensitive). */
  replyMatches?: string[]
  /** No outbound SMS may match any of these (case-insensitive). */
  replyNotMatches?: string[]
  /** Ulo must send at least one SMS to the sender this turn. */
  replies?: boolean
}

export type SmsFixture = {
  id: string
  title: string
  /** Where the case came from: "production (anonymized)", "sandbox run", "code review". */
  origin: string
  /**
   * locked: must pass. known_bug: the bug still reproduces; the test passes
   * while it does and fails once it is fixed, so the fixture gets locked.
   */
  status: "locked" | "known_bug"
  /** For known_bug: the behavior Ulo shows today. */
  currentBehavior?: string
  setup?: {
    /** Seed an existing work order; fields merge over a default open plumbing ticket. */
    ticket?: Row | null
    /** Seed the resident's thread state (sms_conversations.intake_state). */
    intakeState?: Row
  }
  turns: Array<{
    from: SimSender
    body: string
    minutesLater?: number
    expect?: TurnExpect
  }>
  expectEnd?: {
    /** Work orders created during the conversation. */
    ticketsCreated?: number
  }
}

const TOKENS: Record<string, string> = {
  "{{TICKET_ID}}": SIM_TICKET_ID,
  "{{VENDOR_ID}}": SIM_VENDOR_ID,
  "{{RESIDENT_ID}}": SIM_RESIDENT_ID,
  "{{LANDLORD_ID}}": SIM_LANDLORD_ID,
}

function substitute<T>(value: T): T {
  let text = JSON.stringify(value)
  for (const [token, id] of Object.entries(TOKENS)) {
    text = text.split(token).join(id)
  }
  return JSON.parse(text) as T
}

function defaultTicket(): Row {
  return {
    id: SIM_TICKET_ID,
    landlord_id: SIM_LANDLORD_ID,
    resident_id: SIM_RESIDENT_ID,
    unit: "2B",
    unit_id: SIM_UNIT_ID,
    property_id: SIM_PROPERTY_ID,
    description: "Kitchen sink leaking",
    issue_category: "plumbing",
    status: "open",
    assigned_vendor_id: SIM_VENDOR_ID,
    vendor_work_status: "accepted",
    created_at: "2026-11-09T14:00:00.000Z",
  }
}

export async function runFixture(raw: SmsFixture): Promise<SimRun> {
  const fixture = substitute(raw)
  const ticket = fixture.setup?.ticket
    ? { ...defaultTicket(), ...fixture.setup.ticket }
    : null
  return await runSmsSandbox(
    fixture.turns.map(({ from, body, minutesLater }) => ({ from, body, minutesLater })),
    {
      tables: ticket ? { maintenance_requests: [ticket] } : {},
      conversation: ticket || fixture.setup?.intakeState
        ? {
          maintenance_request_id: ticket ? SIM_TICKET_ID : null,
          intake_state: fixture.setup?.intakeState ?? {},
        }
        : undefined,
    },
  )
}

/** Returns human-readable failures; empty means Ulo behaved as expected. */
export function checkFixture(raw: SmsFixture, run: SimRun): string[] {
  const fixture = substitute(raw)
  const failures: string[] = []
  fixture.turns.forEach((turn, i) => {
    const got = run.turns[i]
    const label = `turn ${i + 1} (${JSON.stringify(turn.body.slice(0, 60))})`
    if (!got) {
      failures.push(`${label}: did not run`)
      return
    }
    if (got.error) failures.push(`${label}: pipeline threw: ${got.error}`)
    const exp = turn.expect
    if (!exp) return
    if (exp.route && got.route !== exp.route) {
      failures.push(`${label}: route ${got.route}, expected ${exp.route}`)
    }
    if (exp.routeNot?.includes(got.route ?? "")) {
      failures.push(`${label}: route ${got.route} is not allowed here`)
    }
    const bodies = got.outbound.map((o) => o.body)
    if (exp.replies && bodies.length === 0) {
      failures.push(`${label}: Ulo sent no reply`)
    }
    for (const pattern of exp.replyMatches ?? []) {
      const re = new RegExp(pattern, "i")
      if (!bodies.some((b) => re.test(b))) {
        failures.push(`${label}: no reply matched /${pattern}/; got ${JSON.stringify(bodies)}`)
      }
    }
    for (const pattern of exp.replyNotMatches ?? []) {
      const re = new RegExp(pattern, "i")
      const hit = bodies.find((b) => re.test(b))
      if (hit) failures.push(`${label}: reply matched forbidden /${pattern}/: ${JSON.stringify(hit)}`)
    }
  })
  if (fixture.expectEnd?.ticketsCreated !== undefined) {
    const seeded = fixture.setup?.ticket ? 1 : 0
    const created = run.db.rows("maintenance_requests").length - seeded
    if (created !== fixture.expectEnd.ticketsCreated) {
      failures.push(
        `work orders created: ${created}, expected ${fixture.expectEnd.ticketsCreated}`,
      )
    }
  }
  return failures
}

/** Plain transcript for people (and agents) reading a run. */
export function formatTranscript(raw: SmsFixture, run: SimRun): string {
  const lines: string[] = [`# ${raw.id}: ${raw.title}`]
  raw.turns.forEach((turn, i) => {
    const got = run.turns[i]
    lines.push(`${turn.from.toUpperCase()}: ${turn.body}`)
    lines.push(`  route: ${got?.route ?? "(none)"}${got?.error ? `  ERROR: ${got.error}` : ""}`)
    for (const out of got?.outbound ?? []) {
      lines.push(`  ULO -> ${out.to}: ${out.body.replace(/\n+/g, " / ")}`)
    }
    if (got && got.outbound.length === 0) lines.push("  ULO: (no SMS sent)")
  })
  lines.push(`work orders in sandbox: ${run.db.rows("maintenance_requests").length}`)
  return lines.join("\n")
}
