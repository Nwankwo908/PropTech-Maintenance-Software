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
  archiveAskUloConversation,
  canPersistAskUloChats,
  listAskUloConversations,
  renameAskUloConversation,
  type AskUloConversation,
} from '@/lib/askUloConversations'

export const ASK_ULO_PARAM = 'askUlo'
export const ASK_ULO_CHAT_PARAM = 'askUloChat'
export const ASK_ULO_DOCK_PARAM = 'askUloDock'

/** Ask Ulo query keys that should survive admin sidebar navigation. */
export const ASK_ULO_SEARCH_KEYS = [
  ASK_ULO_PARAM,
  ASK_ULO_CHAT_PARAM,
  ASK_ULO_DOCK_PARAM,
] as const

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
  closeAskUlo: () => void
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
 * Ask Ulo open state lives in the URL (`?askUlo=1`) so it survives layout
 * remounts and HMR. Optional `askUloChat=<uuid>` selects a persisted thread.
 * Params are kept on the current admin pathname so the docked right rail can
 * stay open while the landlord moves between nav items.
 */
export function AskUloProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const open = searchParams.get(ASK_ULO_PARAM) === '1'
  const docked = open && searchParams.get(ASK_ULO_DOCK_PARAM) === '1'
  const conversationId = searchParams.get(ASK_ULO_CHAT_PARAM)?.trim() || null

  const [conversations, setConversations] = useState<AskUloConversation[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [persistEnabled, setPersistEnabled] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const pendingPromptRef = useRef<string | null>(null)

  const adminPathname = location.pathname.startsWith('/admin')
    ? location.pathname
    : '/admin'

  const openAskUlo = useCallback(
    (nextConversationId?: string | null) => {
      const params = new URLSearchParams(searchParams)
      params.set(ASK_ULO_PARAM, '1')
      // Opening from the header keeps dock state as-is; default undocked (full panel).
      if (nextConversationId) params.set(ASK_ULO_CHAT_PARAM, nextConversationId)
      else if (!params.get(ASK_ULO_CHAT_PARAM)) params.delete(ASK_ULO_CHAT_PARAM)
      navigate({ pathname: adminPathname, search: `?${params.toString()}` })
    },
    [adminPathname, navigate, searchParams],
  )

  const openAskUloWithPrompt = useCallback(
    (prompt: string, opts?: { docked?: boolean }) => {
      const q = prompt.trim()
      if (!q) return
      pendingPromptRef.current = q
      setPendingPrompt(q)
      const params = new URLSearchParams(searchParams)
      params.set(ASK_ULO_PARAM, '1')
      // Fresh chat for search-launched questions.
      params.delete(ASK_ULO_CHAT_PARAM)
      if (opts?.docked) params.set(ASK_ULO_DOCK_PARAM, '1')
      navigate({ pathname: adminPathname, search: `?${params.toString()}` })
    },
    [adminPathname, navigate, searchParams],
  )

  const clearPendingPrompt = useCallback(() => {
    pendingPromptRef.current = null
    setPendingPrompt(null)
  }, [])

  const closeAskUlo = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    for (const key of ASK_ULO_SEARCH_KEYS) params.delete(key)
    const qs = params.toString()
    navigate(
      { pathname: adminPathname, search: qs ? `?${qs}` : '' },
      { replace: true },
    )
  }, [adminPathname, navigate, searchParams])

  const setConversationId = useCallback(
    (nextConversationId: string | null) => {
      const params = new URLSearchParams(searchParams)
      params.set(ASK_ULO_PARAM, '1')
      if (nextConversationId) {
        params.set(ASK_ULO_CHAT_PARAM, nextConversationId)
      } else {
        params.delete(ASK_ULO_CHAT_PARAM)
      }
      navigate(
        { pathname: adminPathname, search: `?${params.toString()}` },
        { replace: true },
      )
    },
    [adminPathname, navigate, searchParams],
  )

  const setDocked = useCallback(
    (nextDocked: boolean) => {
      const params = new URLSearchParams(searchParams)
      params.set(ASK_ULO_PARAM, '1')
      if (nextDocked) params.set(ASK_ULO_DOCK_PARAM, '1')
      else params.delete(ASK_ULO_DOCK_PARAM)
      navigate(
        { pathname: adminPathname, search: `?${params.toString()}` },
        { replace: true },
      )
    },
    [adminPathname, navigate, searchParams],
  )

  const refreshConversations = useCallback(async () => {
    const list = await listAskUloConversations({ landlordId: getActiveLandlordId() })
    setConversations(list)
    return list
  }, [])

  // Load history when Ask Ulo opens; restore latest thread if none selected.
  useEffect(() => {
    if (!open) return
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
      const chatParam = new URLSearchParams(window.location.search).get(ASK_ULO_CHAT_PARAM)
      // Keep a blank thread when universal search queued a prompt to auto-send.
      if (!chatParam && list.length > 0 && !pendingPromptRef.current) {
        const params = new URLSearchParams(window.location.search)
        params.set(ASK_ULO_PARAM, '1')
        params.set(ASK_ULO_CHAT_PARAM, list[0].id)
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
