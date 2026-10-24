import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  commitRetryClaim,
  handleRetryFailedDelivery,
  lostRetryClaim,
  type DeliveryLog,
  type RetryDeps,
} from "./retryFailedDelivery.ts"

const LOG = "11111111-1111-4111-8111-111111111111"
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const NOW = new Date("2026-10-24T15:00:00.000Z")
const INTERNAL = "internal-secret-not-the-anon-key"
const ANON = "anon-key-must-not-pass"
const USER_JWT = "header.eyJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig"

function post(body: unknown, headers?: HeadersInit): Request {
  return new Request("https://example.test/retry-failed-delivery", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function log(overrides: Partial<DeliveryLog> = {}): DeliveryLog {
  return {
    id: LOG,
    landlordId: OWNER,
    source: "resident",
    channel: "sms",
    status: "failed",
    createdAt: "2026-10-23T15:00:00.000Z",
    retryCount: 0,
    lastRetryAt: null,
    recipientOptedOut: false,
    results: {},
    ...overrides,
  }
}

function harness(row: DeliveryLog | null, landlords: string[] | null = [OWNER]): {
  deps: RetryDeps
  sends: { count: number }
} {
  const sends = { count: 0 }
  const deps: RetryDeps = {
    now: () => NOW,
    env: { internalKey: INTERNAL, anonKey: ANON },
    resolveLandlords: async () => landlords,
    loadLog: async ({ logId, landlordIds }) => {
      if (!row || row.id !== logId) return null
      if (landlordIds && !landlordIds.includes(row.landlordId)) return null
      return row
    },
    claim: async (current) => {
      const expected = current.retryCount
      await Promise.resolve()
      if (current.retryCount !== expected) return lostRetryClaim(current)
      return commitRetryClaim(current, NOW, 0)
    },
    send: async () => {
      sends.count += 1
    },
    storeResult: async (key, body) => {
      if (row) row.results[key] = body
    },
  }
  return { deps, sends }
}

Deno.test("no auth → 401 and does not send", async () => {
  const { deps, sends } = harness(log())
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }),
    deps,
  )
  assertEquals(res.status, 401)
  assertEquals(sends.count, 0)
})

Deno.test("other landlord's logId → 404", async () => {
  const { deps, sends } = harness(log({ landlordId: OTHER }), [OWNER])
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      Authorization: `Bearer ${USER_JWT}`,
    }),
    deps,
  )
  assertEquals(res.status, 404)
  assertEquals(sends.count, 0)
})

Deno.test("delivered row → 409", async () => {
  const { deps, sends } = harness(log({ status: "delivered" }))
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      Authorization: `Bearer ${USER_JWT}`,
    }),
    deps,
  )
  assertEquals(res.status, 409)
  assertEquals(await res.json(), { error: "not_failed" })
  assertEquals(sends.count, 0)
})

Deno.test("4th retry → 429", async () => {
  const { deps, sends } = harness(log({ retryCount: 3 }))
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      Authorization: `Bearer ${USER_JWT}`,
    }),
    deps,
  )
  assertEquals(res.status, 429)
  assertEquals(await res.json(), { error: "retry_limit" })
  assertEquals(sends.count, 0)
})

Deno.test("two concurrent requests → exactly one send", async () => {
  const row = log()
  const { deps } = harness(row)
  const [first, second] = await Promise.all([
    handleRetryFailedDelivery(
      post({ source: "resident", logId: LOG, channel: "sms" }, {
        Authorization: `Bearer ${USER_JWT}`,
      }),
      deps,
    ),
    handleRetryFailedDelivery(
      post({ source: "resident", logId: LOG, channel: "sms" }, {
        Authorization: `Bearer ${USER_JWT}`,
      }),
      deps,
    ),
  ])
  const bodies = await Promise.all([first.json(), second.json()])
  const sentBodies = bodies.filter((body) => body.ok === true)
  assertEquals(sentBodies.length, 1)
  assertEquals(row.retryCount, 1)
})

Deno.test("repeat request returns the original result without sending again", async () => {
  const row = log()
  const { deps, sends } = harness(row)
  const headers = { Authorization: `Bearer ${USER_JWT}` }
  const first = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, headers),
    deps,
  )
  const second = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, headers),
    deps,
  )
  assertEquals(first.status, 200)
  assertEquals(second.status, 200)
  assertEquals(await second.json(), await first.clone().json())
  assertEquals(sends.count, 1)
  assertEquals(row.retryCount, 1)
})

Deno.test("internal key → 200", async () => {
  const { deps, sends } = harness(log(), null)
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      "X-Ulo-Internal-Key": INTERNAL,
    }),
    deps,
  )
  assertEquals(res.status, 200)
  assertEquals(sends.count, 1)
})

Deno.test("wrong internal key → 401", async () => {
  const { deps, sends } = harness(log())
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      "X-Ulo-Internal-Key": "wrong-key",
      Authorization: `Bearer ${USER_JWT}`,
    }),
    deps,
  )
  assertEquals(res.status, 401)
  assertEquals(sends.count, 0)
})

Deno.test("anon key is not an internal credential", async () => {
  const { deps, sends } = harness(log())
  const res = await handleRetryFailedDelivery(
    post({ source: "resident", logId: LOG, channel: "sms" }, {
      "X-Ulo-Internal-Key": ANON,
    }),
    deps,
  )
  assertEquals(res.status, 401)
  assertEquals(sends.count, 0)
})
