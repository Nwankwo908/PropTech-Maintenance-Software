import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { emailFromAuthSession, getAdminSession } from '@/lib/adminAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { countInboxConversations } from '@/lib/propertyConversations'
import { supabase } from '@/lib/supabase'
import { isPortalAdminEmailAllowed, isStaffAdminEmail } from '@shared/admin/staffAllowlist'

/** Live Messages total — inbox threads, same types as the Messages list. */
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
      const { data, error } = await db
        .from('sms_conversations')
        .select('conversation_type')
        .eq('landlord_id', landlordId)
        .limit(2000)
      if (cancelled) return
      if (error) {
        setCount(null)
        return
      }
      const types = ((data ?? []) as { conversation_type?: string | null }[]).map(
        (row) => row.conversation_type,
      )
      setCount(countInboxConversations(types, { includeLandlordUpdate }))
    })().catch(() => {
      if (!cancelled) setCount(null)
    })
    return () => {
      cancelled = true
    }
  }, [landlordId, location.pathname])

  return count
}
