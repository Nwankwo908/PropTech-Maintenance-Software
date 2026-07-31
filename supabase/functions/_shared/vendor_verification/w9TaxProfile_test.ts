import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  maskTin,
  normalizeTinDigits,
  taxProfileComplete,
  taxProfileForEntity,
  tinFingerprint,
  tinLast4,
  validateTinDigits,
} from "./w9TaxProfile.ts"

Deno.test("sole proprietor → SSN / individual / 1099-NEC", () => {
  const p = taxProfileForEntity("sole_proprietor")
  assertEquals(p.tinType, "ssn")
  assertEquals(p.w9Variant, "individual")
  assertEquals(p.tax1099Treatment, "nec")
})

Deno.test("LLC / partnership → EIN / business / 1099-NEC", () => {
  for (const entity of ["llc", "partnership", "other"] as const) {
    const p = taxProfileForEntity(entity)
    assertEquals(p.tinType, "ein")
    assertEquals(p.w9Variant, "business")
    assertEquals(p.tax1099Treatment, "nec")
  }
})

Deno.test("corporation → EIN / business / no 1099", () => {
  const p = taxProfileForEntity("corporation")
  assertEquals(p.tinType, "ein")
  assertEquals(p.w9Variant, "business")
  assertEquals(p.tax1099Treatment, "none")
})

Deno.test("TIN normalize + validate + last4 + fingerprint", async () => {
  assertEquals(normalizeTinDigits("123-45-6789"), "123456789")
  assertEquals(validateTinDigits("123456789", "ssn").ok, true)
  assertEquals(validateTinDigits("12345", "ssn").ok, false)
  assertEquals(tinLast4("123456789"), "6789")
  const fp = await tinFingerprint("123456789")
  assertEquals(fp.length, 64)
  assertEquals(maskTin("ssn", "6789"), "•••-••-6789")
  assertEquals(maskTin("ein", "6789"), "••-•••6789")
})

Deno.test("taxProfileComplete requires W-9 + entity + TIN fingerprint", () => {
  assertEquals(
    taxProfileComplete({
      w9_received: true,
      tax_entity_type: "sole_proprietor",
      tin_type: "ssn",
      tin_last4: "6789",
      tin_fingerprint: "abc",
      w9_variant: "individual",
      tax_1099_treatment: "nec",
    }),
    true,
  )
  assertEquals(
    taxProfileComplete({
      w9_received: true,
      tax_entity_type: "llc",
      tin_type: "ssn", // wrong for LLC
      tin_last4: "6789",
      tin_fingerprint: "abc",
      w9_variant: "business",
      tax_1099_treatment: "nec",
    }),
    false,
  )
  assertEquals(
    taxProfileComplete({
      w9_received: false,
      tax_entity_type: "sole_proprietor",
      tin_type: "ssn",
      tin_last4: "6789",
      tin_fingerprint: "abc",
      w9_variant: "individual",
      tax_1099_treatment: "nec",
    }),
    false,
  )
})
