import {
  buildResidentRequestConfirmationSms,
  pickUniqueResidentRequestRef,
  residentRequestRef,
} from "../../../../shared/maintenance/residentRequestRef.ts"

const AC_ID = "30a0b8cc-4284-42a7-8139-b59e219219f0"
const FAUCET_ID = "676fe1dd-e025-4608-bec5-045e0a3345f5"

Deno.test("existing tickets keep their 8-character refs", () => {
  if (residentRequestRef(AC_ID) !== "30A0B8CC") {
    throw new Error(residentRequestRef(AC_ID))
  }
  if (residentRequestRef(FAUCET_ID) !== "676FE1DD") {
    throw new Error(residentRequestRef(FAUCET_ID))
  }
  if (residentRequestRef(AC_ID, "30A0B8CC") !== "30A0B8CC") {
    throw new Error("stored ref was replaced")
  }
})

Deno.test("a colliding prefix gets a longer ref and does not change the earlier one", () => {
  const next = pickUniqueResidentRequestRef(
    "30a0b8cc-9999-4000-8000-000000000002",
    ["30A0B8CC"],
  )
  if (next === "30A0B8CC") throw new Error("short ref collided")
  if (!next.startsWith("30A0B8CC")) throw new Error(next)
  if (next.length < 12) throw new Error(next)
  if (residentRequestRef(AC_ID, "30A0B8CC") !== "30A0B8CC") {
    throw new Error("earlier ref changed")
  }
})

Deno.test("confirmation uses one short ref and does not promise a vendor", () => {
  const sms = buildResidentRequestConfirmationSms({
    requestRef: "30A0B8CC",
    requestPhrase: "AC repair",
    vendorWillContact: false,
  })
  if (sms !== "Thanks! We've received your AC repair request. We'll text you here with updates.\n\nRef: 30A0B8CC") {
    throw new Error(sms)
  }
  if (sms.includes(AC_ID)) throw new Error("full id leaked")
})
