import { useMemo, useState } from 'react'
import type { AskUloConversation } from '@/lib/askUloConversations'

type AskUloConversationSidebarProps = {
  conversations: AskUloConversation[]
  activeId: string | null
  persistEnabled: boolean
  loading?: boolean
  /** Hide labels / densify for the collapsed admin rail. */
  collapsed?: boolean
  onNewChat: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Conversation list for Ask Ulo — embeds inside the admin sidebar. */
export function AskUloConversationSidebar({
  conversations,
  activeId,
  persistEnabled,
  loading,
  collapsed = false,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
}: AskUloConversationSidebarProps) {
  const [search, setSearch] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, search])

  function startRename(c: AskUloConversation) {
    setRenamingId(c.id)
    setRenameDraft(c.title)
    setMenuId(null)
  }

  function commitRename() {
    if (!renamingId) return
    const next = renameDraft.trim()
    if (next) onRename(renamingId, next)
    setRenamingId(null)
    setRenameDraft('')
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 pt-3">
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[10px] text-[#364153] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828]"
          aria-label="New chat"
          title="New chat"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 pt-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex min-h-[44px] w-full cursor-pointer items-center justify-start gap-3 rounded-[10px] px-4 text-left text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828]"
        >
          <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New chat
        </button>
      </div>

      {!persistEnabled ? (
        <p className="px-1 pt-3 text-[12px] leading-4 text-[#6a7282]">
          Sign in to keep chat history across sessions.
        </p>
      ) : (
        <>
          <div className="pt-3">
            <label className="sr-only" htmlFor="ask-ulo-chat-search">
              Search conversations
            </label>
            <input
              id="ask-ulo-chat-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="h-8 w-full rounded-[10px] border border-[#e5e7eb] bg-white px-2.5 text-[12px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] focus-visible:ring-2 focus-visible:ring-[#101828]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pt-3">
            <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-[0.04em] text-[#9ca3af]">
              Recent
            </p>
            {loading ? (
              <p className="px-1 py-2 text-[12px] text-[#6a7282]">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-[#6a7282]">No conversations yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((c) => {
                  const active = c.id === activeId
                  const renaming = renamingId === c.id
                  return (
                    <li key={c.id} className="relative">
                      {renaming ? (
                        <form
                          className="rounded-[10px] border border-[#d1d5dc] bg-white p-1.5"
                          onSubmit={(e) => {
                            e.preventDefault()
                            commitRename()
                          }}
                        >
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setRenamingId(null)
                                setRenameDraft('')
                              }
                            }}
                            className="w-full bg-transparent text-[12px] text-[#0a0a0a] outline-none"
                          />
                        </form>
                      ) : (
                        <div
                          className={`group flex items-center gap-1 rounded-[10px] ${
                            active
                              ? 'bg-[#101828]/8 text-[#101828]'
                              : 'text-[#0a0a0a] hover:bg-[#f3f4f6]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(c.id)}
                            className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#101828]"
                          >
                            <span className="block truncate text-[12px] font-medium leading-4">
                              {c.title}
                            </span>
                            <span
                              className={`mt-0.5 block text-[10px] ${
                                active ? 'text-[#6a7282]' : 'text-[#9ca3af]'
                              }`}
                            >
                              {formatRelative(c.updatedAt)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`mr-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none ${
                              active
                                ? 'text-[#6a7282] hover:bg-[#101828]/8'
                                : 'text-[#9ca3af] opacity-0 hover:bg-[#e5e7eb] group-hover:opacity-100'
                            }`}
                            aria-label="Conversation options"
                            onClick={() => setMenuId((id) => (id === c.id ? null : c.id))}
                          >
                            <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                              <circle cx="5" cy="12" r="1.6" />
                              <circle cx="12" cy="12" r="1.6" />
                              <circle cx="19" cy="12" r="1.6" />
                            </svg>
                          </button>
                        </div>
                      )}

                      {menuId === c.id ? (
                        <div className="absolute right-1 top-full z-20 mt-1 w-36 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
                          <button
                            type="button"
                            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-[#0a0a0a] hover:bg-[#f3f4f6]"
                            onClick={() => startRename(c)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="block w-full cursor-pointer px-3 py-1.5 text-left text-[12px] text-[#b91c1c] hover:bg-[#fef2f2]"
                            onClick={() => {
                              setMenuId(null)
                              onDelete(c.id)
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
