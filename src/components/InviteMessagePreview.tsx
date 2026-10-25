import { useEffect, useState } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  buildInvitePreview,
  type InvitePreviewChannel,
} from '@/lib/inviteMessagePreview'
import type { SetupOutreachRecipientKind } from '@/lib/setupOutreachAck'
import { supabase } from '@/lib/supabase'
import { uloAppOrigin } from '@/lib/uloAppUrl'

function previewVerificationLink(): string {
  const origin = uloAppOrigin().replace(/\/$/, '')
  return origin ? `${origin}/v/…` : 'https://www.ulohome.io/v/…'
}

export function InviteMessagePreview({
  kind,
  recipientName,
  channel,
  several = false,
}: {
  kind: SetupOutreachRecipientKind
  recipientName?: string | null
  channel?: InvitePreviewChannel
  several?: boolean
}) {
  const [companyName, setCompanyName] = useState<string | null>(null)

  useEffect(() => {
    const landlordId = getActiveLandlordId()
    if (!supabase || !landlordId) return
    let cancelled = false
    void supabase
      .from('landlords')
      .select('name')
      .eq('id', landlordId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const name = typeof data?.name === 'string' ? data.name.trim() : ''
        setCompanyName(name || null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const blocks = buildInvitePreview({
    kind,
    recipientName,
    companyName,
    channel,
    link: kind === 'vendor' ? previewVerificationLink() : undefined,
  })
  const who = kind === 'resident' ? 'resident' : 'vendor'

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-[13px] font-semibold leading-5 text-[#0a0a0a]">Message preview</p>
      {several ? (
        <p className="text-[13px] leading-5 text-[#6a7282]">
          Each selected {who} receives this message with their own name.
        </p>
      ) : null}
      {blocks.map((block) => (
        <section
          key={block.label}
          className="rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3"
          aria-label={`${block.label} preview`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#6a7282]">
            {block.label}
          </p>
          {block.subject ? (
            <p className="mt-2 text-[13px] font-medium leading-5 text-[#0a0a0a]">
              {block.subject}
            </p>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#364153]">
            {block.body}
          </p>
        </section>
      ))}
    </div>
  )
}
