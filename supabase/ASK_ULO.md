# Ask Ulo (RAG)

Admin panel chat backed by a **domain tool engine** (bounded allowlist), legal RAG, structured compliance facts, and OpenAI synthesis.

## Pipeline

`runAskUlo.ts` is a thin traffic controller:

```
understand → classify → safety → plan → retrieve → prefer evidence → write → check → audit
```

| Step | Module |
|------|--------|
| Understand | `core/context.ts` (`buildAskUloContext`) |
| Classify | `routing/classifyQuestion.ts` — intent, mode, subject, capability, evidence plan |
| Safety | `guards/checkSafetyRules.ts` — policy, Fair Housing, human-decision, permissions |
| Plan | `routing/planAskUloTurn.ts` — tool allowlist, OpenAI vs rules, `plannedTools`, retrieval playbook flags |
| Retrieve | `retrieval/executeSelectedTools.ts` → `fetchSpecialtyEvidence.ts` → `executePlannedDomainTools` |
| Prefer / missing | `retrieval/resolvePreferPacket.ts` |
| Write | `synthesis/synthesizeAnswerStage.ts` → `synthesis/index.ts` |
| Check | `quality/validateFinalAnswerStage.ts` |
| Audit | `audit/auditAskUloTurn.ts` → `writeAskUloAuditRecord.ts` |

`core/context.ts` prepares the turn: landlord, user, history, mode, portfolio jurisdiction, property scope, permissions, feature flags, and `now` — not intent or tool results.

## Plan → retrieve (domain tool engine)

Turn planning is centralized in **`routing/planAskUloTurn.ts`**:

1. **`resolveToolSelection`** — capability-route required tools + optional bounded OpenAI select (`routing/selectTools.ts`, max 3 tools, allowlist only, fail closed).
2. **`deriveRetrievalNeeds`** — playbook flags from classification (subject gates, briefing opt-in, vendor locks). Used to build the retrieval plan and for permission/audit metadata — **not** to dispatch lookups inside retrieve.
3. **`buildRetrievalToolPlan`** — maps playbook flags → `PlannedDomainToolCall[]` (e.g. `rank_vendors`, `get_portfolio_briefing`, `search_operations_graph`).
4. **`mergePlannedTools`** — merges capability plan + retrieval plan (capability wins on duplicate tool ids).
5. **`filterPlannedToolsByPermissions`** — drops disallowed tools before fetch.

Retrieve executes **`plannedTools` only** via `tools/_shared/executeDomainTool.ts` → `fetchSpecialtyEvidence` → `applyDomainToolResults`. Legal RAG / structured compliance still run in fetch when the legacy intent plan requires them.

```
classifyQuestion
  └─ planAskUloTurn
       ├─ resolveToolSelection (allowlist + optional OpenAI)
       ├─ deriveRetrievalNeeds (playbook flags)
       └─ buildRetrievalToolPlan + mergePlannedTools → plannedTools

executeSelectedTools
  ├─ filterPlannedToolsByPermissions
  ├─ applyPermissionGatesToRetrievalNeeds (audit / defense-in-depth)
  ├─ fetchSpecialtyEvidence → executePlannedDomainTools
  └─ catch-all search_work_orders when specialty packets miss
```

Example plan for “Which tenants are late on rent at Maple Heights?”:

```json
{
  "action": "lookup",
  "intent": "ops",
  "subject": "resident",
  "capability": "search",
  "propertyLabel": "Maple Heights",
  "plannedTools": [
    { "name": "search_residents", "arguments": { "filter": "late_rent" } }
  ]
}
```

## Module layout

```
_shared/ask_ulo/
├── runAskUlo.ts                    # orchestrator only
├── refreshCadence.ts               # official source refresh policy (Edge cron)
├── core/                           # context, types, config, pipeline bags
├── guards/
│   ├── checkSafetyRules.ts         # safety stage entry
│   ├── evidenceGuard.ts            # subject → allowed packet families
│   ├── filterPlannedToolsByPermissions.ts
│   ├── permissionGuard.ts          # role refuse + applyPermissionGatesToRetrievalNeeds
│   ├── incompleteEvidence.ts
│   └── runGuards.ts / runSafetyChecks.ts / actionBoundary.ts / …
├── routing/
│   ├── classifyQuestion.ts
│   ├── planAskUloTurn.ts           # plan stage
│   ├── deriveRetrievalNeeds.ts     # playbook flags (plan + audit)
│   ├── buildRetrievalToolPlan.ts   # flags → domain tool calls
│   ├── mergePlannedTools.ts
│   ├── resolveToolSelection.ts
│   ├── selectTools.ts              # bounded OpenAI tool select
│   ├── capabilityRoute.ts          # subject + capability → required/optional tools
│   ├── buildExecutionPlan.ts       # sync compat (tests / fallbacks)
│   └── detectIntent.ts / detectSubject.ts / capability.ts / …
├── retrieval/
│   ├── executeSelectedTools.ts     # retrieve stage controller
│   ├── fetchSpecialtyEvidence.ts   # plannedTools executor + legal/market side paths
│   ├── applyDomainToolResults.ts
│   ├── buildEvidencePacket.ts      # organized evidence before synthesis
│   ├── resolvePreferPacket.ts
│   └── catchAllFallback.ts         # subject-scoped WO fallback (never briefing/ranking)
├── tools/
│   ├── _shared/registry.ts         # live DomainToolId allowlist
│   ├── _shared/executeDomainTool.ts
│   └── {maintenance,vendors,residents,rent,properties,finance,localMarket,legal}/…
├── synthesis/
│   ├── index.ts                    # synthesizeAskUloAnswer (prefer → OpenAI → fallback)
│   ├── synthesizeAnswerStage.ts    # pipeline stage adapter
│   ├── openai.ts / fallback.ts / packets.ts / buildPrompt.ts / formatAnswer.ts
│   └── toolPackets.ts
├── quality/                        # validateFinalAnswerStage + post-answer checks
├── audit/
└── tests/                          # behavioral tests by area (routing, guards, tools, …)
```

Import paths are canonical (`routing/`, `tools/`, `synthesis/index.ts`, etc.). Root-level re-export shims were removed.

## Safety (unchanged policy)

| Check | Hard block? | Module |
|-------|-------------|--------|
| Policy / unauthorized action | Yes | `actionBoundary.ts` |
| Fair Housing risk | Yes when blocked; soft counsel when `refuseDecision` | `fairHousingSafety.ts` |
| Human must decide | Soft counsel annotation | `humanDecisionSafety.ts` |
| Role / permission deny | Yes | `permissionGuard.ts` |

**Evidence subject gate** (`guards/evidenceGuard.ts`): vendor / resident / work-order questions must not use property ranking or portfolio briefing as primary evidence.

**Portfolio briefing opt-in** (`routing/reasoningMode.ts` → `shouldFetchPortfolioBriefing`): briefing is fetched only for explicit executive briefing / property health asks — not generic ops.

**Catch-all fallback** (`retrieval/catchAllFallback.ts`): when specialty packets miss for work-order–like subjects, format `search_work_orders` hits. Never portfolio briefing or property ranking.

Soft annotations travel on `AskUloSafetyContinue` into write/check. “Refuse instead of guessing” for missing evidence is prefer/quality — not Safety.

## Domain tools (live allowlist)

Shared contract: `tools/_shared/toolResult.ts` → `ToolResult<T> = { success, data?, evidence, error? }`.

| Tool id | Role |
|---------|------|
| `search_work_orders` | Work-order search + catch-all fallback |
| `search_operations_graph` | Ops graph lookup |
| `rank_vendors` | All vendor metric rankings (consolidated) |
| `search_residents` | Late rent / move-in / message non-response (`listResidents`) |
| `get_portfolio_briefing` | Executive briefing packet (opt-in only) |
| `rank_properties` | Property priority ranking |
| `get_property_insights` / `get_property_snapshot` | Property context |
| `get_awaiting_decisions` | Repairs awaiting approval |
| `investigate_entity` / `investigate_operations` | Entity / deep ops |
| `draft_communication` | Notices / emails / checklists |
| `list_active_workflows` | Active Ulo workflows |
| `get_weather_alerts` / `get_landlord_incentives` | External allowlisted facts |
| `get_market_intelligence` | Market / comps (via fetch side path) |
| `search_legal_sources` | Legal RAG + structured (via fetch side path) |
| `get_property_price_history` / `get_rent_history` | Finance history tables |

OpenAI tool-calling is **not** used inside `synthesis/openai.ts`. Bounded select runs only at plan time over the registry subset.

## Answer generation (synthesis/)

| Module | Owns |
|--------|------|
| `index.ts` | Traffic controller: prepared / prefer → OpenAI → fallback |
| `openai.ts` | Model call + settings (prompts via `buildPrompt`) |
| `fallback.ts` | Deterministic answers without OpenAI |
| `packets.ts` | Citation merge + reasoning transparency |
| `buildPrompt.ts` | System + user messages; **ORGANIZED EVIDENCE** is primary |
| `formatAnswer.ts` | Quick Answer style + polish |

Change response style in `formatAnswer.ts` without touching tool execution.

## Post-answer quality (fail-closed)

After synthesis, `quality/runPostAnswerChecks.ts` runs faithfulness → completeness → privacy → confidence → jurisdiction.

Stage controller: `quality/validateFinalAnswerStage.ts`  
1. `runAnswerQualityGate` → 2. `applyQualityGateRewrites` → 3. `runPostAnswerQualityChecks` → 4. response bag for audit.

On `failClosed`, the draft is replaced with landlord-facing refuse/clarify copy.

## Edge secrets

| Secret | Required | Notes |
|--------|----------|--------|
| `ADMIN_REASSIGN_SECRET` | Yes | Same value as `VITE_ADMIN_REASSIGN_SECRET`; send as `x-admin-reassign-secret` |
| `OPENAI_API_KEY` | Optional | Enables `gpt-4o` answers, `text-embedding-3-small` for legal RAG, and bounded tool select (`gpt-4o-mini`). Without it, returns a deterministic summary of tool packets (`mode: "fallback"`). |
| `ASK_ULO_OPENAI_TOOL_SELECT` | Optional | Default: on when `OPENAI_API_KEY` is set. Set `false` to force capability-route rule planning only. |
| `RENTCAST_API_KEY` | Optional | Listing-level rent AVM + comps for market analysis (preferred when available). |
| `ZILLOW_RAPIDAPI_KEY` | Optional | Alternate listing search via RapidAPI Zillow (`zillow-com1`). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Auto | Provided by Supabase runtime |

Without RentCast/RapidAPI keys, market analysis reports that live comps are unavailable.

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

- Market analysis → property snapshot + live market data + Street View; no legal dump / ticket list.
- Legal → legal RAG + structured facts only.
- Maintenance / ops / vendor → domain tools + ops graph as planned.

Legal chunk embeddings start null; keyword fallback keeps legal retrieval working until you backfill embeddings via OpenAI.

## Portfolio jurisdiction (per landlord)

`resolvePortfolioJurisdiction` scopes legal / market / incentives filters from **that landlord’s input**, never a shared demo default:

1. `landlord_onboarding.properties` (wizard city/state) — primary
2. `units.city` / `units.state` — persisted from onboarding
3. Demo OR building names — **only** when the landlord has zero user-entered locations

Logs: `ASK_ULO_PORTFOLIO_JURISDICTION`, `portfolio_location:*`, `portfolio_place:*`.

## External-question taxonomy (epistemic buckets)

Every turn logs `ASK_ULO_EPISTEMIC_BUCKET` with `{classified_bucket, matched_rule, confidence, fallback_reason, secondary_signals}`:

| Bucket | Meaning |
|--------|---------|
| `external_vendor` | Out-of-network vendor discovery |
| `allowlisted_facts` | Market / legal / weather / incentives |
| `internal_unmatched` | Portfolio ask that missed specialty tools |
| `policy_boundary` | Action / safety refuse |
| `internal_specialty` | Normal in-portfolio specialty hit |

Playbooks remain for classification hints until each capability is fully wrapped — **do not add new one-off playbooks** for phrasing variants. Extend `capability.ts` hints + domain tool args instead.

Do not adopt the OpenAI Agents SDK as the primary orchestrator in this phase.

## Audit contract

End of turn calls `auditAskUloTurn`, which maps the validated answer + route into one `AskUloAuditRecord` and persists via `writeAskUloAuditRecord` (`ask_ulo_turns`, `ask_ulo_evals`, graph events).

Evidence bag carries `plannedTools`, `retrievalNeeds` (playbook flags after permission gates), `toolsUsed`, and organized evidence metadata.

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
| `permission:gated:*` | Defense-in-depth permission tags on retrieve |
