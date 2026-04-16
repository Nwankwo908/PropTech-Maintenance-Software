/**
 * Shared Resend + Twilio delivery (vendor and resident notifications).
 */

export async function sendResendEmail(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<{ id: string } | { error: string }> {
  const key = Deno.env.get("RESEND_API_KEY")?.trim()
  const from = "noreply@assetwise.site"
  if (!key) {
    return { error: "Missing RESEND_API_KEY" }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
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
    return { id: j.id ?? "sent" }
  } catch {
    return { id: "sent" }
  }
}

export async function sendTwilioSms(to: string, body: string): Promise<
  { sid: string } | { error: string }
> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim()
  const fromNum = Deno.env.get("TWILIO_FROM_NUMBER")?.trim()
  if (!sid || !token || !fromNum) {
    return {
      error:
        "Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER",
    }
  }

  const auth = btoa(`${sid}:${token}`)
  const form = new URLSearchParams({
    To: to,
    From: fromNum,
    Body: body,
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  )

  const raw = await res.text()
  if (!res.ok) {
    console.error("[delivery] Twilio error", res.status, raw)
    return { error: raw.slice(0, 500) || `Twilio HTTP ${res.status}` }
  }
  try {
    const j = JSON.parse(raw) as { sid?: string }
    return { sid: j.sid ?? "sent" }
  } catch {
    return { sid: "sent" }
  }
}
