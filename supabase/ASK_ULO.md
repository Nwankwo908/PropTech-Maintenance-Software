# Ask Ulo (RAG)

Admin panel chat backed by three separate retrieval tools (ops graph, legal pgvector, structured compliance facts) plus OpenAI synthesis.

## Module layout

`runAskUlo.ts` is a thin traffic controller:

```
understand → classify → safety → plan → retrieve → prefer evidence → write → check → audit
```

| Step | Module |
|------|--------|
| Understand | `core/context.ts` (`buildAskUloContext`) |
| Classify | `routing/classifyQuestion.ts` — intent, mode, subject, action, evidence requirements |
| Safety | `guards/checkSafetyRules.ts` — policy, Fair Housing, human-decision, permissions |
| Plan | `routing/planAskUloTurn.ts` — required/optional tools, OpenAI vs rules, retrieval needs |
| Retrieve | `retrieval/executeSelectedTools.ts` → `fetchSpecialtyEvidence.ts` (parallel specialty lookups) |
| Prefer / missing | `retrieval/resolvePreferPacket.ts` (`resolvePreferPacket`) |
| Write | `synthesis/synthesizeAnswerStage.ts` |
| Check | `quality/validateFinalAnswerStage.ts` |
| Audit | `audit/auditAskUloTurn.ts` → `writeAskUloAuditRecord.ts` |

`core/context.ts` (`buildAskUloContext`) prepares the turn: landlord, user, history, mode, portfolio jurisdiction, property scope, permissions stubs, feature flags, and `now` — not intent or tool results.

**Safety** (`guards/checkSafetyRules.ts`) decides whether Ask Ulo may answer or act:

| Check | Hard block? | Module |
|-------|-------------|--------|
| Policy / unauthorized action | Yes | `actionBoundary.ts` |
| Fair Housing risk | Yes when blocked; soft counsel when `refuseDecision` | `fairHousingSafety.ts` |
| Human must decide | Soft counsel annotation | `humanDecisionSafety.ts` |
| Role / permission deny | Yes | `permissionGuard.ts` |

Soft annotations (`requireCounsel`, `counselNote`, `screeningIsolation`) travel on `AskUloSafetyContinue` into write/check.  
“Refuse instead of guessing” for **missing evidence** is prefer/quality — not Safety.

`runGuards` / `runSafetyChecks` remain the implementation under `checkSafetyRules`.

**Guards** (supporting modules):

| Guard | Responsibility |
|-------|----------------|
| `checkSafetyRules` | **Safety stage** entry (policy + permission) |
| `runGuards` / `runSafetyChecks` | Implementation behind the stage |
| `evidenceGuard` | Subject → packet family (classification / decide) |
| `jurisdictionGuard` | Legal location / grounding (quality path) |

**Routing** (`routing/`) classifies the question before tools run:

- `classifyQuestion.ts` — **classification stage** (intent, mode, subject, capability, evidence plan)
- `detectIntent.ts` / `detectSubject.ts` / `capability.ts` — classifiers used by that stage
- `planAskUloTurn.ts` — **plan stage** (required/optional tools, OpenAI vs rule backup, retrieval needs)
- `resolveToolSelection.ts` / `deriveRetrievalNeeds.ts` — helpers for the plan
- `decideInformationNeeded.ts` — deprecated re-export shim
- `buildExecutionPlan.ts` — sync compat helper (tests / fallbacks)

Example for “Which tenants are late on rent at Maple Heights?”:

```json
{
  "action": "lookup",
  "intent": "ops",
  "subject": "resident",
  "capability": "search",
  "propertyId": "maple-heights",
  "propertyLabel": "Maple Heights",
  "tools": ["search_residents"],
  "toolCalls": [{ "name": "search_residents", "arguments": { "filter": "late_rent" } }]
}
```

```
_shared/ask_ulo/
├── runAskUlo.ts                    # orchestrator only (~90 lines)
├── core/                           # context, types, config, pipeline bags
├── guards/
│   ├── checkSafetyRules.ts         # safety stage entry
│   ├── runGuards.ts / runSafetyChecks.ts
│   ├── actionBoundary.ts / fairHousingSafety.ts / humanDecisionSafety.ts
│   └── permissionGuard.ts
├── routing/
│   ├── classifyQuestion.ts         # classification stage
│   ├── planAskUloTurn.ts           # plan stage (tools + retrieval needs)
│   ├── buildExecutionPlan.ts       # sync compat (classify + rule tools)
│   ├── deriveRetrievalNeeds.ts
│   └── resolveToolSelection.ts
├── retrieval/
│   ├── executeSelectedTools.ts     # retrieve stage controller
│   ├── fetchSpecialtyEvidence.ts   # parallel specialty lookups (same packets)
│   ├── resolvePreferPacket.ts      # prefer / incomplete / specialty before write
│   └── handlePreferredEvidence.ts  # re-export shim → resolvePreferPacket
├── synthesis/
│   ├── index.ts                    # traffic controller: prefer → OpenAI → fallback
│   ├── openai.ts                   # model call + settings (prompts via buildPrompt)
│   ├── fallback.ts                 # deterministic answers without OpenAI
│   ├── packets.ts                  # citations + transparency helpers
│   ├── buildPrompt.ts              # what the model receives
│   ├── formatAnswer.ts             # Quick Answer style + polish
│   ├── toolPackets.ts              # shared packet types
│   ├── synthesizeAnswer.ts         # re-export shim (stable public API)
│   └── synthesizeAnswerStage.ts    # pipeline stage adapter
├── quality/
│   ├── validateFinalAnswerStage.ts # check-stage controller
│   ├── applyQualityGateRewrites.ts # prefer / incomplete rewrites on QC fail
│   ├── runPostAnswerChecks.ts      # faithfulness → completeness → privacy → confidence → jurisdiction
│   ├── checkFaithfulness.ts
│   ├── checkCompleteness.ts
│   ├── checkPrivacy.ts
│   ├── checkConfidence.ts
│   ├── checkJurisdiction.ts
│   └── validateFinalAnswer.ts      # answer quality gate checklist
├── audit/
│   ├── auditAskUloTurn.ts          # stage: map turn → AskUloAuditRecord
│   ├── writeAskUloAuditRecord.ts   # persist (turn + eval + graph)
│   ├── writeAuditRecord.ts         # re-export shim → auditAskUloTurn
│   ├── logToolCalls.ts
│   ├── logDecision.ts
│   └── logGraphEvent.ts
├── tools/ | …
└── tests/
```

Root `*.ts` files remain re-export shims for stable import paths.

## Edge secrets

| Secret | Required | Notes |
|--------|----------|--------|
| `ADMIN_REASSIGN_SECRET` | Yes | Same value as `VITE_ADMIN_REASSIGN_SECRET`; send as `x-admin-reassign-secret` |
| `OPENAI_API_KEY` | Optional | Enables `gpt-4o` answers, `text-embedding-3-small` for legal RAG, and bounded tool select (`gpt-4o-mini`). Without it, returns a deterministic summary of tool packets (`mode: "fallback"`). |
| `ASK_ULO_OPENAI_TOOL_SELECT` | Optional | Default: on when `OPENAI_API_KEY` is set. Set `false` to force capability-route rule planning only. |
| `RENTCAST_API_KEY` | Optional | Listing-level rent AVM + comps for market analysis (preferred when available). |
| `ZILLOW_RAPIDAPI_KEY` | Optional | Alternate listing search via RapidAPI Zillow. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto | Provided by Supabase runtime |

Without RentCast/RapidAPI keys, market analysis still uses **public Zillow Research ZORI** (Observed Rent Index by ZIP/city/metro) — no secret required.

### Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `VITE_GOOGLE_MAPS_API_KEY` | Optional. Enables full `StreetViewPanorama` + Geocoder. Without it, market answers still show an interactive Street View embed when coordinates are known (demo properties include lat/lng). |

## Vite env

| Variable | Notes |
|----------|--------|
| `VITE_ASK_ULO_URL` | Optional override; defaults to `${VITE_SUPABASE_URL}/functions/v1/ask-ulo` |
| `VITE_ADMIN_REASSIGN_SECRET` | Must match Edge `ADMIN_REASSIGN_SECRET` |
| `VITE_SUPABASE_ANON_KEY` | Needed for hosted Functions gateway (anon JWT + admin secret header) |

## Deploy

1. Apply migrations:
   - `20260713210000_ask_ulo_rag.sql` (vector + legal/compliance seeds)
   - `20260713220000_ask_ulo_conversations.sql` (persisted chat threads for authenticated staff)
2. Deploy: `supabase functions deploy ask-ulo`
3. Set Edge secrets above.

## Conversations

- Authenticated staff: threads live in `ask_ulo_conversations` / `ask_ulo_messages` (RLS: own `auth_user_id`).
- The panel sends prior turns as `messages` so follow-ups keep context.
- Guests / no session: ephemeral UI only (cleared on refresh).

## Intent routing

Before retrieval, Ask Ulo classifies intent (`market_analysis`, `maintenance`, `legal`, `finance`, `property_health`, `vendor`, `ops`, `general`) and only runs matching tools.

- Market analysis / rental / neighborhood / investment → property snapshot + **live market data** + **Street View** + clickable comps; optional leasing-impact note only. No legal dump / ticket list.
- Legal → legal RAG + structured facts only.
- Maintenance / ops / vendor → ops graph.

Legal chunk embeddings start null; keyword fallback keeps legal retrieval working until you backfill embeddings via OpenAI.

## Subject gate + domain tools (incremental)

Ask Ulo is migrating from one-off playbooks toward a **domain tool engine** without an unconstrained agent.

1. **Subject detection** (`routing/detectSubject.ts`) — primary subject family (`vendor`, `resident`, `work_order`, `property`, …).
2. **Capability detection** (`routing/capability.ts`) — small set (`rank`, `search`, `identify_pending_decision`, `draft`, …).
3. **Controlled route table** (`routing/capabilityRoute.ts`) — subject + capability → required / optional `DomainToolId`s (never unrestricted tool choice). Turn planning is centralized in `routing/buildExecutionPlan.ts`.
4. **Bounded tool select** (`routing/selectTools.ts`) — optional OpenAI function-calling over the **live allowlist only** (required ∪ optional ∩ live ∩ subject gates). Empty/invalid selection logs `no_tool_matched` and falls back to rule planning from required tools (`routing/toolSelectNeeds.ts`). Set Edge `ASK_ULO_OPENAI_TOOL_SELECT=false` to force rules-only.
5. **Hard evidence gate** (`guards/evidenceGuard.ts`) — vendor / resident / work-order / finance questions must **not** fetch or synthesize from property ranking or portfolio briefing.
6. **Fail-closed briefing** (`shouldFetchPortfolioBriefing`) — portfolio briefing packets are fetched only for explicit `executive_briefing` / `property_health` asks. `generic_ops` does **not** auto-consult Tier-1 briefing.
7. **Domain tools** (`tools/{maintenance,vendors,residents,rent,properties,finance,localMarket}/`) — one-job lookups under domain folders. Shared contract: `tools/_shared/toolResult.ts` → `ToolResult<T> = { success, data?, evidence, error? }`.
   - `searchWorkOrders` (live; also `searchWorkOrdersAsToolResult` for the ToolResult envelope)
   - `searchLateRent` (live in `tools/rent/` — returns ToolResult; `listResidents` filter `late_rent` delegates here)
   - `getPropertyInsights` (live wrapper)
   - `getAwaitingDecisions` (live wrapper)
   - `rankVendors` (live wrapper over best/speed/completion/inactive/overload)
   - `listResidents` (live — late rent / move-in / message non-response; public tool id stays `search_residents`)
   - `draftCommunication` (live — notices / emails / checklists via capability `draft`)
   - `listActiveWorkflows` (live — “what is Ulo handling” / active workflows; never portfolio briefing)
   - `getWeatherAlerts` (live — NWS active alerts for portfolio city/state locations)
   - `getLandlordIncentives` (live — jurisdiction-scoped curated landlord grants / tax / energy incentives; not tax advice)
8. **Evidence organizer** (`retrieval/buildEvidencePacket.ts`) — one place that organizes facts before OpenAI writes:
   - Combines tool/DB results, dedupes, ranks strongest sources
   - Attaches dates + jurisdiction; marks stale rows (`sourceFreshness.ts`)
   - Splits **internal** / **legal** / **market** / **missing**
   - Logged as `ASK_ULO_EVIDENCE_BUNDLE` + `ASK_ULO_EVIDENCE_PACKET`
   - Injected into synthesis as `ORGANIZED EVIDENCE` (specialty packets still present for backward compat)
9. **Catch-all work-order fallback** (`retrieval/catchAllFallback.ts`) — when specialty packets miss for `work_order` / `maintenance` / `unit` / `finance` / `other`, format `search_work_orders` hits as a landlord prefer-packet. **Never** portfolio briefing or property ranking. Logs `ASK_ULO_CATCHALL_FALLBACK` + `catchall_fallback:search_work_orders|none`.
10. **Structured incomplete evidence** (`guards/incompleteEvidence.ts` + `retrieval/resolvePreferPacket.ts`) — ranking lookups emit `canRank` / `missingData[]` / known facts. When `ranking_status` is incomplete on a ranking-primary turn, **`resolvePreferPacket`** short-circuits OpenAI with code-owned gap markdown (`formatIncompleteAnswer`). Specialty packets (residents, vendors, drafts, catch-all WOs, …) use the same prefer policy before write and again for quality-gate rewrites. Logs `ASK_ULO_INCOMPLETE_EVIDENCE` + `prefer_packet:*`.

OpenAI still **synthesizes** natural language; Ulo code still owns retrieval, safety, and validation. Tool-calling is **not** used inside `synthesis/openai.ts`.

### Answer generation (synthesis/)

| Module | Owns |
|--------|------|
| `index.ts` | Traffic controller: prepared / prefer → OpenAI → fallback (`synthesizeAskUloAnswer`) |
| `openai.ts` | OpenAI `fetch`, model id, temperature via `buildPrompt` |
| `fallback.ts` | Deterministic answers (briefing, priority, market, legal, …) |
| `packets.ts` | Citation merge + reasoning transparency helpers |
| `buildPrompt.ts` | System + user messages; **ORGANIZED EVIDENCE** is the primary fact source |
| `formatAnswer.ts` | `ANSWER_STYLE_GUIDE` + `formatAskUloAnswer` / `polishAskUloProse` |
| `synthesizeAnswer.ts` | Stable re-export shim for existing imports |

Change response style in `formatAnswer.ts` without touching tool execution. Empty `(skipped)` specialty dumps are omitted from the OpenAI prompt.

### Post-answer quality (fail-closed)

After synthesis, `quality/runPostAnswerChecks.ts` runs five independent checks:

| Module | Verifies |
|--------|----------|
| `checkFaithfulness.ts` | Every hard claim / figure comes from evidence or citations |
| `checkCompleteness.ts` | Answered the actual question; did not overstate uncertainty when evidence exists |
| `checkPrivacy.ts` | No PII / screening detail leaked in the draft |
| `checkConfidence.ts` | Claims are not more certain than the evidence supports |
| `checkJurisdiction.ts` | Correct property scope; no landlord-data mix; legal jurisdiction match |

Stage controller: `quality/validateFinalAnswerStage.ts`  
1. `runAnswerQualityGate` → 2. `applyQualityGateRewrites` → 3. `runPostAnswerQualityChecks` → 4. response bag for audit.

On `failClosed`, the draft is replaced with a landlord-facing refuse/clarify message (`ASK_ULO_POST_ANSWER_QUALITY`). Soft contact PII may be redacted without a full refuse.

1. **Recency** — domain guides stay in the system prompt; `trailingStyleConstraints()` (anti-slop + conversation style) is appended **after** evidence packets in the final user message (`buildPrompt.ts`).
2. **Temperature by intent** — `synthesizeTemperatureForIntent()` (legal ~0.15, finance/history ~0.2, ops/maintenance ~0.4, general ~0.55).
3. **Few-shot blueprints** — `styleBlueprintsForIntent()` injects short good/bad examples for `legal` and draft-ish `general` / `ops` / `maintenance` only.

### Portfolio jurisdiction (per landlord)

`resolvePortfolioJurisdiction` scopes legal / market / incentives filters from **that landlord’s input**, never a shared demo default:

1. `landlord_onboarding.properties` (wizard city/state) — primary
2. `units.city` / `units.state` — persisted from onboarding
3. Demo OR building names — **only** when the landlord has zero user-entered locations

Logs: `ASK_ULO_PORTFOLIO_JURISDICTION`, `portfolio_location:*`, `portfolio_place:*`.

### External-question taxonomy (epistemic buckets)

Every turn logs `ASK_ULO_EPISTEMIC_BUCKET` with `{classified_bucket, matched_rule, confidence, fallback_reason, secondary_signals}`:

| Bucket | Meaning |
|--------|---------|
| `external_vendor` | Out-of-network vendor discovery (Google/Yelp/…) |
| `allowlisted_facts` | Market / legal / weather / incentives |
| `internal_unmatched` | Portfolio ask that missed specialty tools (`no_tool_matched` / catchall none) |
| `policy_boundary` | Action / safety refuse (role boundary, not a data gap) |
| `internal_specialty` | Normal in-portfolio specialty hit |

Compound vendor + market asks append an explicit **One thing at a time** note for the dropped half (`compound:dropped_half_note`). Legal + incentives get code-owned freshness / staleness caveats (`sourceFreshness.ts`). Tool-miss / catchall-none prefer a structured incomplete packet (not free-form synthesis).

Playbooks remain until each capability is wrapped and tested — **do not add new one-off playbooks** for phrasing variants. Extend `capability.ts` hints + domain tool args instead. Unmatched questions must fail closed (no briefing dump), not fall through to Health score packets.

Do not adopt the OpenAI Agents SDK as the primary orchestrator in this phase.

### Audit contract

End of turn calls `auditAskUloTurn` (stage adapter). That maps the validated answer + route into one `AskUloAuditRecord` and persists via `writeAskUloAuditRecord`:

```ts
await auditAskUloTurn({ context, route, evidence, answer, safety })
// → writeAskUloAuditRecord({
//   intent, toolsSelected, toolsUsed, evidenceUsed,
//   refusalReason, responseStatus, // answered | refused | clarified | blocked
//   eval, graphMetadata // subject, capability, playbook, post-answer checks, …
// })
```

That one write persists `ask_ulo_turns`, `ask_ulo_evals`, and `ask_ulo.*` graph events (including subject / capability / playbook and post-answer check outcomes). Mid-pipeline debug tags go through `audit/logToolCalls.ts` and `audit/logDecision.ts`. Guard blocks that return early still audit via the same persist path where applicable.

### Tool-select logging

| Log / `toolsUsed` tag | Meaning |
|--------|----------|
| `ASK_ULO_TOOL_SELECT` | Allowlist, planned tools, `no_tool_matched`, OpenAI latency |
| `ASK_ULO_TOOLS_CALLED` | Planned vs actually executed live tools |
| `tool_select:openai\|rules\|error` | Which planner won |
| `tools_planned:<id>` / `tools_called:<id>` | Per-tool audit |
| `no_tool_matched` | OpenAI returned nothing allowlisted — rules used |
| `ASK_ULO_CATCHALL_FALLBACK` | Subject-scoped WO catch-all attempt / hit count |
| `catchall_fallback:search_work_orders\|none` | Whether catch-all shipped an answer |
| `ASK_ULO_FAILURE_TAGS` / `faithfulness_detail.failure_tags` | Structured routing/gap failure tags for feedback loops |
| `ASK_ULO_FEEDBACK_LOOP` | Thumbs feedback joins prior `failure_tags` |

| Existing | Replacement tool | Status |
|----------|-------------------|--------|
| `searchOperationalRecords` / deep ops | `searchWorkOrders` | live |
| `propertyInsightsLookup` | `get_property_insights` | live |
| `repairsToApproveLookup` | `get_awaiting_decisions` | live |
| Vendor metric lookups | `rank_vendors` | live |
| Late-rent residents | `search_residents` / `listResidents` | live |
| `propertyRankingLookup` | `rank_properties` | live |
| Ops graph search | `search_operations_graph` | live |
| Legal RAG + structured | `search_legal_sources` | live |
| Market / comps | `get_market_intelligence` | live |
