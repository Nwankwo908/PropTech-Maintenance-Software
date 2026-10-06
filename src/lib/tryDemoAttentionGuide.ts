/**
 * One-shot spotlight tour on Overview after Try Demo welcome Ok:
 * 1) Needs Your Attention → 2) Portfolio Snapshot → 3) Search / Ask Ulo →
 * 4) Ask Ulo docked → 5) Ask Ulo full panel (left rail stays under scrim).
 */

const PENDING_KEY = 'ulo.tryDemoAttentionGuide.pending'
const SEEN_KEY = 'ulo.tryDemoAttentionGuide.seen'
/** In-progress tip step — survives Ask Ulo open remounts within the same session. */
const ACTIVE_STEP_KEY = 'ulo.tryDemoAttentionGuide.activeStep'

export const TRY_DEMO_ATTENTION_GUIDE_EVENT = 'ulo:try-demo-attention-guide'
/** Fired whenever the in-progress tip step is written (Ask Ulo layout sync). */
export const TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT = 'ulo:try-demo-attention-guide-step'

/** DOM id for the top-bar Search + Ask Ulo cluster (step 3 cutout). */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_ID = 'try-demo-spotlight-ask-ulo'
/** DOM id for the Ask Ulo panel shell (docked rail — step 4). */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID = 'try-demo-spotlight-ask-ulo-panel'
/**
 * DOM id for Ask Ulo copy + UI (composer / suggestions / thread) — step 5 cutout.
 * Not the full-bleed panel chrome, so the scrim still covers the rest of the app.
 */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID = 'try-demo-spotlight-ask-ulo-content'
/** @deprecated Left-rail chats stay under the scrim on step 5 — not a tip cutout. */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_CHATS_ID = 'try-demo-spotlight-ask-ulo-chats'

export const TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION = 1
export const TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO = 2
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO = 3
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED = 4
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS = 5
/** @deprecated Use TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION */
export const TRY_DEMO_ATTENTION_GUIDE_STEP = TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION
export const TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL = 5

export type TryDemoAttentionGuideStep =
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS

const ASK_ULO_LAYOUT_BODY =
  'Use Ask Ulo in a full view or move it to the side to keep working. Find past chats in the left sidebar and switch views anytime. When you visit another page, Ask Ulo moves to the side automatically.'

export function isTryDemoAskUloLayoutStep(step: number): boolean {
  return (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  )
}

function storageGet(key: string): string | null {
  try {
    const sessionValue = window.sessionStorage?.getItem(key)
    if (sessionValue) return sessionValue
  } catch {
    // private mode
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    window.sessionStorage?.setItem(key, value)
  } catch {
    // private mode
  }
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // private mode
  }
}

function storageRemove(key: string): void {
  try {
    window.sessionStorage?.removeItem(key)
  } catch {
    // private mode
  }
  try {
    window.localStorage.removeItem(key)
  } catch {
    // private mode
  }
}

export function isTryDemoAttentionGuideSeen(): boolean {
  return storageGet(SEEN_KEY) === '1'
}

export function isTryDemoAttentionGuidePending(): boolean {
  if (isTryDemoAttentionGuideSeen()) return false
  return storageGet(PENDING_KEY) === '1'
}

/** Arm after Welcome to Ulo Home is dismissed (Try Demo flow). */
export function markTryDemoAttentionGuidePending(): void {
  storageRemove(SEEN_KEY)
  storageSet(PENDING_KEY, '1')
  try {
    window.dispatchEvent(new Event(TRY_DEMO_ATTENTION_GUIDE_EVENT))
  } catch {
    // ignore
  }
}

/** Consume the pending arm once the Overview tip opens. */
export function consumeTryDemoAttentionGuidePending(): void {
  storageRemove(PENDING_KEY)
}

/** Mark the tour finished (or skip re-arm) and clear any in-progress step. */
export function dismissTryDemoAttentionGuide(): void {
  storageRemove(PENDING_KEY)
  storageRemove(ACTIVE_STEP_KEY)
  storageSet(SEEN_KEY, '1')
  try {
    window.dispatchEvent(
      new CustomEvent(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, { detail: { step: null } }),
    )
  } catch {
    // ignore
  }
}

/**
 * Prevent a second arm after Welcome Ok without ending an in-progress tip.
 * Use when the tip is opening; `dismissTryDemoAttentionGuide` is for finish/skip.
 */
export function markTryDemoAttentionGuideSeen(): void {
  storageRemove(PENDING_KEY)
  storageSet(SEEN_KEY, '1')
}

export function clearTryDemoAttentionGuide(): void {
  storageRemove(PENDING_KEY)
  storageRemove(ACTIVE_STEP_KEY)
  storageRemove(SEEN_KEY)
}

export function readTryDemoAttentionGuideActiveStep(): TryDemoAttentionGuideStep | null {
  const raw = storageGet(ACTIVE_STEP_KEY)
  if (!raw) return null
  const step = Number(raw)
  // Legacy 6-step tour stored "6" for the final full Ask Ulo tip.
  if (step === 6) return TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  if (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  ) {
    return step
  }
  return null
}

export function writeTryDemoAttentionGuideActiveStep(
  step: TryDemoAttentionGuideStep | null,
): void {
  if (step == null) {
    storageRemove(ACTIVE_STEP_KEY)
  } else {
    storageSet(ACTIVE_STEP_KEY, String(step))
  }
  try {
    window.dispatchEvent(
      new CustomEvent(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, { detail: { step } }),
    )
  } catch {
    // ignore
  }
}

/** Ask Ulo shell mode for tip steps 4–5 (null = leave Ask Ulo alone). */
export function tryDemoAskUloViewModeForStep(
  step: number | null | undefined,
): 'full' | 'docked' | null {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED) return 'docked'
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS) return 'full'
  return null
}

export function tryDemoAttentionGuideTitle(
  step: TryDemoAttentionGuideStep = TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
): string {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO) {
    return 'Your Properties at a Glance'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO) {
    return 'Find What You Need'
  }
  if (isTryDemoAskUloLayoutStep(step)) {
    return 'Ask Ulo, Your Way'
  }
  return 'See what needs your attention'
}

export function tryDemoAttentionGuideBody(
  stepOrItemCount?: TryDemoAttentionGuideStep | number,
): string {
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO) {
    return 'Get a quick view of your open repairs, upcoming visits, overall property condition, and maintenance costs so far this year.'
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO) {
    return 'Quickly find properties, residents, vendors, repairs, or pages. Select a result to open it, or ask a question to get help from Ask Ulo. Open search with ⌘K on Mac or Ctrl+K on Windows.'
  }
  if (typeof stepOrItemCount === 'number' && isTryDemoAskUloLayoutStep(stepOrItemCount)) {
    return ASK_ULO_LAYOUT_BODY
  }
  return 'from overdue repairs and late rent to missing lease details, failed texts, and invoices to review.'
}

export function tryDemoAttentionGuidePageLabel(
  step: number = TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION,
  stepTotal: number = TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
): string {
  return `${step} of ${stepTotal}`
}

/** Spotlight DOM id for the active tip step (null = use targetRef). */
export function tryDemoAttentionGuideTargetId(
  step: TryDemoAttentionGuideStep,
): string | null {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID
  }
  // Step 5: Ask Ulo copy + UI controls (not the full white panel plane).
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID
  }
  return null
}

/**
 * No extra cutouts — step 5 clears only Ask Ulo copy/UI in the main panel.
 * Left rail stays under the scrim.
 */
export function tryDemoAttentionGuideExtraTargetIds(
  _step: TryDemoAttentionGuideStep,
): string[] {
  return []
}

/** Step 5: do not shrink the Ask Ulo content cutout. */
export function tryDemoAttentionGuideSkipHoleClamp(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
}
