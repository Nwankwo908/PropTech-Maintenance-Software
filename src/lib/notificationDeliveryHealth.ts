import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type NotificationDeliveryHealth = {
  sent7Days: number
  delivered7Days: number
  failed7Days: number
  deliveryRateLabel: string
  hasData: boolean
}

export async function fetchNotificationDeliveryHealth(
  landlordId: string = getActiveLandlordId(),
): Promise<NotificationDeliveryHealth> {
  const empty: NotificationDeliveryHealth = {
    sent7Days: 0,
    delivered7Days: 0,
    failed7Days: 0,
    deliveryRateLabel: '—',
    hasData: false,
  }
  if (!supabase) return empty

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('sms_messages')
    .select('provider_status')
    .eq('landlord_id', landlordId)
    .eq('direction', 'outbound')
    .gte('created_at', since)
    .limit(5000)

  if (error || !data?.length) return empty

  let delivered = 0
  let failed = 0
  for (const row of data) {
    const status = String(row.provider_status ?? '').toLowerCase()
    if (status.includes('fail') || status.includes('undeliver') || status === 'error') {
      failed += 1
    } else {
      delivered += 1
    }
  }
  const sent = data.length
  const rate = sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0

  return {
    sent7Days: sent,
    delivered7Days: delivered,
    failed7Days: failed,
    deliveryRateLabel: `${rate}%`,
    hasData: true,
  }
}
