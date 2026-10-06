const ASK_ULO_PENDING_PROMPT_KEY = 'ulo.askUloPendingPrompt'
const ASK_ULO_AUTO_SENT_KEY = 'ulo.askUloAutoSentPrompt'

/** In-memory fallback when sessionStorage is unavailable (tests / private mode). */
let memoryPrompt: string | null = null
let memoryAutoSent: string | null = null
/** Set while a search prompt is claimed and send is starting — blocks chat restore. */
let autoSendInFlight: string | null = null

/** Survive full document navigation (assignAdminPath) into Ask Ulo. */
export function stashAskUloPendingPrompt(prompt: string): void {
  const q = prompt.trim()
  if (!q) return
  memoryPrompt = q
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(ASK_ULO_PENDING_PROMPT_KEY, q)
  } catch {
    /* private mode — memory fallback remains */
  }
}

/** Read without clearing (Strict Mode remounts must not drop the prompt). */
export function peekAskUloPendingPrompt(): string | null {
  if (typeof window !== 'undefined') {
    try {
      const fromStorage = window.sessionStorage.getItem(ASK_ULO_PENDING_PROMPT_KEY)?.trim()
      if (fromStorage) return fromStorage
    } catch {
      /* ignore */
    }
  }
  return memoryPrompt?.trim() || null
}

/** Clear stashed prompt after Ask Ulo has started sending it. */
export function clearAskUloPendingPrompt(): void {
  memoryPrompt = null
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(ASK_ULO_PENDING_PROMPT_KEY)
  } catch {
    /* ignore */
  }
}

/** Prevent the same search prompt from auto-sending again after HMR / remount. */
export function markAskUloPromptAutoSent(prompt: string): void {
  const q = prompt.trim()
  if (!q) return
  memoryAutoSent = q
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(ASK_ULO_AUTO_SENT_KEY, q)
  } catch {
    /* ignore */
  }
}

export function wasAskUloPromptAutoSent(prompt: string): boolean {
  const q = prompt.trim()
  if (!q) return false
  if (memoryAutoSent === q) return true
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(ASK_ULO_AUTO_SENT_KEY)?.trim() === q
  } catch {
    return false
  }
}

/**
 * Atomically claim a search prompt for a single auto-send.
 * Returns the prompt once; later calls with the same prompt return null.
 * Marks in-flight so Ask Ulo must not restore an older chat over the new send.
 */
export function consumeAskUloPromptForAutoSend(prompt: string): string | null {
  const q = prompt.trim()
  if (!q) return null
  if (autoSendInFlight === q || wasAskUloPromptAutoSent(q)) {
    clearAskUloPendingPrompt()
    return null
  }
  markAskUloPromptAutoSent(q)
  clearAskUloPendingPrompt()
  autoSendInFlight = q
  return q
}

export function isAskUloAutoSendInFlight(): boolean {
  return Boolean(autoSendInFlight)
}

export function finishAskUloAutoSend(): void {
  autoSendInFlight = null
}

/** Call when the landlord intentionally launches a new search prompt. */
export function clearAskUloPromptAutoSent(): void {
  memoryAutoSent = null
  autoSendInFlight = null
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(ASK_ULO_AUTO_SENT_KEY)
  } catch {
    /* ignore */
  }
}

/** @deprecated Prefer peek + clear; kept for tests. */
export function takeAskUloPendingPrompt(): string | null {
  const q = peekAskUloPendingPrompt()
  clearAskUloPendingPrompt()
  return q
}
