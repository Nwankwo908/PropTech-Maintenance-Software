/**
 * Landlord/account-holder "can't process this" replies — link-only messages,
 * unsupported attachments, and supported files that aren't a recognized HQS letter.
 *
 * Same identity gate as HQS letter intake (`identity_type === "landlord"`).
 * Distinct from tenant_distress — wrong file type is not a distress signal.
 */
import type {
  InboundSmsHandlerContext,
  InboundSmsHandlerResult,
} from "./inboundHandlerTypes.ts"
import { mediaKindFromRef } from "./media.ts"

export type LandlordLinkOnlyKind = "hqs_letter_link" | "generic_link" | null

/** URL in body with no MMS attachments. */
const URL_IN_BODY =
  /\bhttps?:\/\/[^\s<>"']+/i

/** HABC / HQS letter link or surrounding inspection-letter intent. */
const HQS_LETTER_LINK_SIGNALS =
  /\b(viewletter|habc\.org|hcvinspect|housing\s+authority|section\s*8|hqs|inspection\s+letter|fail\s+letter)\b/i

/** Content types landlords can send for HQS letter intake. */
const LANDLORD_SUPPORTED_IMAGE =
  /^(image\/jpeg|image\/jpg|image\/pjpeg|image\/png|image\/gif|image\/webp)(;|$)/i

export function extractUrlsFromBody(body: string): string[] {
  const out: string[] = []
  const re = new RegExp(URL_IN_BODY.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const u = m[0]?.replace(/[),.]+$/g, "").trim()
    if (u) out.push(u)
  }
  return out
}

/**
 * Link-only = at least one URL in the body and zero MediaUrl attachments.
 * Never classify or act on bare-link content — reply guidance only.
 */
export function classifyLandlordLinkOnlyMessage(input: {
  body: string
  mediaCount: number
}): LandlordLinkOnlyKind {
  if (input.mediaCount > 0) return null
  const body = input.body.trim()
  if (!body) return null
  const urls = extractUrlsFromBody(body)
  if (urls.length === 0) return null

  const hay = `${body}\n${urls.join("\n")}`
  if (HQS_LETTER_LINK_SIGNALS.test(hay)) return "hqs_letter_link"
  return "generic_link"
}

/** True for JPEG/PNG/GIF/WebP/PDF — not HEIC, video, or office docs. */
export function isLandlordSupportedAttachmentContentType(
  contentType: string | null | undefined,
): boolean {
  const ct = (contentType ?? "").trim().toLowerCase()
  if (!ct) return false
  if (ct === "application/pdf" || ct.startsWith("application/pdf")) return true
  if (LANDLORD_SUPPORTED_IMAGE.test(ct)) return true
  return false
}

/**
 * Infer content type from Twilio MediaContentTypeN, then from the media ref
 * (storage path / URL). Used after rehost when payload types may be missing.
 */
export function resolveLandlordAttachmentContentType(input: {
  contentType?: string | null
  mediaRef?: string | null
}): string | null {
  const fromCt = (input.contentType ?? "").trim()
  if (fromCt) return fromCt.split(";")[0]?.trim() || fromCt

  const ref = (input.mediaRef ?? "").trim()
  if (!ref) return null
  const kind = mediaKindFromRef(ref)
  if (kind === "document") return "application/pdf"
  if (kind === "video") {
    const m = ref.match(/\.(mp4|mov|webm|3gp|m4v)(?:$|[?#])/i)
    return m ? `video/${m[1]!.toLowerCase() === "mov" ? "quicktime" : m[1]!.toLowerCase()}` : "video/mp4"
  }
  if (/\.heic(?:$|[?#])/i.test(ref)) return "image/heic"
  if (/\.heif(?:$|[?#])/i.test(ref)) return "image/heif"
  if (kind === "image") {
    const m = ref.match(/\.(jpe?g|png|gif|webp)(?:$|[?#])/i)
    if (!m) return "image/jpeg"
    const ext = m[1]!.toLowerCase()
    return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`
  }
  return null
}

/** Plain-language label for what arrived (type only — never guess content). */
export function describeLandlordAttachmentType(contentType: string): string {
  const ct = contentType.trim().toLowerCase().split(";")[0] ?? contentType
  if (ct.startsWith("image/heic") || ct.startsWith("image/heif")) {
    return "an HEIC photo"
  }
  if (ct.startsWith("video/")) return "a video"
  if (ct.includes("msword") || ct.includes("wordprocessingml") || ct.endsWith("/docx")) {
    return "a Word document"
  }
  if (ct.includes("spreadsheet") || ct.includes("excel") || ct.endsWith("/xlsx")) {
    return "a spreadsheet"
  }
  if (ct === "application/pdf" || ct.startsWith("application/pdf")) {
    return "a PDF"
  }
  if (ct.startsWith("image/")) return `an image (${ct.replace(/^image\//, "")})`
  if (ct.startsWith("application/")) {
    return `a ${ct.replace(/^application\//, "")} file`
  }
  return `a ${ct || "unknown"} file`
}

export function mediaContentTypesFromRawPayload(
  rawPayload: Record<string, unknown> | null | undefined,
  mediaCount: number,
): string[] {
  if (!rawPayload || mediaCount <= 0) return []
  const out: string[] = []
  for (let i = 0; i < mediaCount; i++) {
    const raw = rawPayload[`MediaContentType${i}`] ??
      rawPayload[`mediaContentType${i}`]
    out.push(typeof raw === "string" ? raw.trim() : "")
  }
  return out
}

export function findUnsupportedLandlordAttachment(input: {
  mediaUrls: string[]
  mediaContentTypes: string[]
}): { contentType: string; label: string } | null {
  const n = input.mediaUrls.length
  if (n === 0) return null
  for (let i = 0; i < n; i++) {
    const ct = resolveLandlordAttachmentContentType({
      contentType: input.mediaContentTypes[i] ?? null,
      mediaRef: input.mediaUrls[i] ?? null,
    })
    if (!ct) {
      // Unknown type after rehost — treat as unsupported rather than silent.
      return {
        contentType: "application/octet-stream",
        label: describeLandlordAttachmentType("application/octet-stream"),
      }
    }
    if (!isLandlordSupportedAttachmentContentType(ct)) {
      return { contentType: ct, label: describeLandlordAttachmentType(ct) }
    }
  }
  return null
}

export function buildLandlordHqsLetterLinkReplySms(): string {
  return [
    "Ulo can't open web links yet.",
    "",
    "To create work orders from an inspection letter, text a photo or PDF of the letter itself — not a link.",
    "",
    "If your housing authority asked you to email the letter, you can still send it to S8landlord@habc.org.",
  ].join("\n")
}

export function buildLandlordGenericLinkReplySms(): string {
  return [
    "Ulo can't open links sent by text.",
    "",
    "Please attach the file directly as a photo or PDF.",
  ].join("\n")
}

export function buildLandlordUnsupportedAttachmentReplySms(input: {
  label: string
}): string {
  return [
    `Ulo received ${input.label}, which I can't process yet.`,
    "",
    "Please resend as a photo (JPEG or PNG) or a PDF.",
  ].join("\n")
}

export function buildLandlordUnrecognizedAttachmentReplySms(): string {
  return [
    "Ulo couldn't tell what this document is.",
    "",
    "Right now I can read housing-authority HQS / inspection fail letters when you text a photo or PDF of the letter.",
    "",
    "If this was something else, reply HELP and a member of our team will follow up here.",
  ].join("\n")
}

export function buildKendoPropertiesHqsIntakeOutreachSms(): string {
  return [
    "Hi KendoProperties,",
    "",
    "This is the property management team at Ulo.",
    "",
    "Quick update: you can now text an HQS / Section 8 inspection fail letter to this number and we'll create the work orders for you.",
    "",
    "Send a photo or PDF of the letter itself — links (like ViewLetter) won't open yet.",
    "",
    "If the letter asks you to email it, S8landlord@habc.org still works for the housing authority.",
  ].join("\n")
}

/**
 * After HQS classify misses: landlord sent a supported attachment we don't recognize.
 * Call only when HQS intake already returned handled:false for this message.
 */
export function shouldReplyLandlordUnrecognizedAttachment(input: {
  identityType: string
  mediaUrls: string[]
  mediaContentTypes: string[]
  awaitingHqsPending: boolean
}): boolean {
  if (input.identityType !== "landlord") return false
  if (input.awaitingHqsPending) return false
  if (input.mediaUrls.length === 0) return false
  if (findUnsupportedLandlordAttachment(input)) return false
  // All attachments resolve to a supported type (or are inferable as such).
  return input.mediaUrls.every((ref, i) => {
    const ct = resolveLandlordAttachmentContentType({
      contentType: input.mediaContentTypes[i] ?? null,
      mediaRef: ref,
    })
    return isLandlordSupportedAttachmentContentType(ct)
  })
}

function intakeAwaitingHqs(intakeState: unknown): boolean {
  if (!intakeState || typeof intakeState !== "object" || Array.isArray(intakeState)) {
    return false
  }
  const rec = intakeState as Record<string, unknown>
  return rec.awaiting_hqs_unit === true || rec.awaiting_hqs_confirm === true
}

/**
 * Link-only / unsupported-type / unrecognized-attachment replies for landlords.
 * Does not run HQS classification — call after tryStartHqsLetterIntakeFromInbound.
 */
export async function tryLandlordCantProcessInbound(
  ctx: InboundSmsHandlerContext,
): Promise<InboundSmsHandlerResult> {
  if (ctx.identity.identity_type !== "landlord") {
    return { handled: false }
  }

  const { data: conv } = await ctx.supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", ctx.conversationId)
    .maybeSingle()
  if (intakeAwaitingHqs(conv?.intake_state)) {
    return { handled: false }
  }

  const mediaUrls = Array.isArray(ctx.inbound.mediaUrls)
    ? ctx.inbound.mediaUrls.filter((u) => typeof u === "string" && u.trim())
    : []
  const mediaContentTypes = mediaContentTypesFromRawPayload(
    ctx.inbound.rawPayload,
    mediaUrls.length,
  )

  // 1. Link-only (no attachment) — never fetch or classify the URL.
  if (mediaUrls.length === 0) {
    const linkKind = classifyLandlordLinkOnlyMessage({
      body: ctx.inbound.body,
      mediaCount: 0,
    })
    if (linkKind === "hqs_letter_link") {
      return {
        handled: true,
        workflowRoute: "landlord_hqs_letter_link",
        reply: {
          body: buildLandlordHqsLetterLinkReplySms(),
          source: "landlord_cant_process",
          skipGenericFallback: true,
        },
      }
    }
    if (linkKind === "generic_link") {
      return {
        handled: true,
        workflowRoute: "landlord_generic_link",
        reply: {
          body: buildLandlordGenericLinkReplySms(),
          source: "landlord_cant_process",
          skipGenericFallback: true,
        },
      }
    }
    return { handled: false }
  }

  // 2. Unsupported file type — name what arrived; don't guess content.
  const unsupported = findUnsupportedLandlordAttachment({
    mediaUrls,
    mediaContentTypes,
  })
  if (unsupported) {
    return {
      handled: true,
      workflowRoute: "landlord_unsupported_attachment",
      reply: {
        body: buildLandlordUnsupportedAttachmentReplySms({
          label: unsupported.label,
        }),
        source: "landlord_cant_process",
        skipGenericFallback: true,
      },
      workflowMetadata: { content_type: unsupported.contentType },
    }
  }

  // 3. Supported type but not an HQS letter (caller already tried classify).
  if (
    shouldReplyLandlordUnrecognizedAttachment({
      identityType: ctx.identity.identity_type,
      mediaUrls,
      mediaContentTypes,
      awaitingHqsPending: false,
    })
  ) {
    return {
      handled: true,
      workflowRoute: "landlord_unrecognized_attachment",
      reply: {
        body: buildLandlordUnrecognizedAttachmentReplySms(),
        source: "landlord_cant_process",
        skipGenericFallback: true,
      },
    }
  }

  return { handled: false }
}
