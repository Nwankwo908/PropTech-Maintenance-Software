/**
 * Ask Ulo conversation persistence for authenticated staff.
 * Guest / no-session sessions stay ephemeral in component state only.
 *
 * Schema is future-ready (pinned, starred, metadata) without requiring UI yet.
 */

import type { AskUloCitation } from '@/api/askUlo'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export type AskUloConversation = {
  id: string
  landlordId: string
  authUserId: string
  title: string
  pinned: boolean
  starred: boolean
  archivedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type AskUloStoredMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: AskUloCitation[]
  toolsUsed: string[]
  model: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  if (cleaned.length <= 48) return cleaned
  return `${cleaned.slice(0, 45).trimEnd()}…`
}

async function requireAuthUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user?.id) return null
  return data.user.id
}

/** True when chats can be persisted for the current session. */
export async function canPersistAskUloChats(): Promise<boolean> {
  return (await requireAuthUserId()) != null
}

export async function listAskUloConversations(input?: {
  search?: string
  landlordId?: string | null
}): Promise<AskUloConversation[]> {
  const userId = await requireAuthUserId()
  if (!userId || !supabase) return []

  const landlordId = input?.landlordId?.trim() || getActiveLandlordId()
  let query = supabase
    .from('ask_ulo_conversations')
    .select(
      'id, landlord_id, auth_user_id, title, pinned, starred, archived_at, metadata, created_at, updated_at',
    )
    .eq('auth_user_id', userId)
    .eq('landlord_id', landlordId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(80)

  const search = input?.search?.trim()
  if (search) {
    query = query.ilike('title', `%${search}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[askUloConversations] list failed', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    landlordId: row.landlord_id as string,
    authUserId: row.auth_user_id as string,
    title: (row.title as string) || 'New chat',
    pinned: Boolean(row.pinned),
    starred: Boolean(row.starred),
    archivedAt: (row.archived_at as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }))
}

export async function createAskUloConversation(input: {
  title?: string
  landlordId?: string | null
}): Promise<AskUloConversation | null> {
  const userId = await requireAuthUserId()
  if (!userId || !supabase) return null

  const landlordId = input.landlordId?.trim() || getActiveLandlordId()
  const { data, error } = await supabase
    .from('ask_ulo_conversations')
    .insert({
      landlord_id: landlordId,
      auth_user_id: userId,
      title: input.title?.trim() || 'New chat',
    })
    .select(
      'id, landlord_id, auth_user_id, title, pinned, starred, archived_at, metadata, created_at, updated_at',
    )
    .single()

  if (error || !data) {
    console.error('[askUloConversations] create failed', error?.message)
    return null
  }

  return {
    id: data.id as string,
    landlordId: data.landlord_id as string,
    authUserId: data.auth_user_id as string,
    title: (data.title as string) || 'New chat',
    pinned: Boolean(data.pinned),
    starred: Boolean(data.starred),
    archivedAt: (data.archived_at as string | null) ?? null,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  }
}

export async function renameAskUloConversation(
  conversationId: string,
  title: string,
): Promise<boolean> {
  if (!supabase) return false
  const next = title.trim() || 'New chat'
  const { error } = await supabase
    .from('ask_ulo_conversations')
    .update({ title: next, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) {
    console.error('[askUloConversations] rename failed', error.message)
    return false
  }
  return true
}

/** Soft-delete via archived_at (keeps rows for future recovery/export). */
export async function archiveAskUloConversation(conversationId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('ask_ulo_conversations')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', conversationId)
  if (error) {
    console.error('[askUloConversations] archive failed', error.message)
    return false
  }
  return true
}

export async function loadAskUloMessages(
  conversationId: string,
): Promise<AskUloStoredMessage[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('ask_ulo_messages')
    .select(
      'id, conversation_id, role, content, citations, tools_used, model, metadata, created_at',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[askUloConversations] messages failed', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as AskUloStoredMessage['role'],
    content: row.content as string,
    citations: Array.isArray(row.citations) ? (row.citations as AskUloCitation[]) : [],
    toolsUsed: Array.isArray(row.tools_used) ? (row.tools_used as string[]) : [],
    model: typeof row.model === 'string' ? row.model : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }))
}

export async function appendAskUloMessage(input: {
  conversationId: string
  landlordId?: string | null
  role: 'user' | 'assistant'
  content: string
  citations?: AskUloCitation[]
  toolsUsed?: string[]
  model?: string | null
  metadata?: Record<string, unknown>
}): Promise<AskUloStoredMessage | null> {
  if (!supabase) return null
  const landlordId = input.landlordId?.trim() || getActiveLandlordId()
  const { data, error } = await supabase
    .from('ask_ulo_messages')
    .insert({
      conversation_id: input.conversationId,
      landlord_id: landlordId,
      role: input.role,
      content: input.content,
      citations: input.citations ?? [],
      tools_used: input.toolsUsed ?? [],
      model: input.model ?? null,
      metadata: input.metadata ?? {},
    })
    .select(
      'id, conversation_id, role, content, citations, tools_used, model, metadata, created_at',
    )
    .single()

  if (error || !data) {
    console.error('[askUloConversations] append failed', error?.message)
    return null
  }

  return {
    id: data.id as string,
    conversationId: data.conversation_id as string,
    role: data.role as AskUloStoredMessage['role'],
    content: data.content as string,
    citations: Array.isArray(data.citations) ? (data.citations as AskUloCitation[]) : [],
    toolsUsed: Array.isArray(data.tools_used) ? (data.tools_used as string[]) : [],
    model: typeof data.model === 'string' ? data.model : null,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    createdAt: data.created_at as string,
  }
}

/**
 * Ensure a conversation exists for the first user message and set a title
 * from that prompt when still "New chat".
 */
export async function ensureAskUloConversationForPrompt(input: {
  conversationId: string | null
  prompt: string
  landlordId?: string | null
}): Promise<AskUloConversation | null> {
  const title = titleFromPrompt(input.prompt)
  if (input.conversationId) {
    const list = await listAskUloConversations({ landlordId: input.landlordId })
    const existing = list.find((c) => c.id === input.conversationId)
    if (existing) {
      if (existing.title === 'New chat') {
        await renameAskUloConversation(existing.id, title)
        return { ...existing, title }
      }
      return existing
    }
  }
  return createAskUloConversation({ title, landlordId: input.landlordId })
}

export { titleFromPrompt }
