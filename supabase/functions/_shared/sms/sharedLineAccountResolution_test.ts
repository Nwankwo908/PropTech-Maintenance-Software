import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { FakeDb, type Tables } from "./sim/fakeSupabase.ts"
import {
  resolveSharedLineInboundAccount,
  SHARED_ACCOUNT_SELECTION_MS,
} from "./inbound_db.ts"
import { sharedLineWorkOrderSelector } from "./sharedLineSelector.ts"
const A = "5a4d0000-0000-4000-8000-000000000001",
  B = "5a4d0000-0000-4000-8000-000000000002",
  C = "5a4d0000-0000-4000-8000-000000000003"
const FROM = "+15550102001", LINE = "synthetic-shared-line"
function seed(): Tables {
  return {
    users: [{ id: "resident-a", landlord_id: A, phone: FROM }, {
      id: "resident-b",
      landlord_id: B,
      phone: FROM,
    }],
    properties: [
      { id: "property-a", landlord_id: A, street_address: "12 Sandbox St" },
      { id: "property-b", landlord_id: B, street_address: "34 Test Rd" },
      { id: "property-c", landlord_id: C, street_address: "56 Foreign Ave" },
    ],
    maintenance_requests: [
      { id: "aaaa0000-0000-4000-8000-000000000001", landlord_id: A },
      { id: "bbbb0000-0000-4000-8000-000000000002", landlord_id: B },
      { id: "cccc0000-0000-4000-8000-000000000003", landlord_id: C },
    ],
  }
}
async function resolve(body: string, tables = seed(), failTable?: string) {
  const db = new FakeDb(tables)
  if (failTable) db.readFailures.add(failTable)
  const result = await resolveSharedLineInboundAccount(db.client(), {
    from: FROM,
    body,
    smsNumberId: LINE,
  })
  assertEquals(
    db.ops.every((op) => op.op === "select"),
    true,
    "account resolution must not write",
  )
  return result
}
for (
  const table of [
    "users",
    "vendors",
    "sms_identities",
    "landlords",
    "properties",
    "landlord_onboarding",
    "sms_phone_account_disconnects",
    "sms_conversations",
  ]
) {
  Deno.test(`shared-line discovery ${table} outage never chooses from partial evidence`, async () => {
    assertEquals((await resolve("YES", seed(), table)).reason, "unavailable")
  })
}
Deno.test("shared-line overflow fails closed even when first rows look like one account", async () => {
  const tables = seed()
  tables.users = Array.from(
    { length: 201 },
    (_, i) => ({ id: i, landlord_id: A, phone: FROM }),
  )
  assertEquals((await resolve("YES", tables)).reason, "unavailable")
})
Deno.test("shared-line owner phone and manager phone matches are both considered", async () => {
  const tables = seed()
  tables.users = []
  tables.landlords = [{ id: A, phone: FROM }]
  tables.properties![1].manager_phone = FROM
  assertEquals((await resolve("YES", tables)).reason, "ambiguous")
})
Deno.test("shared-line discovers a non-Alpha landlord phone", async () => {
  const tables = seed()
  tables.users = []
  tables.landlords = [{ id: B, phone: FROM }]
  assertEquals((await resolve("Hello", tables)).landlordId, B)
})
Deno.test("shared-line discovers the stored non-Alpha organization backup phone", async () => {
  const tables = seed()
  tables.users = []
  tables.landlord_onboarding = [{
    landlord_id: B,
    account_settings: { organization: { backupContactPhone: FROM } },
  }]
  assertEquals((await resolve("Hello", tables)).landlordId, B)
})
Deno.test("shared-line outbound history alone cannot establish sender linkage", async () => {
  const tables = seed()
  tables.users = []
  tables.sms_messages = [{
    landlord_id: C,
    direction: "outbound",
    to_number: FROM,
    created_at: new Date().toISOString(),
  }]
  assertEquals((await resolve("WO-CCCC", tables)).landlordId, null)
})
Deno.test("shared-line selected context requires current membership, line, sender and unexpired timestamp", async () => {
  const selection = {
    selectedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SHARED_ACCOUNT_SELECTION_MS).toISOString(),
  }
  const row = {
    landlord_id: B,
    sms_number_id: LINE,
    external_phone_number: FROM,
    status: "open",
    intake_state: { shared_line_selection: selection },
  }
  const tables = seed()
  tables.sms_conversations = [row]
  assertEquals((await resolve("YES", tables)).landlordId, B)
  for (
    const patch of [
      { sms_number_id: "foreign-line" },
      { external_phone_number: "+15550109999" },
      { status: "closed" },
      { landlord_id: C },
      {
        intake_state: {
          shared_line_selection: {
            ...selection,
            expiresAt: new Date(Date.now() - 1).toISOString(),
          },
        },
      },
    ]
  ) {
    tables.sms_conversations = [{ ...row, ...patch }]
    assertEquals((await resolve("YES", tables)).landlordId, null)
  }
})
Deno.test("shared-line disconnect revokes selected context without silently switching accounts", async () => {
  const tables = seed()
  tables.sms_conversations = [{
    landlord_id: B,
    sms_number_id: LINE,
    external_phone_number: FROM,
    status: "open",
    intake_state: {
      shared_line_selection: {
        selectedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
  }]
  tables.sms_phone_account_disconnects = [{
    phone_number: FROM,
    landlord_id: B,
  }]
  assertEquals((await resolve("YES", tables)).landlordId, null)
  assertEquals((await resolve("WO-BBBB", tables)).landlordId, null)
  assertEquals((await resolve("12 Sandbox Street", tables)).landlordId, A)
})
Deno.test("shared-line a foreign selector cannot fall back to an existing valid selection", async () => {
  const tables = seed()
  tables.sms_conversations = [{
    landlord_id: B,
    sms_number_id: LINE,
    external_phone_number: FROM,
    status: "open",
    intake_state: {
      shared_line_selection: {
        selectedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
  }]
  assertEquals((await resolve("YES WO-CCCC", tables)).landlordId, null)
  assertEquals((await resolve("56 Foreign Ave", tables)).landlordId, null)
})
for (
  const body of [
    "YES WO-ABC",
    "YES WO-GGGG",
    "YES WO-AAAA WO-BBBB",
    "YES WO-BBBB at 12 Sandbox Street",
  ]
) {
  Deno.test(`shared-line malformed/conflicting selectors fail closed: ${body}`, () =>
    assertEquals(sharedLineWorkOrderSelector(body).kind, "invalid"))
}

Deno.test("shared-line Home Check hint still observes sender disconnects", async () => {
  const tables = seed()
  tables.sms_phone_account_disconnects = [{
    phone_number: FROM,
    landlord_id: B,
  }]
  const db = new FakeDb(tables)
  const result = await resolveSharedLineInboundAccount(db.client(), {
    from: FROM,
    body: "HC-ABCDEF123456",
    smsNumberId: LINE,
    homeCheckLandlordId: B,
  })
  assertEquals(result.landlordId, null)
})
for (
  const body of [
    "I would like help",
    "The wooden door is stuck",
    "What work needs doing?",
  ]
) {
  Deno.test(`shared-line normal words are not mistaken for work-order IDs: ${body}`, () =>
    assertEquals(sharedLineWorkOrderSelector(body).kind, "none"))
}

Deno.test("shared-line Home Check reference narrows existing links but never creates one", async () => {
  const db = new FakeDb(seed())
  const result = await resolveSharedLineInboundAccount(db.client(), { from: FROM, body: "HC-ABCDEF123456", smsNumberId: LINE, homeCheckLandlordId: C })
  assertEquals(result.landlordId, null)
  assertEquals(result.reason, "selector_not_found")
})

Deno.test("shared-line vendor can select assigned work orders but cannot enumerate unassigned jobs", async () => {
  const tables = seed(); tables.users = []; tables.vendors = [{ id: "vendor-b", landlord_id: B, phone: FROM, active: true }]
  tables.maintenance_requests![1].assigned_vendor_id = "another-vendor"
  assertEquals((await resolve("WO-BBBB", tables)).landlordId, null)
  tables.maintenance_requests![1].assigned_vendor_id = "vendor-b"
  assertEquals((await resolve("WO-BBBB", tables)).landlordId, B)
})
Deno.test("shared-line resident cannot select another resident's work order in the same account", async () => {
  const tables = seed(); tables.maintenance_requests![1].resident_id = "other-resident"
  assertEquals((await resolve("WO-BBBB", tables)).landlordId, null)
  tables.maintenance_requests![1].resident_id = "resident-b"
  assertEquals((await resolve("WO-BBBB", tables)).landlordId, B)
})
