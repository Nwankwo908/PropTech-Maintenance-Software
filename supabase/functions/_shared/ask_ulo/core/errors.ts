/**
 * Ask Ulo error helpers (non-throwing pipeline prefers structured refusals).
 */

export class AskUloError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 500,
  ) {
    super(message)
    this.name = "AskUloError"
  }
}

export function asAskUloError(err: unknown, fallback = "Ask Ulo failed"): AskUloError {
  if (err instanceof AskUloError) return err
  if (err instanceof Error) return new AskUloError(err.message, "internal_error")
  return new AskUloError(fallback, "internal_error")
}
