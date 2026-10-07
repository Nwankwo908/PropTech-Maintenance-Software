import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  clearAskUloPendingPrompt,
  isAskUloAutoSendInFlight,
  peekAskUloPendingPrompt,
  stashAskUloPendingPrompt,
  wasAskUloPromptAutoSent,
} from '@/lib/askUloPendingPrompt'
import {
  ASK_ULO_LAUNCH_EVENT,
  launchAskUloFromSearch,
  type AskUloLaunchDetail,
} from '@/lib/launchAskUloFromSearch'
import {
  archiveAskUloConversation,
  canPersistAskUloChats,
  listAskUloConversations,
  renameAskUloConversation,
  type AskUloConversation,
} from '@/lib/askUloConversations'
import {
  dismissTryDemoAttentionGuide,
  isTryDemoAskUloShellSyncStep,
  readTryDemoAttentionGuideActiveStep,
  tryDemoAttentionGuideRouteForStep,
} from '@/lib/tryDemoAttentionGuide'
import { runSmartAnimate } from '@/lib/smartAnimate'

export const ASK_ULO_PARAM = 'askUlo'
export const ASK_ULO_CHAT_PARAM = 'askUloChat'
export const ASK_ULO_DOCK_PARAM = 'askUloDock'
/** One-shot prompt from universal search — stripped after Ask Ulo starts sending. */
export const ASK_ULO_PROMPT_PARAM = 'askUloQ'

/** Ask Ulo query keys that should survive admin sidebar navigation. */
export const ASK_ULO_SEARCH_KEYS = [
  ASK_ULO_PARAM,
  ASK_ULO_CHAT_PARAM,
  ASK_ULO_DOCK_PARAM,
] as const

const ASK_ULO_EPHEMERAL_KEYS = [ASK_ULO_PROMPT_PARAM] as const

/** Live URL search — avoids stale React searchParams wiping askUloChat mid-send. */
function currentSearchParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

/** Last chat id pinned during send — clearPending must not drop it. */
let lastPinnedAskUloChatId: string | null = null

/**
 * Tip layout sync / delayed setDocked(false) was re-opening Ask Ulo after Close.
 * Ignore dock/open writes briefly after the landlord closes the panel.
 */
let askUloUserClosedAt = 0

function wasAskUloRecentlyClosedByUser(ms = 1600): boolean {
  return askUloUserClosedAt > 0 && Date.now() - askUloUserClosedAt < ms
}

/**
 * Copy Ask Ulo open/dock/chat params onto a destination path so the right rail
 * stays open across admin nav items.
 */
export function withAskUloSearch(
  pathname: string,
  currentSearch: string | URLSearchParams,
  opts?: { forceDock?: boolean },
): { pathname: string; search: string } {
  const from =
    typeof currentSearch === 'string'
      ? new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
      : new URLSearchParams(currentSearch)
  const next = new URLSearchParams()
  for (const key of ASK_ULO_SEARCH_KEYS) {
    const value = from.get(key)
    if (value) next.set(key, value)
  }
  if (opts?.forceDock && from.get(ASK_ULO_PARAM) === '1') {
    next.set(ASK_ULO_DOCK_PARAM, '1')
  }
  const qs = next.toString()
  return { pathname, search: qs ? `?${qs}` : '' }
}

type AskUloContextValue = {
  open: boolean
  /** When true, Ask Ulo sits in the right rail beside the dashboard. */
  docked: boolean
  /** Active conversation id from URL, or null for a brand-new empty chat. */
  conversationId: string | null
  /** Prompt queued by universal search — panel sends then clears. */
  pendingPrompt: string | null
  openAskUlo: (conversationId?: string | null) => void
  /** Open Ask Ulo and auto-send a natural-language question. */
  openAskUloWithPrompt: (prompt: string, opts?: { docked?: boolean }) => void
  clearPendingPrompt: () => void
  closeAskUlo: (opts?: {
    preserveTip?: boolean
    /** Skip the default same-path URL replace (caller will navigate). */
    skipNavigate?: boolean
    /** Replace navigation target after close (e.g. Try Demo → Messages). */
    navigateTo?: string
  }) => void
  setConversationId: (conversationId: string | null) => void
  setDocked: (docked: boolean) => void
  conversations: AskUloConversation[]
  conversationsLoading: boolean
  persistEnabled: boolean
  refreshConversations: () => Promise<AskUloConversation[]>
  newChat: () => void
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
}

const AskUloContext = createContext<AskUloContextValue | null>(null)

/**
 * Ask Ulo open/dock UI state is React-first (instant), mirrored to the URL
 * (`?askUlo=1`, `askUloDock=1`) so it survives nav. Optional `askUloChat=<uuid>`
 * selects a persisted thread.
 */
export function AskUloProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const urlOpen = searchParams.get(ASK_ULO_PARAM) === '1'
  const urlDocked = searchParams.get(ASK_ULO_DOCK_PARAM) === '1'
  const conversationId = searchParams.get(ASK_ULO_CHAT_PARAM)?.trim() || null

  const [open, setOpen] = useState(urlOpen)
  const [docked, setDockedState] = useState(urlOpen && urlDocked)
  /** Skip URL→React sync while an optimistic open/dock/close navigate is in flight. */
  const skipUrlSyncUntilRef = useRef(0)

  const [conversations, setConversations] = useState<AskUloConversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [persistEnabled, setPersistEnabled] = useState(false)
  const adminPathname = location.pathname.startsWith('/admin')
    ? location.pathname
    : '/admin'

  const resolveAdminPath = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      return window.location.pathname
    }
    return adminPathname.startsWith('/admin') ? adminPathname : '/admin'
  }, [adminPathname])

  const markOptimisticShellWrite = useCallback(() => {
    skipUrlSyncUntilRef.current = Date.now() + 600
  }, [])

  // Mirror URL → React (back/forward, sidebar nav with askUlo params).
  // Do not run during optimistic writes — that was snapping Open back to closed
  // before navigate finished updating searchParams.
  useEffect(() => {
    if (Date.now() < skipUrlSyncUntilRef.current) return
    const tipStep = readTryDemoAttentionGuideActiveStep()
    const tipRoute =
      tipStep != null ? tryDemoAttentionGuideRouteForStep(tipStep) : null
    // Tip steps 6+ own the route. Never reopen Ask Ulo from a stale ?askUlo=1
    // (same class of bug as setDocked yanking Messages → Dashboard).
    if (tipStep != null && !isTryDemoAskUloShellSyncStep(tipStep)) {
      setOpen(false)
      setDockedState(false)
      if (urlOpen) {
        const params = currentSearchParams()
        for (const key of ASK_ULO_SEARCH_KEYS) params.delete(key)
        for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
        const qs = params.toString()
        navigate(
          {
            pathname: tipRoute || resolveAdminPath(),
            search: qs ? `?${qs}` : '',
          },
          { replace: true },
        )
      }
      return
    }
    if (wasAskUloRecentlyClosedByUser()) {
      setOpen(false)
      setDockedState(false)
      // Only strip stale askUlo* — tip Host owns route changes (Messages, etc.).
      if (urlOpen) {
        const params = currentSearchParams()
        for (const key of ASK_ULO_SEARCH_KEYS) params.delete(key)
        for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
        const qs = params.toString()
        navigate(
          {
            pathname: tipRoute || resolveAdminPath(),
            search: qs ? `?${qs}` : '',
          },
          { replace: true },
        )
      }
      return
    }
    setOpen(urlOpen)
    setDockedState(urlOpen && urlDocked)
  }, [urlOpen, urlDocked, navigate, resolveAdminPath])
  const urlPrompt = searchParams.get(ASK_ULO_PROMPT_PARAM)?.trim() || null
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(() => {
    const initial = urlPrompt || peekAskUloPendingPrompt()
    if (initial && wasAskUloPromptAutoSent(initial)) return null
    return initial
  })
  const pendingPromptRef = useRef<string | null>(pendingPrompt)

  // URL is the durable source after assignAdminPath (survives Strict Mode remounts).
  // Skip if this prompt was already auto-sent — otherwise HMR/remount re-fires it.
  useEffect(() => {
    if (!urlPrompt) return
    if (wasAskUloPromptAutoSent(urlPrompt)) {
      pendingPromptRef.current = null
      setPendingPrompt(null)
      clearAskUloPendingPrompt()
      const params = currentSearchParams()
      if (!params.has(ASK_ULO_PROMPT_PARAM)) return
      params.delete(ASK_ULO_PROMPT_PARAM)
      const qs = params.toString()
      navigate(
        { pathname: adminPathname, search: qs ? `?${qs}` : '' },
        { replace: true },
      )
      return
    }
    stashAskUloPendingPrompt(urlPrompt)
    pendingPromptRef.current = urlPrompt
    setPendingPrompt(urlPrompt)
  }, [urlPrompt, adminPathname, navigate])

  useEffect(() => {
    pendingPromptRef.current = pendingPrompt
  }, [pendingPrompt])

  const openAskUlo = useCallback(
    (nextConversationId?: string | null) => {
      runSmartAnimate(() => {
        askUloUserClosedAt = 0
        markOptimisticShellWrite()
        // Tip scrim sits above the panel — clear it so Open is visible/usable.
        if (readTryDemoAttentionGuideActiveStep() != null) {
          dismissTryDemoAttentionGuide()
        }
        setOpen(true)
        setDockedState(false)
        const params = currentSearchParams()
        params.set(ASK_ULO_PARAM, '1')
        // Header open always shows the full panel (not the right rail).
        params.delete(ASK_ULO_DOCK_PARAM)
        if (nextConversationId) params.set(ASK_ULO_CHAT_PARAM, nextConversationId)
        else if (!params.get(ASK_ULO_CHAT_PARAM)) params.delete(ASK_ULO_CHAT_PARAM)
        for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
        navigate(
          { pathname: resolveAdminPath(), search: `?${params.toString()}` },
          { replace: true },
        )
      })
    },
    [markOptimisticShellWrite, navigate, resolveAdminPath],
  )

  const openAskUloWithPrompt = useCallback(
    (prompt: string, opts?: { docked?: boolean }) => {
      const q = prompt.trim()
      if (!q) return
      pendingPromptRef.current = q
      setPendingPrompt(q)
      launchAskUloFromSearch(q, { docked: opts?.docked !== false })
    },
    [],
  )

  // Universal search dispatches this so we can open + queue without a full reload
  // (full reloads were racing chat restore and wiping the new question).
  useEffect(() => {
    function onLaunch(event: Event) {
      const ce = event as CustomEvent<AskUloLaunchDetail>
      const q = ce.detail?.prompt?.trim()
      if (!q) return
      ce.preventDefault()
      pendingPromptRef.current = q
      setPendingPrompt(q)
      stashAskUloPendingPrompt(q)
      const params = new URLSearchParams(window.location.search)
      params.set(ASK_ULO_PARAM, '1')
      params.delete(ASK_ULO_CHAT_PARAM)
      params.set(ASK_ULO_PROMPT_PARAM, q)
      if (ce.detail?.docked === false) params.delete(ASK_ULO_DOCK_PARAM)
      else params.set(ASK_ULO_DOCK_PARAM, '1')
      const path = window.location.pathname.startsWith('/admin')
        ? window.location.pathname
        : '/admin'
      navigate({ pathname: path, search: `?${params.toString()}` })
    }
    window.addEventListener(ASK_ULO_LAUNCH_EVENT, onLaunch as EventListener)
    return () => {
      window.removeEventListener(ASK_ULO_LAUNCH_EVENT, onLaunch as EventListener)
    }
  }, [navigate])

  const clearPendingPrompt = useCallback(() => {
    pendingPromptRef.current = null
    setPendingPrompt(null)
    clearAskUloPendingPrompt()
    // Strip askUloQ and re-pin the active chat. Concurrent navigates were
    // dropping askUloChat and leaving a blank thread while the answer sat in Recents.
    const params = currentSearchParams()
    const pinnedChat = lastPinnedAskUloChatId
    const chatId = params.get(ASK_ULO_CHAT_PARAM) || pinnedChat
    const hadQ = params.has(ASK_ULO_PROMPT_PARAM)
    const chatMissing = Boolean(pinnedChat && params.get(ASK_ULO_CHAT_PARAM) !== pinnedChat)
    if (!hadQ && !chatMissing) return
    const dockedParam = params.get(ASK_ULO_DOCK_PARAM)
    const next = new URLSearchParams()
    next.set(ASK_ULO_PARAM, '1')
    if (dockedParam) next.set(ASK_ULO_DOCK_PARAM, dockedParam)
    if (chatId) next.set(ASK_ULO_CHAT_PARAM, chatId)
    const qs = next.toString()
    navigate(
      { pathname: adminPathname, search: qs ? `?${qs}` : '' },
      { replace: true },
    )
  }, [adminPathname, navigate])

  const closeAskUlo = useCallback(
    (opts?: { preserveTip?: boolean; skipNavigate?: boolean; navigateTo?: string }) => {
      runSmartAnimate(() => {
        askUloUserClosedAt = Date.now()
        markOptimisticShellWrite()
        clearAskUloPendingPrompt()
        pendingPromptRef.current = null
        setPendingPrompt(null)
        // Clear tip on Close so scrim/setDocked cannot reopen Ask Ulo — unless the
        // Try Demo tour is advancing to another page (Messages) and needs the step.
        if (!opts?.preserveTip && readTryDemoAttentionGuideActiveStep() != null) {
          dismissTryDemoAttentionGuide()
        }
        if (!opts?.skipNavigate) {
          const tipStep = readTryDemoAttentionGuideActiveStep()
          const tipRoute =
            tipStep != null ? tryDemoAttentionGuideRouteForStep(tipStep) : null
          const pathname =
            opts?.navigateTo?.trim() || tipRoute || resolveAdminPath()
          // Tip → Messages: always clear search so askUlo* cannot stick / reopen.
          // Other closes keep non-Ask-Ulo query params.
          if (opts?.navigateTo?.trim()) {
            navigate({ pathname, search: '' }, { replace: true })
          } else {
            const params = currentSearchParams()
            for (const key of ASK_ULO_SEARCH_KEYS) params.delete(key)
            for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
            const qs = params.toString()
            navigate({ pathname, search: qs ? `?${qs}` : '' }, { replace: true })
          }
        }
        // skipNavigate: tip host owns the route (goAdminPath clears askUlo*).
        setOpen(false)
        setDockedState(false)
      })
    },
    [markOptimisticShellWrite, navigate, resolveAdminPath],
  )

  const setConversationId = useCallback(
    (nextConversationId: string | null) => {
      lastPinnedAskUloChatId = nextConversationId
      const params = currentSearchParams()
      params.set(ASK_ULO_PARAM, '1')
      if (nextConversationId) {
        params.set(ASK_ULO_CHAT_PARAM, nextConversationId)
      } else {
        params.delete(ASK_ULO_CHAT_PARAM)
      }
      // Never keep one-shot search prompts across chat switches — they re-fire sends.
      for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
      navigate(
        { pathname: resolveAdminPath(), search: `?${params.toString()}` },
        { replace: true },
      )
    },
    [navigate, resolveAdminPath],
  )

  const setDocked = useCallback(
    (nextDocked: boolean) => {
      if (wasAskUloRecentlyClosedByUser()) return
      // Steps 6+ (Messages, Active Tasks, …): setDocked navigates to
      // resolveAdminPath() and was yanking the tip off Messages back to Dashboard.
      const tipStep = readTryDemoAttentionGuideActiveStep()
      if (tipStep != null && !isTryDemoAskUloShellSyncStep(tipStep)) return
      runSmartAnimate(() => {
        askUloUserClosedAt = 0
        markOptimisticShellWrite()
        setOpen(true)
        setDockedState(nextDocked)
        const params = currentSearchParams()
        params.set(ASK_ULO_PARAM, '1')
        if (nextDocked) params.set(ASK_ULO_DOCK_PARAM, '1')
        else params.delete(ASK_ULO_DOCK_PARAM)
        for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
        navigate(
          { pathname: resolveAdminPath(), search: `?${params.toString()}` },
          { replace: true },
        )
      })
    },
    [markOptimisticShellWrite, navigate, resolveAdminPath],
  )

  const refreshConversations = useCallback(async () => {
    const list = await listAskUloConversations({ landlordId: getActiveLandlordId() })
    setConversations(list)
    return list
  }, [])

  // Load history when Ask Ulo opens; restore latest thread if none selected.
  useEffect(() => {
    if (!open) return
    // Capture at open — auto-send clears stash/URL before the list fetch returns.
    // Restoring the latest chat in that window wipes the new question + answer.
    const locAtOpen = new URLSearchParams(window.location.search)
    const hadQueuedPromptAtOpen = Boolean(
      pendingPromptRef.current ||
        locAtOpen.get(ASK_ULO_PROMPT_PARAM)?.trim() ||
        peekAskUloPendingPrompt() ||
        isAskUloAutoSendInFlight(),
    )
    let cancelled = false
    void (async () => {
      setConversationsLoading(true)
      const canPersist = await canPersistAskUloChats()
      if (cancelled) return
      setPersistEnabled(canPersist)
      if (!canPersist) {
        setConversations([])
        setConversationsLoading(false)
        return
      }
      const list = await refreshConversations()
      if (cancelled) return
      setConversationsLoading(false)
      const locParams = new URLSearchParams(window.location.search)
      const chatParam = locParams.get(ASK_ULO_CHAT_PARAM)
      const stillQueued =
        hadQueuedPromptAtOpen ||
        Boolean(pendingPromptRef.current) ||
        Boolean(locParams.get(ASK_ULO_PROMPT_PARAM)?.trim()) ||
        Boolean(peekAskUloPendingPrompt()) ||
        isAskUloAutoSendInFlight()
      // Keep a blank thread when universal search queued a prompt to auto-send.
      if (!chatParam && list.length > 0 && !stillQueued) {
        const params = new URLSearchParams(window.location.search)
        params.set(ASK_ULO_PARAM, '1')
        params.set(ASK_ULO_CHAT_PARAM, list[0].id)
        for (const key of ASK_ULO_EPHEMERAL_KEYS) params.delete(key)
        const path = window.location.pathname.startsWith('/admin')
          ? window.location.pathname
          : '/admin'
        navigate({ pathname: path, search: `?${params.toString()}` }, { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally only when Ask Ulo opens — avoid re-fetch loops on URL chat changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const newChat = useCallback(() => {
    setConversationId(null)
  }, [setConversationId])

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      const ok = await renameAskUloConversation(id, title)
      if (ok) await refreshConversations()
    },
    [refreshConversations],
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      const ok = await archiveAskUloConversation(id)
      if (!ok) return
      const list = await refreshConversations()
      if (conversationId === id) {
        if (list[0]) setConversationId(list[0].id)
        else setConversationId(null)
      }
    },
    [conversationId, refreshConversations, setConversationId],
  )

  const value = useMemo(
    () => ({
      open,
      docked,
      conversationId,
      pendingPrompt,
      openAskUlo,
      openAskUloWithPrompt,
      clearPendingPrompt,
      closeAskUlo,
      setConversationId,
      setDocked,
      conversations,
      conversationsLoading,
      persistEnabled,
      refreshConversations,
      newChat,
      renameConversation,
      deleteConversation,
    }),
    [
      open,
      docked,
      conversationId,
      pendingPrompt,
      openAskUlo,
      openAskUloWithPrompt,
      clearPendingPrompt,
      closeAskUlo,
      setConversationId,
      setDocked,
      conversations,
      conversationsLoading,
      persistEnabled,
      refreshConversations,
      newChat,
      renameConversation,
      deleteConversation,
    ],
  )

  return <AskUloContext.Provider value={value}>{children}</AskUloContext.Provider>
}

export function useAskUlo(): AskUloContextValue {
  const ctx = useContext(AskUloContext)
  if (!ctx) {
    throw new Error('useAskUlo must be used within AskUloProvider')
  }
  return ctx
}
