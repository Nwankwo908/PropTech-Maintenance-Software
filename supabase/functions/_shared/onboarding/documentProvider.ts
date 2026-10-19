export const GEMINI_DOCUMENT_MODEL = 'gemini-3.8-flash'
export const OPENAI_LEASE_BACKUP_MODEL = 'gpt-4o-mini'
export type DocumentPart = { text: string } | { bytes: Uint8Array; mimeType: string; page?: number }
export type DocumentJsonResult = { raw: unknown; provider: 'gemini' | 'openai'; model: string; inputTokens: number; outputTokens: number }
export type DocumentProviderInput = {
  provider?: 'gemini' | 'openai'
  apiKey: string
  system: string
  parts: DocumentPart[]
  schema?: Record<string, unknown>
  /** Gemini only. Fast Track uses a lower resolution to cut latency. */
  mediaResolution?: 'MEDIA_RESOLUTION_HIGH' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_LOW'
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}
export function documentBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768))
  return btoa(binary)
}
function openAiStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
  const strip = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(strip); return }
    const record = node as Record<string, unknown>
    delete record.minimum
    delete record.maximum
    delete record.minItems
    delete record.maxItems
    Object.values(record).forEach(strip)
  }
  strip(copy)
  return copy
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
async function request(fetcher: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal) {
  const response = await fetcher(url,{...init, signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)})
  if (!response.ok) throw new Error(response.status === 429 ? 'Document scanning is busy. Please try again shortly.' : `Document provider request failed (${response.status}). Check the provider configuration.`)
  return response
}
export async function requestDocumentJson(input: DocumentProviderInput): Promise<DocumentJsonResult> {
  if (!input.apiKey.trim()) throw new Error(`Configure ${input.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} for document scanning.`)
  const fetcher = input.fetchImpl || fetch
  const provider = input.provider || 'gemini'
  const model = provider === 'gemini' ? GEMINI_DOCUMENT_MODEL : OPENAI_LEASE_BACKUP_MODEL
  if (provider === 'openai') {
    const content = input.parts.map(part => 'text' in part ? { type:'text', text:part.text } : part.mimeType === 'application/pdf' ? { type:'file', file:{ filename:'lease.pdf', file_data:`data:application/pdf;base64,${documentBase64(part.bytes)}` } } : { type:'image_url', image_url:{ url:`data:${part.mimeType};base64,${documentBase64(part.bytes)}` } })
    const response = await request(fetcher,'https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${input.apiKey}`},body:JSON.stringify({model,temperature:0,max_tokens:16384,messages:[{role:'system',content:input.system},{role:'user',content}],response_format:{type:'json_schema',json_schema:{name:'lease_scan',strict:true,schema:openAiStrictSchema(input.schema || {type:'object',additionalProperties:true,properties:{}})}}})},input.signal)
    const payload = await response.json()
    const choice = payload.choices?.[0]
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    if (!text || choice?.finish_reason === 'length') throw new Error('Document backup returned an incomplete result.')
    return { raw:JSON.parse(text), provider, model, inputTokens:payload.usage?.prompt_tokens || 0, outputTokens:payload.usage?.completion_tokens || 0 }
  }
  const uploaded: string[] = []
  try {
    const parts: Array<Record<string,unknown>> = []
    for (const part of input.parts) {
      if ('text' in part) { parts.push({text:part.text}); continue }
      if (part.bytes.length < 10*1024*1024) { parts.push({inlineData:{mimeType:part.mimeType,data:documentBase64(part.bytes)}}); continue }
      const started = await request(fetcher,'https://generativelanguage.googleapis.com/upload/v1beta/files',{method:'POST',headers:{'x-goog-api-key':input.apiKey,'Content-Type':'application/json','X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':String(part.bytes.length),'X-Goog-Upload-Header-Content-Type':part.mimeType},body:JSON.stringify({file:{display_name:'lease-document'}})},input.signal)
      const uploadUrl = started.headers.get('x-goog-upload-url')
      if (!uploadUrl || new URL(uploadUrl).protocol !== 'https:' || new URL(uploadUrl).hostname !== 'generativelanguage.googleapis.com') throw new Error('Invalid document upload destination.')
      const uploadedResponse = await request(fetcher,uploadUrl,{method:'POST',headers:{'x-goog-api-key':input.apiKey,'X-Goog-Upload-Offset':'0','X-Goog-Upload-Command':'upload, finalize'},body:part.bytes as BodyInit},input.signal)
      let file = (await uploadedResponse.json()).file
      if (!file?.name || !/^files\/[A-Za-z0-9_-]+$/.test(file.name)) throw new Error('Document upload returned no file reference.')
      uploaded.push(file.name)
      for (let attempt=0;file.state==='PROCESSING'&&attempt<5;attempt++) {
        await wait(500)
        file = await (await request(fetcher,`https://generativelanguage.googleapis.com/v1beta/${file.name}`,{headers:{'x-goog-api-key':input.apiKey}},input.signal)).json()
      }
      if (file.state !== 'ACTIVE' || !file.uri) throw new Error('Document is still processing. Please retry shortly.')
      parts.push({fileData:{mimeType:part.mimeType,fileUri:file.uri}})
    }
    const response = await request(fetcher,`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':input.apiKey},body:JSON.stringify({systemInstruction:{parts:[{text:input.system}]},contents:[{role:'user',parts}],generationConfig:{temperature:0,maxOutputTokens:16384,mediaResolution:input.mediaResolution || 'MEDIA_RESOLUTION_HIGH',responseMimeType:'application/json',...(input.schema ? {responseJsonSchema:input.schema} : {})}})},input.signal)
    const payload = await response.json(), candidate = payload.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') throw new Error('Document reading returned an incomplete result.')
    const content = candidate.content?.parts?.filter((part:{text?:string;thought?:boolean})=>!part.thought&&typeof part.text==='string').map((part:{text:string})=>part.text).join('')
    if (!content) throw new Error('Document reading returned no details.')
    return {raw:JSON.parse(content),provider,model,inputTokens:payload.usageMetadata?.promptTokenCount || 0,outputTokens:(payload.usageMetadata?.candidatesTokenCount || 0)+(payload.usageMetadata?.thoughtsTokenCount || 0)}
  } finally {
    for (const name of uploaded) await fetcher(`https://generativelanguage.googleapis.com/v1beta/${name}`,{method:'DELETE',headers:{'x-goog-api-key':input.apiKey},signal:AbortSignal.timeout(5000)}).catch(()=>{})
  }
}
