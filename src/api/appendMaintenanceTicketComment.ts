const COMMENT_URL = import.meta.env.VITE_MAINTENANCE_TICKET_COMMENT_URL as
  | string
  | undefined

function messageFromResponseBody(text: string, status: number): string {
  if (!text) return `Request failed (${status}).`
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string }
    if (typeof parsed.message === 'string') return parsed.message
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    /* not JSON */
  }
  const trimmed = text.trim()
  return trimmed.length > 200 ? `Request failed (${status}).` : trimmed
}

export type AppendTicketCommentAuth = {
  accessToken: string
  residentUserId: string
}

export type AppendTicketCommentInput = {
  ticketId: string
  comment: string
  auth?: AppendTicketCommentAuth
}

/**
 * Appends a resident comment to the ticket thread when `VITE_MAINTENANCE_TICKET_COMMENT_URL` is set.
 * Otherwise simulates success for local development.
 */
export async function appendMaintenanceTicketComment(
  input: AppendTicketCommentInput,
): Promise<void> {
  const comment = input.comment.trim()
  if (!comment) throw new Error('Please enter a comment.')

  if (COMMENT_URL?.trim()) {
    const payload: Record<string, string> = {
      ticketId: input.ticketId.trim(),
      comment,
    }
    if (input.auth?.residentUserId) {
      payload.residentUserId = input.auth.residentUserId
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (input.auth?.accessToken) {
      headers.Authorization = `Bearer ${input.auth.accessToken}`
    }

    const res = await fetch(COMMENT_URL.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(messageFromResponseBody(text, res.status))
    }
    return
  }

  await new Promise((r) => setTimeout(r, 400))
}
