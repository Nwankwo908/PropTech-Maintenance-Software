/**
 * Landlord can't-process replies — link-only, unsupported type, unrecognized doc.
 */
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  buildLandlordGenericLinkReplySms,
  buildLandlordHqsLetterLinkReplySms,
  buildLandlordUnrecognizedAttachmentReplySms,
  buildLandlordUnsupportedAttachmentReplySms,
  classifyLandlordLinkOnlyMessage,
  describeLandlordAttachmentType,
  findUnsupportedLandlordAttachment,
  isLandlordSupportedAttachmentContentType,
  shouldReplyLandlordUnrecognizedAttachment,
} from "./landlordInboundCantProcess.ts"

Deno.test("HABC ViewLetter + section 8 text → hqs_letter_link (Kendo 9/27 case)", () => {
  const kind = classifyLandlordLinkOnlyMessage({
    body:
      "https://habc.hcvinspect.com/Home/ViewLetter?L=Q3ZrKzBPUGYwUkVqYk56aUkyWlhmeG8rRlJnTm5lWnNNZkFVT1E9PQ2\nCreate work order based on section 8 inspection",
    mediaCount: 0,
  })
  assertEquals(kind, "hqs_letter_link")
  const sms = buildLandlordHqsLetterLinkReplySms()
  assertMatch(sms, /can't open web links/i)
  assertMatch(sms, /photo or PDF/i)
  assertMatch(sms, /S8landlord@habc\.org/i)
  assertEquals(sms.toLowerCase().includes("maintenance issue"), false)
})

Deno.test("ViewLetter-only URL with no attachment → hqs_letter_link", () => {
  assertEquals(
    classifyLandlordLinkOnlyMessage({
      body:
        "https://habc.hcvinspect.com/Home/ViewLetter?L=abc123",
      mediaCount: 0,
    }),
    "hqs_letter_link",
  )
})

Deno.test("unrelated link with no attachment → generic_link", () => {
  const kind = classifyLandlordLinkOnlyMessage({
    body: "See https://example.com/invoice/123 for details",
    mediaCount: 0,
  })
  assertEquals(kind, "generic_link")
  const sms = buildLandlordGenericLinkReplySms()
  assertMatch(sms, /can't open links sent by text/i)
  assertMatch(sms, /photo or PDF/i)
  assertEquals(sms.includes("S8landlord"), false)
})

Deno.test("URL with an attachment present is not link-only", () => {
  assertEquals(
    classifyLandlordLinkOnlyMessage({
      body: "https://habc.hcvinspect.com/Home/ViewLetter?L=abc",
      mediaCount: 1,
    }),
    null,
  )
})

Deno.test("plain text without URL is not link-only", () => {
  assertEquals(
    classifyLandlordLinkOnlyMessage({
      body: "Create work order based on section 8 inspection",
      mediaCount: 0,
    }),
    null,
  )
})

Deno.test("unsupported HEIC and non-PDF document types", () => {
  assertEquals(isLandlordSupportedAttachmentContentType("image/heic"), false)
  assertEquals(isLandlordSupportedAttachmentContentType("image/heif"), false)
  assertEquals(
    isLandlordSupportedAttachmentContentType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    false,
  )
  assertEquals(isLandlordSupportedAttachmentContentType("video/mp4"), false)
  assertEquals(isLandlordSupportedAttachmentContentType("image/jpeg"), true)
  assertEquals(isLandlordSupportedAttachmentContentType("image/png"), true)
  assertEquals(isLandlordSupportedAttachmentContentType("application/pdf"), true)

  const heic = findUnsupportedLandlordAttachment({
    mediaUrls: ["sms/x/y/photo.heic"],
    mediaContentTypes: ["image/heic"],
  })
  assertEquals(heic?.contentType, "image/heic")
  assertMatch(heic!.label, /HEIC/i)
  const sms = buildLandlordUnsupportedAttachmentReplySms({ label: heic!.label })
  assertMatch(sms, /HEIC/i)
  assertMatch(sms, /JPEG or PNG/i)
  assertMatch(sms, /PDF/i)
})

Deno.test("describe attachment type names type without guessing content", () => {
  assertMatch(describeLandlordAttachmentType("video/mp4"), /video/i)
  assertMatch(
    describeLandlordAttachmentType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    /Word/i,
  )
})

Deno.test("supported attachment that isn't HQS → unrecognized reply for landlords only", () => {
  assertEquals(
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: "landlord",
      mediaUrls: ["sms/x/y/letter.pdf"],
      mediaContentTypes: ["application/pdf"],
      awaitingHqsPending: false,
    }),
    true,
  )
  assertEquals(
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: "resident",
      mediaUrls: ["sms/x/y/letter.pdf"],
      mediaContentTypes: ["application/pdf"],
      awaitingHqsPending: false,
    }),
    false,
  )
  assertEquals(
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: "vendor",
      mediaUrls: ["sms/x/y/letter.pdf"],
      mediaContentTypes: ["application/pdf"],
      awaitingHqsPending: false,
    }),
    false,
  )
  assertEquals(
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: "landlord",
      mediaUrls: ["sms/x/y/photo.heic"],
      mediaContentTypes: ["image/heic"],
      awaitingHqsPending: false,
    }),
    false,
  )
  const sms = buildLandlordUnrecognizedAttachmentReplySms()
  assertMatch(sms, /couldn't tell what this document is/i)
  assertMatch(sms, /HQS|inspection fail/i)
  assertMatch(sms, /HELP/i)
  assertEquals(sms.toLowerCase().includes("maintenance issue today"), false)
})

Deno.test("link and attachment guards do not fire for tenant/vendor identity in classify helpers", () => {
  // classifyLandlordLinkOnlyMessage is body-only; identity gate is in tryLandlordCantProcessInbound.
  // shouldReplyLandlordUnrecognizedAttachment is the identity-aware pure gate.
  assertEquals(
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: "resident",
      mediaUrls: ["a.jpg"],
      mediaContentTypes: ["image/jpeg"],
      awaitingHqsPending: false,
    }),
    false,
  )
})
