import { timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { convertStoredSmsVideo } from '../scripts/lib/runSmsVideoConvert.mjs'
import { playbackSiblingPath } from '../shared/sms/media.ts'
import {
  browserPlaybackFfmpegArgs,
  conversionAccessDecision,
  inputHasAudioStream,
  outputPlaybackCheck,
  playbackStatusPath,
  shouldStartPlaybackJob,
  smsConversationIdFromStoragePath,
} from '../shared/sms/videoPlayback.ts'

export const config = { maxDuration: 60 }

const helpers = {
  playbackSiblingPath,
  playbackStatusPath,
  shouldStartPlaybackJob,
  browserPlaybackFfmpegArgs,
  inputHasAudioStream,
  outputPlaybackCheck,
}

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

function secretMatches(given: string, expected: string): boolean {
  const left = Buffer.from(given)
  const right = Buffer.from(expected)
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

async function signPath(supabase: SupabaseClient, objectPath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('maintenance-uploads')
    .createSignedUrl(objectPath, 3600)
  if (error || !data?.signedUrl) return ''
  return data.signedUrl
}

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

type Res = {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.status(204).json({})
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabaseUrl = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = readEnv('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({ error: 'Playback conversion is not configured.' })
    return
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) as { path?: unknown } : (req.body ?? {}) as { path?: unknown }
  const path = typeof body.path === 'string' ? body.path.trim() : ''
  const conversationId = smsConversationIdFromStoragePath(path)
  if (!conversationId) {
    res.status(400).json({ error: 'That file cannot be converted.' })
    return
  }

  const headerSecret = req.headers['x-ulo-convert-secret']
  const givenSecret = Array.isArray(headerSecret) ? headerSecret[0] ?? '' : headerSecret ?? ''
  const expectedSecret = readEnv('CONVERT_MEDIA_SECRET')
  const serviceMode = Boolean(expectedSecret) && secretMatches(givenSecret, expectedSecret)

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: conversation, error: conversationError } = await service
    .from('sms_conversations')
    .select('id, landlord_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (conversationError) {
    res.status(500).json({ error: 'Playback conversion could not check this conversation.' })
    return
  }

  let userCanAccess = false
  if (!serviceMode) {
    const authorization = req.headers.authorization
    const header = Array.isArray(authorization) ? authorization[0] ?? '' : authorization ?? ''
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
    if (!token || !anonKey) {
      res.status(401).json({ error: 'Sign in again to prepare this preview.' })
      return
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const userResult = await userClient.auth.getUser(token)
    if (!userResult.data.user) {
      res.status(401).json({ error: 'Sign in again to prepare this preview.' })
      return
    }
    const landlordId = typeof conversation?.landlord_id === 'string' ? conversation.landlord_id : ''
    const access = landlordId
      ? await userClient.rpc('can_access_landlord', { p_landlord_id: landlordId })
      : { data: false }
    userCanAccess = access.data === true
  }

  const decision = conversionAccessDecision({
    path,
    conversationFound: Boolean(conversation?.id),
    resourceLandlordId: typeof conversation?.landlord_id === 'string' ? conversation.landlord_id : null,
    mode: serviceMode ? 'service' : 'user',
    userCanAccess,
  })
  if (!decision.ok) {
    res.status(decision.status).json({ error: decision.error })
    return
  }

  try {
    const result = await convertStoredSmsVideo(service, helpers, { path })
    const playbackUrl = result.playbackPath && result.status === 'ready'
      ? await signPath(service, result.playbackPath)
      : ''
    const originalUrl = await signPath(service, path)
    res.status(result.status === 'failed' ? 422 : 200).json({
      status: result.status,
      playbackUrl,
      originalUrl,
      error: result.error,
    })
  } catch (error) {
    console.error('[convert-sms-media]', error instanceof Error ? error.message : 'failed')
    res.status(500).json({ error: 'We couldn’t prepare a preview.' })
  }
}
