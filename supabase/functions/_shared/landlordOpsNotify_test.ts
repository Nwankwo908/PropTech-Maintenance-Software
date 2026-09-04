/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  collectLandlordSupportEmails,
  filterVendorEmailsFromOpsRecipients,
  normalizeOpsEmail,
  parseOpsEmailList,
  primaryLandlordSupportEmail,
  resolveLandlordOpsEmails,
} from "./landlordOpsNotify.ts"

Deno.test("normalizeOpsEmail lowercases and rejects junk", () => {
  assertEquals(normalizeOpsEmail("  Ops@Example.com "), "ops@example.com")
  assertEquals(normalizeOpsEmail("not-an-email"), null)
  assertEquals(normalizeOpsEmail(""), null)
})

Deno.test("parseOpsEmailList splits mixed separators", () => {
  assertEquals(
    parseOpsEmailList("a@ulo.io, b@ulo.io;c@ulo.io  d@ulo.io"),
    ["a@ulo.io", "b@ulo.io", "c@ulo.io", "d@ulo.io"],
  )
})

Deno.test("filterVendorEmailsFromOpsRecipients drops vendor addresses", () => {
  const { allowed, blocked } = filterVendorEmailsFromOpsRecipients(
    [
      "ops@ulohome.io",
      "Vendor@Acme.com",
      "landlord@property.com",
      "vendor@acme.com", // dup after normalize
    ],
    ["vendor@acme.com", "other@vendor.com"],
  )
  assertEquals(allowed, ["ops@ulohome.io", "landlord@property.com"])
  assertEquals(blocked, ["vendor@acme.com"])
})

Deno.test("filter never leaves a vendor on landlord approve list", () => {
  const { allowed } = filterVendorEmailsFromOpsRecipients(
    ["plumber@flex.com", "emeka@ulohome.io"],
    ["plumber@flex.com"],
  )
  assertEquals(allowed.includes("plumber@flex.com"), false)
  assertEquals(allowed, ["emeka@ulohome.io"])
})

Deno.test("primary support email prefers onboarding over login mailbox", () => {
  assertEquals(
    primaryLandlordSupportEmail({
      accountSetupEmail: "ceorentalsnj@gmail.com",
      organizationSupportEmail: "old@saved.com",
      landlordEmail: "limitedalpha1@ulohome.io",
    }),
    "ceorentalsnj@gmail.com",
  )
  assertEquals(
    collectLandlordSupportEmails({
      accountSetupEmail: "ceorentalsnj@gmail.com",
      landlordEmail: "limitedalpha1@ulohome.io",
    }),
    ["ceorentalsnj@gmail.com", "limitedalpha1@ulohome.io"],
  )
  assertEquals(
    primaryLandlordSupportEmail({
      landlordEmail: "limitedalpha1@ulohome.io",
      organizationSupportEmail: "nwankwo908@gmail.com",
    }),
    "nwankwo908@gmail.com",
  )
})

function mockLandlordOpsSupabase(params: {
  landlordEmail: string | null
  vendorEmails?: string[]
  accountSetupEmail?: string | null
}) {
  return {
    from(table: string) {
      if (table === "landlords") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: params.landlordEmail
                        ? { email: params.landlordEmail }
                        : null,
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === "landlord_onboarding") {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        draft_state: {
                          accountSetup: {
                            email: params.accountSetupEmail ?? null,
                          },
                        },
                        account_settings: {},
                      },
                      error: null,
                    }
                  },
                }
              },
            }
          },
        }
      }
      if (table === "vendors") {
        return {
          select() {
            return {
              eq() {
                return {
                  not() {
                    return {
                      async limit() {
                        return {
                          data: (params.vendorEmails ?? []).map((email) => ({
                            email,
                          })),
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

Deno.test("accountHolderOnly includes onboarding support email over login mailbox", async () => {
  const supabase = mockLandlordOpsSupabase({
    landlordEmail: "limitedalpha1@ulohome.io",
    accountSetupEmail: "ceorentalsnj@gmail.com",
    vendorEmails: [],
  })
  const { emails } = await resolveLandlordOpsEmails(
    supabase as never,
    "landlord-1",
    {
      accountHolderOnly: true,
      envEmails: ["osi@ulohome.io", "emeka@ulohome.io"],
    },
  )
  assertEquals(emails, ["ceorentalsnj@gmail.com"])
})

Deno.test("default resolve still includes env notify emails", async () => {
  const supabase = mockLandlordOpsSupabase({
    landlordEmail: "owner@alpha.com",
    vendorEmails: [],
  })
  const { emails } = await resolveLandlordOpsEmails(
    supabase as never,
    "landlord-1",
    {
      envEmails: ["osi@ulohome.io"],
    },
  )
  assertEquals(emails, ["osi@ulohome.io", "owner@alpha.com"])
})
