/// <reference lib="deno.ns" />
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inboundHasContent,
  normalizeOutboundForLoopCompare,
  shouldSuppressIdenticalOutbound,
} from "./sms_inbound_guard.ts"

Deno.test("inboundHasContent treats photo-only MMS as content", () => {
  assertEquals(inboundHasContent("", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("   ", ["https://example.com/a.jpg"]), true)
  assertEquals(inboundHasContent("Leak under sink", []), true)
  assertEquals(inboundHasContent("", []), false)
  assertEquals(inboundHasContent("   ", [""]), false)
})

Deno.test("shouldSuppressIdenticalOutbound trips when one prior identical body exists", () => {
  const body =
    "Happy to help. What do you need — a repair, something about rent or your lease, or something else?"
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [body],
      candidateBody: body,
    }).trip,
    true,
  )
  assertEquals(
    shouldSuppressIdenticalOutbound({
      recentOutboundBodies: [],
      candidateBody: body,
    }).trip,
    false,
  )
})

Deno.test("outboundCountsTowardIdenticalReplyLoop ignores failed candidates", async () => {
  const { outboundCountsTowardIdenticalReplyLoop } = await import(
    "./sms_inbound_guard.ts"
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "failed" }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({
      providerStatus: null,
      rawPayload: { send_error: "provider down" },
    }),
    false,
  )
  assertEquals(
    outboundCountsTowardIdenticalReplyLoop({ providerStatus: "delivered" }),
    true,
  )
})

Deno.test("normalizeOutboundForLoopCompare strips Hi there / Hi Name greetings", () => {
  const there =
    "Hi there,\n\nI'm sorry this has been frustrating.\n\nA member of our team will follow up with you here shortly."
  const named =
    "Hi Shahita,\n\nI'm sorry this has been frustrating.\n\nA member of our team will follow up with you here shortly."
  assertEquals(
    normalizeOutboundForLoopCompare(there),
    normalizeOutboundForLoopCompare(named),
  )
  assertEquals(
    normalizeOutboundForLoopCompare(there).includes("hi there"),
    false,
  )
})


Deno.test("Home Check repeat gate anchors to the exact inbound and keeps same-turn protection", async () => {
  const { shouldTripOutboundCircuit } = await import("./sms_inbound_guard.ts")
  const now = Date.now()
  const inboundAt = new Date(now - 5000).toISOString()
  const outboundAt = new Date(now - 1000).toISOString()
  const body = "What does this photo show? Reply 1–4."
  const filters: Array<[string, unknown, unknown]> = []
  let includeSameTurn = false
  const db = { from: () => {
    let cutoff = ""
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (key: string, value: unknown) => { filters.push(['eq', key, value]); return q },
      gte: (key: string, value: string) => { cutoff = value; filters.push(['gte', key, value]); return q },
      maybeSingle: async () => ({ data: { created_at: inboundAt }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [
        { body, created_at: new Date(now - 10000).toISOString(), provider_status: 'delivered' },
        ...(includeSameTurn ? [{ body, created_at: outboundAt, provider_status: 'delivered' }] : []),
      ].filter(row => row.created_at >= cutoff), error: null })),
    }
    return q
  } }
  // Normal workflows keep the hour-long protection.
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body })).trip, true)
  // A new Home Check photo may legitimately need the same clarification.
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body, replyToInboundId: 'exact-inbound' })).trip, false)
  assertEquals(filters.some(([op, key, value]) => op === 'eq' && key === 'id' && value === 'exact-inbound'), true)
  // Reprocessing that same inbound still suppresses the duplicate reply.
  includeSameTurn = true
  assertEquals((await shouldTripOutboundCircuit(db as never, { conversationId: 'conv', body, replyToInboundId: 'exact-inbound' })).trip, true)
})

function debounceFixture(messages: Array<{id:string;created_at:string;body:string;media_urls:unknown}>) {
 return { from: () => {
  let id='',after='',before=''
  const q: any = {
   select:()=>q,order:()=>q,limit:()=>q,
   eq:(key:string,value:string)=>{if(key==='id')id=value;return q},
   gt:(_key:string,value:string)=>{after=value;return q},
   lte:(_key:string,value:string)=>{before=value;return q},
   maybeSingle:async()=>({data:messages.find(m=>m.id===id)??null,error:null}),
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(resolve({data:messages.filter(m=>m.created_at>after&&m.created_at<=before).slice(-1),error:null})),
  }
  return q
 }}
}

Deno.test('simultaneous carrier-split photos each process, including the first 133ms before the next',async()=>{
 const {decideInboundDebounce}=await import('./sms_inbound_guard.ts')
 const times=['2026-11-02T15:05:08.839Z','2026-11-02T15:05:08.972Z','2026-11-02T15:05:19.292Z','2026-11-02T15:05:23.974Z']
 const messages=times.map((created_at,i)=>({id:String(i),created_at,body:'',media_urls:[`sms/test/${i}.jpg`]}))
 const results=await Promise.all(messages.map(m=>decideInboundDebounce(debounceFixture(messages) as never,{conversationId:'vendor',messageId:m.id})))
 assertEquals(results,messages.map(()=>({action:'process'})))
})
Deno.test('a captioned photo cannot be superseded by another text or photo',async()=>{
 const {decideInboundDebounce}=await import('./sms_inbound_guard.ts')
 const messages=[{id:'photo',created_at:'2026-11-02T15:05:00.000Z',body:'Heating label',media_urls:['sms/test/label.jpg']},{id:'text',created_at:'2026-11-02T15:05:00.100Z',body:'Here are the rest',media_urls:[]}]
 assertEquals(await decideInboundDebounce(debounceFixture(messages) as never,{conversationId:'vendor',messageId:'photo'}),{action:'process'})
})
Deno.test('newer text still supersedes earlier text-only messages',async()=>{
 const {decideInboundDebounce}=await import('./sms_inbound_guard.ts')
 const messages=[{id:'old',created_at:'2026-11-02T15:05:00.000Z',body:'hello',media_urls:[]},{id:'new',created_at:'2026-11-02T15:05:00.100Z',body:'newer',media_urls:[]}]
 assertEquals(await decideInboundDebounce(debounceFixture(messages) as never,{conversationId:'test',messageId:'old'}),{action:'skip',reason:'superseded_by_newer'})
})
Deno.test('blank or invalid media entries do not bypass empty-message protection',async()=>{
 const {decideInboundDebounce}=await import('./sms_inbound_guard.ts')
 for(const media_urls of [[],[' '],[null],null]) {
  const messages=[{id:'empty',created_at:'2026-11-02T15:05:00.000Z',body:'',media_urls}]
  assertEquals(await decideInboundDebounce(debounceFixture(messages) as never,{conversationId:'test',messageId:'empty'}),{action:'skip',reason:'empty_message'})
 }
})

Deno.test('all four Nov 4 carrier deliveries survive when the first three arrive inside one debounce window',async()=>{
 const {decideInboundDebounce}=await import('./sms_inbound_guard.ts')
 const times=['2026-11-04T12:33:21.752Z','2026-11-04T12:33:22.687Z','2026-11-04T12:33:22.838Z','2026-11-04T12:33:26.236Z']
 const messages=times.map((created_at,i)=>({id:String(i),created_at,body:'',media_urls:[`sms/disposable-batch/${i}.jpg`]}))
 const decisions=await Promise.all(messages.map(m=>decideInboundDebounce(debounceFixture(messages) as never,{conversationId:'disposable-vendor',messageId:m.id})))
 assertEquals(decisions,messages.map(()=>({action:'process'})))
})
