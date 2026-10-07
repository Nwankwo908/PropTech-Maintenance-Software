/**
 * One-shot spotlight tour on Overview after Try Demo welcome Ok:
 * 1) Needs Your Attention → 2) Portfolio Snapshot → 3) Search / Ask Ulo →
 * 4) Ask Ulo docked → 5) Ask Ulo full panel → 6) Messages (title + KPI + first 5 threads) →
 * 7) Active Tasks (first kanban row) → 8) Overview My Properties section →
 * 9) Residents (first five table rows) →
 * 10) Vendors (first five table rows) →
 * 11) Dashboard Ulo Activity Feed (bell + open panel).
 */

/**
 * While > 0, Ask Ulo open/dock/close must skip View Transitions so the tip
 * morph is the only motion (steps 3→4, 4→5, 5→6).
 */
let tipAnimateSuppressDepth = 0

/** Run `fn` with Ask Ulo smart-animate suppressed (instant panel updates). */
export function withTryDemoTipAnimateSuppress<T>(fn: () => T): T {
  tipAnimateSuppressDepth += 1
  try {
    return fn()
  } finally {
    tipAnimateSuppressDepth = Math.max(0, tipAnimateSuppressDepth - 1)
  }
}

export function isTryDemoTipAnimateSuppressed(): boolean {
  return tipAnimateSuppressDepth > 0
}

const PENDING_KEY = 'ulo.tryDemoAttentionGuide.pending'
const SEEN_KEY = 'ulo.tryDemoAttentionGuide.seen'
/** In-progress tip step — survives Ask Ulo open remounts within the same session. */
const ACTIVE_STEP_KEY = 'ulo.tryDemoAttentionGuide.activeStep'

export const TRY_DEMO_ATTENTION_GUIDE_EVENT = 'ulo:try-demo-attention-guide'
/** Fired whenever the in-progress tip step is written (Ask Ulo layout sync). */
export const TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT = 'ulo:try-demo-attention-guide-step'

/** DOM id for Overview Needs Your Attention (step 1 cutout). */
export const TRY_DEMO_SPOTLIGHT_ATTENTION_ID = 'try-demo-spotlight-attention'
/** DOM id for Overview Portfolio Snapshot (step 2 cutout). */
export const TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID = 'try-demo-spotlight-portfolio'
/** DOM id for the top-bar Search + Ask Ulo cluster (step 3 cutout). */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_ID = 'try-demo-spotlight-ask-ulo'
/** DOM id for the Ask Ulo panel shell (docked rail — step 4). */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID = 'try-demo-spotlight-ask-ulo-panel'
/**
 * DOM id for Ask Ulo copy + UI (composer / suggestions / thread) — step 5 cutout.
 * Inner content column only (not the left chat rail, not expand/dock/close chrome).
 */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID = 'try-demo-spotlight-ask-ulo-content'
/** @deprecated Left-rail chats stay under the scrim on step 5 — not a tip cutout. */
export const TRY_DEMO_SPOTLIGHT_ASK_ULO_CHATS_ID = 'try-demo-spotlight-ask-ulo-chats'
/**
 * DOM id for the full Messages tip cutout (step 6): title + KPIs + list chrome +
 * first five threads. One host so the tip cannot settle on KPIs alone.
 */
export const TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID = 'try-demo-spotlight-messages-kpi'
/** @deprecated Step 6 uses TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID for the whole block. */
export const TRY_DEMO_SPOTLIGHT_MESSAGES_THREADS_ID = 'try-demo-spotlight-messages-threads'
/** DOM id prefix for Active Tasks kanban first-row slots (step 7 cutout). */
export const TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_PREFIX =
  'try-demo-spotlight-active-tasks-first-row'
/** Primary cutout: first card slot in the leftmost kanban column. */
export const TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_ID = `${TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_PREFIX}-0`
/** Four stage columns on Active Tasks — first card of each forms the tip row. */
export const TRY_DEMO_ACTIVE_TASKS_KANBAN_COLUMN_COUNT = 4
/** DOM id for Overview My Properties section (step 8 cutout). */
export const TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID = 'try-demo-spotlight-properties-section'
/**
 * DOM id for Residents tip cutout (step 9): one host wrapping the first five
 * table rows (same pattern as Messages — not per-row union targets).
 */
export const TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID = 'try-demo-spotlight-residents-rows'
/** How many resident table rows the tip uncovers. */
export const TRY_DEMO_RESIDENTS_SPOTLIGHT_ROW_COUNT = 5
/**
 * DOM id for Vendors tip cutout (step 10): one host wrapping the first five
 * table rows (same pattern as Residents / Messages).
 */
export const TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID = 'try-demo-spotlight-vendors-rows'
/** How many vendor table rows the tip uncovers. */
export const TRY_DEMO_VENDORS_SPOTLIGHT_ROW_COUNT = 5
/**
 * DOM id for Ulo Activity tip cutout (step 11): bell + open feed panel on Dashboard.
 */
export const TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID = 'try-demo-spotlight-ulo-activity'

export const TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION = 1
export const TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO = 2
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO = 3
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED = 4
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS = 5
export const TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES = 6
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS = 7
export const TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES = 8
export const TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS = 9
export const TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS = 10
export const TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY = 11
/** @deprecated Use TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION */
export const TRY_DEMO_ATTENTION_GUIDE_STEP = TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION
export const TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL = 11

export type TryDemoAttentionGuideStep =
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS
  | typeof TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY

const ASK_ULO_DOCKED_BODY = 'Move to side to keep working.'

const ASK_ULO_FULL_BODY = 'Use Ask Ulo in a full view.'

const MESSAGES_BODY =
  'View tenant and vendor texts, with the latest conversations first. Filter by tenant or vendor, then select a conversation to read messages, reply, or take over from Ulo.'

const ACTIVE_TASKS_BODY =
  'Track repairs, move-ins, move-outs, inspections, and lease tasks from New Intake to Completed. Select a card to view details or take action. The board updates as work progresses.'

const PROPERTIES_BODY =
  'See all your buildings in one place, with a quick view of occupancy, property condition, and maintenance spending. Select a building to explore its details.'

const RESIDENTS_BODY =
  'Manage residents, their units, lease details, and rent in one place. Start or retry their welcome text from Residents.'

const VENDORS_BODY =
  'Manage your vendors and track their setup progress. After adding a vendor, select Setup Vendor to send their verification link.'

const ULO_ACTIVITY_BODY =
  'Select the bell icon to see Ulo’s latest updates—from new repairs and vendor replies to setup progress and failed texts.'

export function isTryDemoAskUloLayoutStep(step: number): boolean {
  return (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  )
}

/**
 * Tip steps where Ask Ulo setDocked/open may run. Steps 6+ must never reopen
 * Ask Ulo via setDocked — that navigates to resolveAdminPath() and yanks the
 * tour off Messages back to Dashboard.
 */
export function isTryDemoAskUloShellSyncStep(step: number | null | undefined): boolean {
  return (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
  )
}

export function isTryDemoMessagesGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES
}

/** Tip card placement: left of cutout with a right pointer, or auto above/below/inside. */
export function tryDemoAttentionGuideTooltipSide(
  step: TryDemoAttentionGuideStep,
): 'left' | 'auto' {
  if (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
  ) {
    return 'left'
  }
  return 'auto'
}

export function isTryDemoActiveTasksGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS
}

export function isTryDemoPropertiesGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES
}

export function isTryDemoResidentsGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS
}

export function isTryDemoVendorsGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS
}

export function isTryDemoUloActivityGuideStep(step: number): boolean {
  return step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
}

/** Steps that change admin routes — tip should hold cutout, then morph after navigate. */
export function isTryDemoRouteMorphStep(step: number): boolean {
  return (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
  )
}

/** DOM id for the first-card slot in an Active Tasks kanban column (0-based). */
export function tryDemoActiveTasksFirstRowColumnId(columnIndex: number): string {
  return `${TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_PREFIX}-${columnIndex}`
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
  if (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
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
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) {
    return 'Your Conversations in One Place'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
    return 'Track Every Task’s Progress'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES) {
    return 'Your Buildings at a Glance'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) {
    return 'Manage Your Residents'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS) {
    return 'Manage Your Vendor Network'
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY) {
    return 'See Ulo’s Latest Updates'
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
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED) {
    return ASK_ULO_DOCKED_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS) {
    return ASK_ULO_FULL_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) {
    return MESSAGES_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
    return ACTIVE_TASKS_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES) {
    return PROPERTIES_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) {
    return RESIDENTS_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS) {
    return VENDORS_BODY
  }
  if (stepOrItemCount === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY) {
    return ULO_ACTIVITY_BODY
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
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION) {
    return TRY_DEMO_SPOTLIGHT_ATTENTION_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO) {
    return TRY_DEMO_SPOTLIGHT_PORTFOLIO_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS) {
    return TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) {
    return TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
    return TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES) {
    return TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) {
    return TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS) {
    return TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY) {
    return TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID
  }
  return null
}

/** Route the tip step expects (null = stay on current page / Overview). */
export function tryDemoAttentionGuideRouteForStep(
  step: TryDemoAttentionGuideStep,
): string | null {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) return '/admin/communication'
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) return '/admin/workflows'
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) return '/admin/residents'
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS) return '/admin/vendors'
  if (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
  ) {
    return '/admin'
  }
  return null
}

/**
 * Whether the current location satisfies a tip step route.
 * `/admin` is exact-only — it must not match `/admin/residents` etc. (that bug
 * stranded steps 8/9/11 on the wrong page while tip copy advanced).
 */
export function tipRouteMatchesLocation(
  pathname: string,
  expectedRoute: string | null | undefined,
): boolean {
  if (!expectedRoute) return true
  const here = pathname.replace(/\/$/, '') || '/'
  const want = expectedRoute.replace(/\/$/, '') || '/'
  if (here === want) return true
  // Bare Overview is exact; nested tip routes may match detail subpaths.
  if (want === '/admin') return false
  return here.startsWith(`${want}/`)
}

/** tbody / cluster tip hosts often report 0×0 — measure child rows instead. */
export function tipHostClusterHeight(el: HTMLElement): number {
  if (typeof el.dataset !== 'undefined' && el.dataset.tryDemoSpotlightCluster === '1') {
    const rects = Array.from(el.children)
      .map((child) => (child as HTMLElement).getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0)
    if (rects.length > 0) {
      return Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))
    }
  }
  return el.getBoundingClientRect().height
}

/**
 * True when the tip cutout host for `hostId` is mounted, loaded, and measurable.
 * Used by the Host settle pipeline — do not morph/reveal copy until this passes.
 */
export function isTryDemoTipHostReady(hostId: string | null | undefined): boolean {
  if (!hostId) return true
  if (typeof document === 'undefined') return false
  const el = document.getElementById(hostId)
  if (!el) return false

  if (hostId.startsWith(TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_PREFIX)) {
    const board = document.querySelector('[data-try-demo-active-tasks-ready]')
    if (board?.getAttribute('data-try-demo-active-tasks-ready') !== '1') return false
    for (let i = 0; i < TRY_DEMO_ACTIVE_TASKS_KANBAN_COLUMN_COUNT; i += 1) {
      const slot = document.getElementById(tryDemoActiveTasksFirstRowColumnId(i))
      if (!slot) return false
      const r = slot.getBoundingClientRect()
      if (r.width <= 0 && r.height <= 0) return false
    }
    return true
  }

  if (hostId === TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID) {
    // Settle as soon as the Messages host is mounted and measurable.
    // Thread/KPI load can finish after the cutout morphs (Tooltip remorphs).
    // Requiring data-try-demo-messages-ready stalled step 6 on slow inbox fetches.
    return el.getBoundingClientRect().height >= 100
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID) {
    return (
      tipHostClusterHeight(el) >= 80 &&
      el.getAttribute('data-try-demo-residents-ready') === '1'
    )
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID) {
    return (
      tipHostClusterHeight(el) >= 80 && el.getAttribute('data-try-demo-vendors-ready') === '1'
    )
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID) {
    return (
      el.getAttribute('data-try-demo-properties-ready') === '1' &&
      el.getBoundingClientRect().height >= 120
    )
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID) {
    return el.getAttribute('data-try-demo-ulo-activity-ready') === '1'
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID) {
    const shell = document.getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID)
    return (
      el.getAttribute('data-try-demo-ask-ulo-content-ready') === '1' &&
      shell?.classList.contains('ask-ulo-shell--full') === true &&
      (shell?.getBoundingClientRect().width ?? 0) >= 480
    )
  }
  if (hostId === TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID) {
    const r = el.getBoundingClientRect()
    return r.width >= 200 && r.height >= 120
  }

  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Destination contract for every tip advance: correct route + ready host.
 * Tip copy and cutout morph must wait for this.
 */
export function isTryDemoTipDestinationReady(
  step: TryDemoAttentionGuideStep,
  pathname?: string,
): boolean {
  const path =
    pathname ??
    (typeof window !== 'undefined' ? window.location.pathname : '')
  const route = tryDemoAttentionGuideRouteForStep(step)
  if (!tipRouteMatchesLocation(path, route)) return false
  return isTryDemoTipHostReady(tryDemoAttentionGuideTargetId(step))
}

/** Scroll the tip host into a measurable viewport position after settle. */
export function scrollTryDemoTipHostIntoView(hostId: string | null | undefined): void {
  if (typeof document === 'undefined' || !hostId) return
  const scrollRoot = document.querySelector(
    '[data-admin-scroll-root]',
  ) as HTMLElement | null
  const el = document.getElementById(hostId)

  if (
    hostId === TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID ||
    hostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
  ) {
    if (!el) return
    const anchor =
      (Array.from(el.children).find((child) => {
        const r = (child as HTMLElement).getBoundingClientRect()
        return r.width > 0 || r.height > 0
      }) as HTMLElement | undefined) ?? el
    anchor.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' })
    return
  }

  if (
    hostId === TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID ||
    hostId === TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID ||
    hostId.startsWith(TRY_DEMO_SPOTLIGHT_ACTIVE_TASKS_FIRST_ROW_PREFIX)
  ) {
    scrollRoot?.scrollTo({ top: 0, behavior: 'auto' })
    return
  }

  // Sticky top-bar / activity bell — never scroll-chase.
  if (
    hostId === TRY_DEMO_SPOTLIGHT_ASK_ULO_ID ||
    hostId === TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID ||
    hostId === TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID ||
    hostId === TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID
  ) {
    return
  }

  el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
}

export type TryDemoAttentionAdvancePlan =
  | {
      kind: 'step'
      step: TryDemoAttentionGuideStep
      askUlo?: 'docked' | 'full' | 'close-to'
      navigateTo?: string
    }
  | { kind: 'done' }

/** Pure Next-button plan for the persistent tip host. */
export function planTryDemoAttentionGuideAdvance(
  step: TryDemoAttentionGuideStep,
): TryDemoAttentionAdvancePlan {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ATTENTION) {
    return { kind: 'step', step: TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PORTFOLIO) {
    return { kind: 'step', step: TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO) {
    return { kind: 'step', step: TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED, askUlo: 'docked' }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED) {
    return { kind: 'step', step: TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS, askUlo: 'full' }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
      askUlo: 'close-to',
      navigateTo: '/admin/communication',
    }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS,
      navigateTo: '/admin/workflows',
    }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES,
      navigateTo: '/admin',
    }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS,
      navigateTo: '/admin/residents',
    }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS,
      navigateTo: '/admin/vendors',
    }
  }
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS) {
    return {
      kind: 'step',
      step: TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY,
      navigateTo: '/admin',
    }
  }
  return { kind: 'done' }
}

/**
 * Extra cutouts unioned (or kept separate when `separateHoles` is on).
 * Step 6 / 9 / 10: single host (Messages / Residents / Vendors first-five rows) — no extras.
 * Step 7: remaining kanban first-row cards (unioned into one first-row strip).
 */
export function tryDemoAttentionGuideExtraTargetIds(
  step: TryDemoAttentionGuideStep,
): string[] {
  if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
    return Array.from({ length: TRY_DEMO_ACTIVE_TASKS_KANBAN_COLUMN_COUNT - 1 }, (_, i) =>
      tryDemoActiveTasksFirstRowColumnId(i + 1),
    )
  }
  return []
}

/** Step 5–11: do not shrink near-fullscreen / multi-region cutouts. */
export function tryDemoAttentionGuideSkipHoleClamp(step: number): boolean {
  return (
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_VENDORS ||
    step === TRY_DEMO_ATTENTION_GUIDE_STEP_ULO_ACTIVITY
  )
}

/**
 * Separate holes are unused: step 6 is one Messages host; step 7 unions the
 * four first-row kanban cards into one continuous cutout.
 */
export function tryDemoAttentionGuideSeparateHoles(_step: number): boolean {
  return false
}
