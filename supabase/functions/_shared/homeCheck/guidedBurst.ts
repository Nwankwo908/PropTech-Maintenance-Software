import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
/** Receipt hint only: raw SMS originals remain intact, never inferred as slots. */
export async function guidedBurstReply(db: SupabaseClient, input: {
  landlordId: string; conversationId: string; from: string | null; to: string | null; path: string; reply: string;
}): Promise<string> {
  if (!input.from || !input.to) return input.reply
  try {
    const source = await db.from('sms_messages').select('created_at')
      .eq('landlord_id', input.landlordId).eq('conversation_id', input.conversationId)
      .eq('direction', 'inbound').eq('from_number', input.from).eq('to_number', input.to)
      .contains('media_urls', [input.path]).order('created_at', { ascending: true }).limit(1).maybeSingle()
    const at = Date.parse(source.data?.created_at ?? '')
    if (source.error || !Number.isFinite(at)) return input.reply
    const siblings = await db.from('sms_messages').select('media_urls')
      .eq('landlord_id', input.landlordId).eq('conversation_id', input.conversationId)
      .eq('direction', 'inbound').eq('from_number', input.from).eq('to_number', input.to)
      .gte('created_at', new Date(at - 2000).toISOString()).lte('created_at', new Date(at + 2000).toISOString())
    if (siblings.error || !siblings.data?.some(row => Array.isArray(row.media_urls) && row.media_urls.some((p: unknown) => typeof p === 'string' && p !== input.path))) return input.reply
    return `${input.reply}\n\nPlease send one photo at a time and wait for my reply. Extra photos remain in this conversation but haven’t been assigned.`
  } catch { return input.reply }
}
