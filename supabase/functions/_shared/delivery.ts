/**
 * Shared Resend email delivery. Outbound SMS uses `_shared/sms/providerFactory.ts`.
 */

export async function sendResendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
  options?: { signal?: AbortSignal; idempotencyKey?: string; requireMessageId?: boolean },
): Promise<{ id: string } | { error: string }> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim()
  /** Must be an address on a domain verified in Resend (https://resend.com/domains). */
  const from =
    Deno.env.get("RESEND_FROM_EMAIL")?.trim() || "noreply@send.assetwise.site"
  if (!key) {
    return { error: "Resend not configured" }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: options?.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    console.error("[delivery] Resend error", res.status, raw)
    return { error: raw.slice(0, 500) || `Resend HTTP ${res.status}` }
  }
  try {
    const j = JSON.parse(raw) as { id?: string }
    if (options?.requireMessageId && (typeof j.id !== "string" || !j.id.trim())) return { error: "Email provider acceptance could not be confirmed" }
    return { id: j.id ?? "sent" }
  } catch {
    if (options?.requireMessageId) return { error: "Email provider acceptance could not be confirmed" }
    return { id: "sent" }
  }
}
