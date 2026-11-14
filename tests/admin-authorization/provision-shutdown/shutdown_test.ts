import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import { handlers } from "../inspection-activation/server_stub.ts"
import { FakeDb } from "../../../supabase/functions/_shared/sms/sim/fakeSupabase.ts"
import {
  ensureLandlordMainSmsNumber,
  resolveOutboundLandlordSmsLine,
} from "../../../supabase/functions/_shared/sms/landlordSmsOnboarding.ts"
import {
  claimAvailablePoolNumber,
  claimPoolNumberByPhone,
  provisionLandlordMainNumber,
} from "../../../supabase/functions/_shared/sms/smsNumberPool.ts"
import { resolveInboundSmsNumber } from "../../../supabase/functions/_shared/sms/inbound_db.ts"
import { TwilioProvider } from "../../../supabase/functions/_shared/sms/TwilioProvider.ts"
await import("../../../supabase/functions/provision-sms-number/index.ts")
const A = "5a4d0000-0000-4000-8000-000000000001",
  B = "5a4d0000-0000-4000-8000-000000000002",
  PLATFORM_OWNER = "5a4d0000-0000-4000-8000-000000000003"
const shared = {
  id: "canonical-line",
  landlord_id: PLATFORM_OWNER,
  phone_number: "+18775803356",
  provider: "twilio",
  purpose: "landlord_main",
  status: "active",
  provider_number_sid: "synthetic-canonical-sid",
}
function db() {
  return new FakeDb({
    sms_numbers: [shared, {
      id: "legacy-line",
      landlord_id: A,
      phone_number: "+15550109999",
      provider: "twilio",
      purpose: "landlord_main",
      status: "active",
    }, {
      id: "pool-line",
      landlord_id: null,
      phone_number: "+15550109998",
      provider: "twilio",
      purpose: "pool",
      status: "available",
    }],
  })
}
Deno.test("two new/current landlords reuse one canonical line and never transfer ownership or claim a pool row", async () => {
  const store = db()
  const before = JSON.stringify(store.tables)
  for (const id of [A, B, A]) {
    const result = await ensureLandlordMainSmsNumber(store.client(), id)
    assertEquals(result.number.id, shared.id)
    assertEquals(result.created, false)
    assertEquals(
      (await resolveOutboundLandlordSmsLine(store.client(), id))?.phone,
      shared.phone_number,
    )
    assertEquals(
      (await provisionLandlordMainNumber(store.client(), { landlordId: id }))
        .smsNumberId,
      shared.id,
    )
  }
  assertEquals(JSON.stringify(store.tables), before)
  assertEquals(store.ops.every((op) => op.op === "select"), true)
})
for (const mode of ["missing", "inactive", "duplicate", "lookup_error"]) {
  Deno.test(`canonical line ${mode}: fail closed without a dedicated fallback`, async () => {
    const store = db()
    if (mode === "missing") {
      store.tables.sms_numbers = store.rows("sms_numbers").filter((row) =>
        row.id !== shared.id
      )
    }
    if (mode === "inactive") store.rows("sms_numbers")[0].status = "inactive"
    if (mode === "duplicate") {
      store.rows("sms_numbers").push({
        ...shared,
        id: "duplicate",
        phone_number: "8775803356",
      })
    }
    if (mode === "lookup_error") store.readFailures.add("sms_numbers")
    const before = JSON.stringify(store.tables)
    await assertRejects(
      () => ensureLandlordMainSmsNumber(store.client(), A),
      Error,
      "Shared Ulo SMS line is unavailable",
    )
    assertEquals(JSON.stringify(store.tables), before)
    assertEquals(store.ops.every((op) => op.op === "select"), true)
  })
}
for (
  const override of [{ phoneNumber: "+15550108888" }, {
    providerNumberSid: "synthetic-other-sid",
  }, { areaCode: "555" }]
) {
  Deno.test(`provision helper refuses caller overrides ${JSON.stringify(override)}`, async () => {
    const store = db()
    await assertRejects(
      () =>
        provisionLandlordMainNumber(store.client(), {
          landlordId: A,
          ...override,
        }),
      Error,
      "overrides",
    )
    assertEquals(store.ops.length, 0)
  })
}
Deno.test("pool claim exports refuse both allocation paths before database access", async () => {
  const store = db()
  await assertRejects(
    () => claimAvailablePoolNumber(store.client(), A),
    Error,
    "allocation is retired",
  )
  await assertRejects(
    () =>
      claimPoolNumberByPhone(store.client(), {
        landlordId: A,
        phoneNumber: "+15550109998",
      }),
    Error,
    "allocation is retired",
  )
  assertEquals(store.ops.length, 0)
})
Deno.test("inbound traffic cannot claim a pool row or use DEFAULT_LANDLORD_ID", async () => {
  const savedDefault = Deno.env.get("DEFAULT_LANDLORD_ID")
  Deno.env.set("DEFAULT_LANDLORD_ID", A)
  try {
    const store = db()
    const before = JSON.stringify(store.tables)
    assertEquals(
      await resolveInboundSmsNumber(store.client(), "+15550109998"),
      null,
    )
    store.rows("sms_numbers").find((row) => row.id === "pool-line")!.status =
      "active"
    assertEquals(
      await resolveInboundSmsNumber(store.client(), "+15550109998"),
      null,
    )
    store.rows("sms_numbers").find((row) => row.id === "pool-line")!.status =
      "available"
    assertEquals(JSON.stringify(store.tables), before)
    assertEquals(store.ops.every((op) => op.op === "select"), true)
  } finally {
    if (savedDefault === undefined) Deno.env.delete("DEFAULT_LANDLORD_ID")
    else Deno.env.set("DEFAULT_LANDLORD_ID", savedDefault)
  }
})
for (const method of ["GET", "POST", "DELETE"]) {
  Deno.test(`provision endpoint ${method} is retired without any database/provider call`, async () => {
    const response = await handlers[0](
      new Request("https://retired.invalid", {
        method,
        ...(method === "POST" ? { body: "not-json" } : {}),
      }),
    )
    assertEquals(response.status, 410)
    assertEquals(
      (await response.json()).code,
      "SMS_NUMBER_PROVISIONING_RETIRED",
    )
  })
}
Deno.test("retired provision preflight remains no-action", async () =>
  assertEquals(
    (await handlers[0](
      new Request("https://retired.invalid", { method: "OPTIONS" }),
    )).status,
    200,
  ))

Deno.test("provider adapter cannot allocate even with caller-supplied phone and SID", async () => {
  await assertRejects(
    () =>
      new TwilioProvider().provisionNumber({
        phoneNumber: "+15550108888",
        providerNumberSid: "synthetic-sid",
      }),
    Error,
    "provisioning is retired",
  )
})
Deno.test("shared resolver does not fall back to an alternate environment sender", async () => {
  const saved = Deno.env.get("TWILIO_FROM_NUMBER")
  Deno.env.set("TWILIO_FROM_NUMBER", "+15550109999")
  try {
    assertEquals(
      (await ensureLandlordMainSmsNumber(db().client(), B)).number.phone_number,
      "+18775803356",
    )
  } finally {
    if (saved === undefined) Deno.env.delete("TWILIO_FROM_NUMBER")
    else Deno.env.set("TWILIO_FROM_NUMBER", saved)
  }
})
