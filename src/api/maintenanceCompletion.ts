import { supabase } from '@/lib/supabase'

export type CompletionJobContext = {
  ticketId: string
  workOrderRef: string
  unit: string
  description: string
  vendorWorkStatus: string
  completionPhotoCount: number
  completionPhotoUrls: string[]
  canComplete: boolean
  alreadyCompleted: boolean
}

async function invokeCompletion(body: Record<string, unknown>) {
  if (!supabase) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
  const { data, error } = await supabase.functions.invoke(
    'vendor-complete-job-upload',
    { body },
  )
  if (error) {
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      try {
        const t = await ctx.text()
        const j = t ? (JSON.parse(t) as { error?: string }) : null
        if (j?.error) message = j.error
      } catch {
        /* ignore */
      }
    }
    throw new Error(message)
  }
  return data as Record<string, unknown>
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('Could not read photo'))
    reader.readAsDataURL(file)
  })
}

export async function resolveCompletionJob(
  token: string,
): Promise<CompletionJobContext> {
  const data = await invokeCompletion({ token, action: 'resolve' })
  if (!data?.ticketId || !data.workOrderRef) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not load upload form',
    )
  }
  return {
    ticketId: String(data.ticketId),
    workOrderRef: String(data.workOrderRef),
    unit: typeof data.unit === 'string' ? data.unit : '',
    description: typeof data.description === 'string' ? data.description : '',
    vendorWorkStatus:
      typeof data.vendorWorkStatus === 'string' ? data.vendorWorkStatus : '',
    completionPhotoCount: Number(data.completionPhotoCount) || 0,
    completionPhotoUrls: Array.isArray(data.completionPhotoUrls)
      ? data.completionPhotoUrls.filter((u): u is string => typeof u === 'string')
      : [],
    canComplete: Boolean(data.canComplete),
    alreadyCompleted: Boolean(data.alreadyCompleted),
  }
}

export async function uploadCompletionPhotos(
  token: string,
  files: File[],
): Promise<{
  added: number
  completionPhotoCount: number
  canComplete: boolean
  completionPhotoUrls: string[]
  message: string
}> {
  const photos = []
  for (const file of files) {
    const base64 = await fileToBase64(file)
    photos.push({
      base64,
      contentType: file.type || 'image/jpeg',
      fileName: file.name,
    })
  }
  const data = await invokeCompletion({
    token,
    action: 'upload',
    photos,
  })
  if (!data?.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not upload photos',
    )
  }
  return {
    added: Number(data.added) || 0,
    completionPhotoCount: Number(data.completionPhotoCount) || 0,
    canComplete: Boolean(data.canComplete),
    completionPhotoUrls: Array.isArray(data.completionPhotoUrls)
      ? data.completionPhotoUrls.filter((u): u is string => typeof u === 'string')
      : [],
    message:
      typeof data.message === 'string' ? data.message : 'Photos uploaded.',
  }
}

export async function completeJobWithPhotos(
  token: string,
): Promise<{ message: string; photoCount: number }> {
  const data = await invokeCompletion({ token, action: 'complete' })
  if (!data?.ok) {
    throw new Error(
      typeof data?.error === 'string' ? data.error : 'Could not complete job',
    )
  }
  return {
    photoCount: Number(data.photoCount) || 0,
    message:
      typeof data.message === 'string'
        ? data.message
        : 'Job marked complete.',
  }
}
