import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { emailFromAuthSession, getAdminSession } from '@/lib/adminAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { isCommunicationConversationUnread } from '@/lib/communicationInboxRead'
import { computeCommunicationInboxKpis } from '@/lib/communicationInboxKpis'
import { isCommunicationInboxConversationType } from '@/lib/propertyConversations'
import { supabase } from '@/lib/supabase'
import { isPortalAdminEmailAllowed, isStaffAdminEmail } from '@shared/admin/staffAllowlist'

function parseMs(raw: string | null | undefined): number {
  if (!raw) return 0
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Live Messages badge — unread threads ∪ conversations needing a reply
 * (not the total number of inbox conversations).
 */
export function useMessagesNavCount(): number | null {
  const location = useLocation()
  const landlordId = getActiveLandlordId()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!supabase) {
      setCount(null)
      return
    }
    const db = supabase
    void (async () => {
      const session = await getAdminSession()
      if (cancelled) return
      const email = emailFromAuthSession(session)
      const includeLandlordUpdate =
        isStaffAdminEmail(email) || isPortalAdminEmailAllowed(email)

      const [convResult, msgResult] = await Promise.all([
        db
          .from('sms_conversations')
          .select('id, status, conversation_type, created_at, updated_at')
          .eq('landlord_id', landlordId)
          .limit(2000),
        db
          .from('sms_messages')
          .select('conversation_id, direction, provider_status, created_at')
          .eq('landlord_id', landlordId)
          .order('created_at', { ascending: false })
          .limit(5000),
      ])
      if (cancelled) return
      if (convResult.error || msgResult.error) {
        setCount(null)
        return
      }

      const conversations = []
      for (const raw of (convResult.data ?? []) as Record<string, unknown>[]) {
        const id = typeof raw.id === 'string' ? raw.id : ''
        if (!id) continue
        const conversationType =
          typeof raw.conversation_type === 'string' ? raw.conversation_type : ''
        if (
          !isCommunicationInboxConversationType(conversationType, {
            includeLandlordUpdate,
          })
        ) {
          continue
        }
        conversations.push({
          id,
          status: (typeof raw.status === 'string' && raw.status) || 'open',
          conversationType,
          createdAtMs: parseMs(typeof raw.created_at === 'string' ? raw.created_at : null),
          updatedAtMs: parseMs(
            typeof raw.updated_at === 'string'
              ? raw.updated_at
              : typeof raw.created_at === 'string'
                ? raw.created_at
                : null,
          ),
        })
      }

      const messages = ((msgResult.data ?? []) as Record<string, unknown>[]).map((raw) => ({
        conversationId:
          typeof raw.conversation_id === 'string' ? raw.conversation_id : '',
        direction: typeof raw.direction === 'string' ? raw.direction : '',
        providerStatus:
          typeof raw.provider_status === 'string' ? raw.provider_status : '',
        createdAtMs: parseMs(typeof raw.created_at === 'string' ? raw.created_at : null),
      }))

      const kpis = computeCommunicationInboxKpis({
        conversations,
        messages,
        nowMs: Date.now(),
        responseRate: null,
        responseRateDelta: null,
        isUnread: ({ conversationId, lastActivityMs, activityLooksUnread }) =>
          isCommunicationConversationUnread({
            landlordId,
            conversationId,
            lastActivityMs,
            activityLooksUnread,
          }),
      })

      const attentionIds = new Set([
        ...kpis.unreadThreadIds,
        ...kpis.needsYourResponseThreadIds,
      ])
      setCount(attentionIds.size)
    })().catch(() => {
      if (!cancelled) setCount(null)
    })
    return () => {
      cancelled = true
    }
  }, [landlordId, location.pathname])

  return count
}
