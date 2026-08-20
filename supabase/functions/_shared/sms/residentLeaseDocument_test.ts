/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  leaseDocumentMatchesResident,
  MIN_LEASE_DOC_MATCH_SCORE,
  scoreLeaseDocumentAgainstResident,
} from "./residentLeaseDocument.ts"

Deno.test("Saad unit A must not match unrelated lease PDFs", () => {
  for (const file of [
    "78 Maple Ave Unit 3 2026 Lease A.pdf",
    "Lease-725 Bartlett.pdf",
    "Tamara-Cole-Lease.pdf",
  ]) {
    const result = scoreLeaseDocumentAgainstResident(
      {
        documentCategory: "lease_agreement",
        fileName: file,
        extractedPayload: {
          leases: [{ residentName: "Tynika Milan", unit: "A" }],
        },
      },
      { fullName: "Saad Iqbal", unit: "A" },
    )
    assertEquals(result.matched, false, file)
    assertEquals(result.score < MIN_LEASE_DOC_MATCH_SCORE, true, file)
  }
})

Deno.test("extracted tenant name is high confidence", () => {
  const result = scoreLeaseDocumentAgainstResident(
    {
      documentCategory: "lease_agreement",
      fileName: "random-scan.pdf",
      extractedPayload: {
        leases: [{ residentName: "Saad Iqbal", unit: "A" }],
      },
    },
    { fullName: "Saad Iqbal", unit: "A" },
  )
  assertEquals(result.reason, "extracted_name")
  assertEquals(result.score >= MIN_LEASE_DOC_MATCH_SCORE, true)
  assertEquals(leaseDocumentMatchesResident(
    {
      documentCategory: "lease_agreement",
      fileName: "random-scan.pdf",
      extractedPayload: { leases: [{ residentName: "Saad Iqbal" }] },
    },
    { fullName: "Saad Iqbal" },
  ), true)
})

Deno.test("full name tokens in filename are high confidence", () => {
  const result = scoreLeaseDocumentAgainstResident(
    {
      documentCategory: "lease_agreement",
      fileName: "Saad-Iqbal-Lease.pdf",
    },
    { fullName: "Saad Iqbal", unit: "A" },
  )
  assertEquals(result.reason, "filename_full_name")
  assertEquals(result.score >= MIN_LEASE_DOC_MATCH_SCORE, true)
})

Deno.test("last name alone is low confidence — do not send", () => {
  const result = scoreLeaseDocumentAgainstResident(
    { documentCategory: "lease_agreement", fileName: "Iqbal-lease.pdf" },
    { fullName: "Saad Iqbal", unit: "A" },
  )
  assertEquals(result.matched, false)
})

Deno.test("unit-only / address-only filename is low confidence — do not send", () => {
  assertEquals(
    leaseDocumentMatchesResident(
      { documentCategory: "lease_agreement", fileName: "Unit 4B Lease.pdf" },
      { fullName: "Tamara Cole", unit: "4B" },
    ),
    false,
  )
})

Deno.test("combined lessee line still matches the correct person", () => {
  assertEquals(
    leaseDocumentMatchesResident(
      {
        documentCategory: "lease_agreement",
        fileName: "78 Maple.pdf",
        extractedPayload: {
          leases: [{
            residentName: "Lorrayne Davis, Iris Frazier, Jayreid Freeman & Jaheem Martin",
          }],
        },
      },
      { fullName: "Iris Frazier", unit: "1" },
    ),
    true,
  )
  assertEquals(
    leaseDocumentMatchesResident(
      {
        documentCategory: "lease_agreement",
        fileName: "78 Maple.pdf",
        extractedPayload: {
          leases: [{
            residentName: "Lorrayne Davis, Iris Frazier, Jayreid Freeman & Jaheem Martin",
          }],
        },
      },
      { fullName: "Saad Iqbal", unit: "A" },
    ),
    false,
  )
})

Deno.test("non-lease categories never match", () => {
  assertEquals(
    leaseDocumentMatchesResident(
      {
        documentCategory: "insurance",
        fileName: "Saad-Iqbal.pdf",
        extractedPayload: { leases: [{ residentName: "Saad Iqbal" }] },
      },
      { fullName: "Saad Iqbal" },
    ),
    false,
  )
})
