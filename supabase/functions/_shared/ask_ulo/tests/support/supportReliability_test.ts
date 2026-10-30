import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { supportConfirmation, historyHadClarifyingAttempt } from '../../support/createProductSupportTicket.ts'
import { classifyAskUloJob } from '../../routing/classifyAskUloJob.ts'
import { parseOpenWorkOrderCount } from '../../tools/maintenance/countWorkOrders.ts'
import { resolveFollowUpQuestion } from '../../routing/followUpContext.ts'
import { extractEntitiesFromQuestion } from '../../tools/maintenance/entityInvestigation.ts'
import { classifyQuestion } from '../../routing/classifyQuestion.ts'
Deno.test('support confirmations distinguish durable persistence from notification acceptance',()=>{
 for(const status of ['failed','pending','skipped'] as const){const text=supportConfirmation({created:false,summary:'Synthetic issue',repeatCount:2,notifyStatus:status});assertEquals(/was notified|already has|will follow up|re-notified/i.test(text),false);assertStringIncludes(text,'saved')}
 assertStringIncludes(supportConfirmation({created:true,summary:'Issue',repeatCount:1,notifyStatus:'sent'}),'accepted')
})
Deno.test('actual clarification wording counts as a previous clarification',()=>assertEquals(historyHadClarifyingAttempt([{role:'assistant',content:'Are you stuck on a specific screen or button? Reply with a short description.'}]),true))
Deno.test('vendor UI help and operational vendor questions stay separate',()=>{
 assertEquals(classifyAskUloJob('How do I invite a vendor in Ulo?').job,'product_support')
 assertEquals(classifyAskUloJob('Which vendor responds fastest?').job,'portfolio_analyst')
 assertEquals(classifyAskUloJob("It still doesn't work",['How do I invite a vendor in Ulo?']).job,'product_support')
})
Deno.test('open count wording and property follow-up preserve scope',()=>{
 assertEquals(parseOpenWorkOrderCount('How many work orders are open?'),{property:null})
 assertEquals(parseOpenWorkOrderCount('How many open work orders do I have at Cedar House?'),{property:'Cedar House'})
 assertEquals(resolveFollowUpQuestion('How many open repairs at that property?',[{role:'user',content:'How many open repairs at Cedar House?'}]),'How many open repairs at Cedar House?')
})
Deno.test('ordinary lease and inspection descriptions are not entity IDs',()=>{
 assertEquals(extractEntitiesFromQuestion('What is my inspection compliance?').some(e=>e.kind==='inspection'),false)
 assertEquals(extractEntitiesFromQuestion('Summarize lease documents').some(e=>e.kind==='lease'),false)
 assertEquals(extractEntitiesFromQuestion('Status of inspection INS-45').some(e=>e.kind==='inspection'),true)
})
Deno.test('overdue balances use residents; documents keep their own subject',()=>{
 const financial=classifyQuestion({question:'Show overdue balances',priorUserTurns:[],agentMode:'financial_insights'})
 assertEquals(financial.capabilityRoute.requiredTools.includes('search_residents'),true)
 const doc=classifyQuestion({question:'Summarize my lease documents',priorUserTurns:[],agentMode:null})
 assertEquals(doc.subject,'document')
})

Deno.test('parallel timing stages retain each in-flight measurement without content', async()=>{
 const {createAskUloTiming}=await import('../../core/timing.ts')
 let now=0;const timing=createAskUloTiming(()=>now,()=>{});let first!:()=>void;let second!:()=>void
 const a=timing.measure('database_http',()=>new Promise<void>(r=>first=r));now=2
 const b=timing.measure('database_http',()=>new Promise<void>(r=>second=r));now=5;first();await a
 assertEquals(timing.snapshot().stagesInFlight,['database_http']);now=8;second();await b
 assertEquals(timing.snapshot().stagesMs.database_http,11)
 assertEquals(timing.snapshot().stagesInFlight,[])
})
Deno.test('email provider needs an accepted message ID for support notifications',async()=>{
 const {sendResendEmail}=await import('../../../delivery.ts');const original=globalThis.fetch;const key=Deno.env.get('RESEND_API_KEY');Deno.env.set('RESEND_API_KEY','SIMULATED')
 try {for(const body of ['{}','not-json']){globalThis.fetch=async()=>new Response(body,{status:200});const result=await sendResendEmail('test@example.invalid','Synthetic','Synthetic','<p>Synthetic</p>',{requireMessageId:true});assertEquals('error' in result,true)}}
 finally{globalThis.fetch=original;if(key==null)Deno.env.delete('RESEND_API_KEY');else Deno.env.set('RESEND_API_KEY',key)}
})
Deno.test('slang maintenance attention question stays on priorities route',async()=>{
 const {isDailyPrioritiesQuestion}=await import('../../tools/ops/dailyPrioritiesDetect.ts')
 assertEquals(isDailyPrioritiesQuestion('Yo which open repairs need my attention rn?'),true)
})
Deno.test('verified missing-metric packet is not contradicted by unrelated evidence',async()=>{
 const {checkAnswerCompleteness}=await import('../../quality/checkCompleteness.ts')
 const result=checkAnswerCompleteness({question:'Which vendor responds fastest?',answer:"I don't have enough timed vendor responses yet to say who responds the fastest. Accept / decline timings are missing.",hasEvidence:true,packetSatisfied:true})
 assertEquals(result.reasons.includes('overstated_uncertainty_with_evidence'),false)
})
Deno.test('natural acceptance prose is preserved across repeated formatting passes',async()=>{
 const {humanizeOperationalProse:humanizeOpsLanguage}=await import('../../synthesis/operationalLanguage.ts')
 const text="Once vendors have accepted work, I'll rank them by how quickly they respond."
 assertEquals(humanizeOpsLanguage(text),text)
 assertEquals(humanizeOpsLanguage(humanizeOpsLanguage(text)),text)
 assertEquals(humanizeOpsLanguage(humanizeOpsLanguage('accepted')),'vendor accepted the job')
})
