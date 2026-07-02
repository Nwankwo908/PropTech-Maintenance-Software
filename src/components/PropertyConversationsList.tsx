import type { PropertyConversationRow } from '@/lib/propertyConversations'

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-4 text-[#6a7282]">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
    </svg>
  )
}

type PropertyConversationsListProps = {
  rows: PropertyConversationRow[]
  loading?: boolean
  onSelectConversation?: (conversationId: string) => void
}

/** Property detail — Conversations tab list (Figma property overview). */
export function PropertyConversationsList({
  rows,
  loading = false,
  onSelectConversation,
}: PropertyConversationsListProps) {
  if (loading) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">Loading conversations…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">No conversations for this property yet.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <ul>
        {rows.map((row, index) => (
          <li key={row.id} className={index > 0 ? 'border-t border-[#f3f4f6]' : undefined}>
            <button
              type="button"
              onClick={() => onSelectConversation?.(row.id)}
              className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0030b5]"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6]">
                <ChatBubbleIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{row.headerLine}</p>
                <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#364153]">{row.preview}</p>
                <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">{row.metaLine}</p>
              </div>
              <span className="shrink-0 pt-0.5 text-[12px] leading-4 text-[#6a7282]">{row.timeLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
