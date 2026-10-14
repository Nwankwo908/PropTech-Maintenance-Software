export const GEMINI_DOCUMENT_MODEL = 'gemini-3.8-flash'
export const CLAUDE_DOCUMENT_MODEL = 'claude-sonnet-5-5'
export type DocumentPart = { text: string } | { bytes: Uint8Array; mimeType: string; page?: number }
export type DocumentJsonResult = { raw: unknown; provider: 'gemini' | 'claude'; model: string; inputTokens: number; outputTokens: number }
export type DocumentProviderInput = { provider?: 'gemini' | 'claude'; apiKey: string; system: string; parts: DocumentPart[]; schema?: Record<string, unknown>; fetchImpl?: typeof fetch; signal?: AbortSignal }
export function documentBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768))
  return btoa(binary)
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
async function request(fetcher: typeof fetch, url: string, init: RequestInit, signal?: AbortSignal) {
  const response = await fetcher(url,{...init, signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)})
  if (!response.ok) throw new Error(response.status === 429 ? 'Document scanning is busy. Please try again shortly.' : `Document provider request failed (${response.status}). Check the provider configuration.`)
  return response
}
export async function requestDocumentJson(input: DocumentProviderInput): Promise<DocumentJsonResult> {
  if (!input.apiKey.trim()) throw new Error(`Configure ${input.provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} for document scanning.`)
  const fetcher = input.fetchImpl || fetch
  const provider = input.provider || 'gemini'
  const model = provider === 'gemini' ? GEMINI_DOCUMENT_MODEL : CLAUDE_DOCUMENT_MODEL
  if (provider === 'claude') {
    const content = input.parts.map(part => 'text' in part ? { type:'text', text:part.text } : { type:part.mimeType === 'application/pdf' ? 'document' : 'image', source:{type:'base64',media_type:part.mimeType,data:documentBase64(part.bytes)} })
    const response = await request(fetcher,'https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':input.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,temperature:0,max_tokens:8192,system:input.system,messages:[{role:'user',content}],tools:[{name:'extract_document',description:'Return document fields with evidence and missing-information status.',input_schema:input.schema || {type:'object',additionalProperties:true}}],tool_choice:{type:'tool',name:'extract_document'}})},input.signal)
    const payload = await response.json()
    const tool = payload.content?.find((block: {type?:string;name?:string})=>block.type==='tool_use'&&block.name==='extract_document')
    if (payload.stop_reason !== 'tool_use' || !tool?.input) throw new Error('Document backup returned an incomplete result.')
    return { raw:tool.input,provider,model,inputTokens:payload.usage?.input_tokens || 0,outputTokens:payload.usage?.output_tokens || 0 }
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
    const response = await request(fetcher,`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':input.apiKey},body:JSON.stringify({systemInstruction:{parts:[{text:input.system}]},contents:[{role:'user',parts}],generationConfig:{temperature:0,maxOutputTokens:16384,mediaResolution:'MEDIA_RESOLUTION_HIGH',responseMimeType:'application/json',...(input.schema ? {responseJsonSchema:input.schema} : {})}})},input.signal)
    const payload = await response.json(), candidate = payload.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') throw new Error('Document reading returned an incomplete result.')
    const content = candidate.content?.parts?.filter((part:{text?:string;thought?:boolean})=>!part.thought&&typeof part.text==='string').map((part:{text:string})=>part.text).join('')
    if (!content) throw new Error('Document reading returned no details.')
    return {raw:JSON.parse(content),provider,model,inputTokens:payload.usageMetadata?.promptTokenCount || 0,outputTokens:(payload.usageMetadata?.candidatesTokenCount || 0)+(payload.usageMetadata?.thoughtsTokenCount || 0)}
  } finally {
    for (const name of uploaded) await fetcher(`https://generativelanguage.googleapis.com/v1beta/${name}`,{method:'DELETE',headers:{'x-goog-api-key':input.apiKey},signal:AbortSignal.timeout(5000)}).catch(()=>{})
  }
}
