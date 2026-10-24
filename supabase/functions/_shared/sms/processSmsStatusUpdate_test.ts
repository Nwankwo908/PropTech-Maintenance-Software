import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { processSmsStatusUpdate, smsProviderStatusRank } from "./processSmsStatusUpdate.ts"
import type { SMSStatusUpdate } from "./types.ts"

/**
 * Twilio treats delivered, undelivered, and failed as final.
 * They share one rank, so the first final status stands.
 * A later "delivered" after "failed" is a stale callback and is ignored.
 * `read` ranks above delivered when a channel reports it.
 */
function rank(status: string | null): number {
  return smsProviderStatusRank(status)
}

function update(status: string): SMSStatusUpdate {
  return {
    provider: "twilio",
    providerMessageSid: "SM1",
    messageId: "SM1",
    status,
    rawPayload: {},
  }
}

function createDb(initialStatus: string) {
  const message = {
    id: "msg-1",
    conversation_id: "convo-1",
    landlord_id: "landlord-1",
    provider_status: initialStatus,
    direction: "outbound",
  }
  const statusEvents: string[] = []
  const graphEvents: string[] = []
  const seen = new Set<string>()
  let chain: Promise<void> = Promise.resolve()

  function builder(table: string) {
    const state: { op?: string; payload?: Record<string, unknown> } = {}
    const api = {
      select() {
        return api
      },
      eq() {
        return api
      },
      in() {
        return api
      },
      order() {
        return api
      },
      limit() {
        return api
      },
      update(payload: Record<string, unknown>) {
        state.op = "update"
        state.payload = payload
        return api
      },
      insert(payload: Record<string, unknown>) {
        state.op = "insert"
        state.payload = payload
        if (table === "operations_graph_events" && typeof payload.event_type === "string") {
          graphEvents.push(payload.event_type)
        }
        return api
      },
      maybeSingle() {
        if (table === "sms_messages") return Promise.resolve({ data: { ...message }, error: null })
        return Promise.resolve({
          data: {
            unit_id: null,
            resident_id: null,
            vendor_id: null,
            maintenance_request_id: null,
          },
          error: null,
        })
      },
      single() {
        return Promise.resolve({ data: { id: "graph-1" }, error: null })
      },
      then(resolve: (value: { data: null; error: null }) => void) {
        if (
          state.op === "update" &&
          table === "sms_messages" &&
          typeof state.payload?.provider_status === "string"
        ) {
          message.provider_status = state.payload.provider_status
        }
        resolve({ data: null, error: null })
      },
    }
    return api
  }

  return {
    message,
    statusEvents,
    graphEvents,
    from(table: string) {
      return builder(table)
    },
    rpc(_name: string, args: { p_status: string }) {
      const run = chain.then(async () => {
        const next = args.p_status
        if (rank(message.provider_status) >= rank(next)) {
          return {
            data: {
              found: true,
              applied: false,
              stale: true,
              event_created: false,
              ...message,
            },
            error: null,
          }
        }
        const key = `${message.id}:${next}`
        const eventCreated = !seen.has(key)
        if (eventCreated) {
          seen.add(key)
          statusEvents.push(next)
        }
        message.provider_status = next
        return {
          data: {
            found: true,
            applied: true,
            stale: false,
            event_created: eventCreated,
            ...message,
          },
          error: null,
        }
      })
      chain = run.then(() => undefined, () => undefined)
      return run
    },
  }
}

Deno.test("delivered then late sent stays delivered with no event", async () => {
  const db = createDb("delivered")
  await processSmsStatusUpdate(db as never, update("sent"))
  assertEquals(db.message.provider_status, "delivered")
  assertEquals(db.statusEvents, [])
  assertEquals(db.graphEvents, [])
})

Deno.test("queued then sent then delivered records 3 events", async () => {
  const db = createDb("")
  await processSmsStatusUpdate(db as never, update("queued"))
  await processSmsStatusUpdate(db as never, update("sent"))
  await processSmsStatusUpdate(db as never, update("delivered"))
  assertEquals(db.message.provider_status, "delivered")
  assertEquals(db.statusEvents, ["queued", "sent", "delivered"])
})

Deno.test("two identical delivered callbacks record 1 event", async () => {
  const db = createDb("sent")
  await Promise.all([
    processSmsStatusUpdate(db as never, update("delivered")),
    processSmsStatusUpdate(db as never, update("delivered")),
  ])
  assertEquals(db.message.provider_status, "delivered")
  assertEquals(db.statusEvents, ["delivered"])
  assertEquals(db.graphEvents, ["sms.delivered"])
})

Deno.test("failed then delivered stays failed (Twilio final status)", async () => {
  const db = createDb("failed")
  await processSmsStatusUpdate(db as never, update("delivered"))
  assertEquals(db.message.provider_status, "failed")
  assertEquals(db.statusEvents, [])
  assertEquals(db.graphEvents.includes("sms.delivered"), false)
})
