# Ask Ulo (RAG)

Admin panel chat backed by three separate retrieval tools (ops graph, legal pgvector, structured compliance facts) plus OpenAI synthesis.

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

1. **Subject detection** (`questionSubjectMatch.ts`) — primary subject family (`vendor`, `resident`, `work_order`, `property`, …).
2. **Capability detection** (`capability.ts`) — small set (`rank`, `search`, `identify_pending_decision`, `draft`, …).
3. **Controlled route table** (`capabilityRoute.ts`) — subject + capability → required / optional `DomainToolId`s (never unrestricted tool choice).
4. **Bounded tool select** (`domainTools/openaiToolSelect.ts`) — optional OpenAI function-calling over the **live allowlist only** (required ∪ optional ∩ live ∩ subject gates). Empty/invalid selection logs `no_tool_matched` and falls back to rule planning from required tools (`toolSelectNeeds.ts`). Set Edge `ASK_ULO_OPENAI_TOOL_SELECT=false` to force rules-only.
5. **Hard evidence gate** (`subjectEvidenceGate.ts`) — vendor / resident / work-order / finance questions must **not** fetch or synthesize from property ranking or portfolio briefing.
6. **Fail-closed briefing** (`shouldFetchPortfolioBriefing`) — portfolio briefing packets are fetched only for explicit `executive_briefing` / `property_health` asks. `generic_ops` does **not** auto-consult Tier-1 briefing.
7. **Domain tools** (`domainTools/`) — shared parameterized lookups:
   - `searchWorkOrders` (live)
   - `getPropertyInsights` (live wrapper)
   - `getAwaitingDecisions` (live wrapper)
   - `rankVendors` (live wrapper over best/speed/completion/inactive/overload)
   - `listResidents` (live — late rent via `users.balance_due` + `rent_collection` runs)
   - `draftCommunication` (live — notices / emails / checklists via capability `draft`)
   - `listActiveWorkflows` (live — “what is Ulo handling” / active workflows; never portfolio briefing)
   - `getWeatherAlerts` (live — NWS active alerts for portfolio city/state locations)
   - `getLandlordIncentives` (live — jurisdiction-scoped curated landlord grants / tax / energy incentives; not tax advice)
8. **Evidence bundle** (`domainTools/evidenceBundle.ts`) — structured findings before synthesis (logged as `ASK_ULO_EVIDENCE_BUNDLE`).
9. **Catch-all work-order fallback** (`domainTools/catchAllFallback.ts`) — when specialty packets miss for `work_order` / `maintenance` / `unit` / `finance` / `other`, format `search_work_orders` hits as a landlord prefer-packet. **Never** portfolio briefing or property ranking. Logs `ASK_ULO_CATCHALL_FALLBACK` + `catchall_fallback:search_work_orders|none`.
10. **Structured incomplete evidence** (`incompleteEvidence.ts`) — ranking lookups emit `canRank` / `missingData[]` / known facts. When `ranking_status` is incomplete, **code** renders the 3-part gap (`formatIncompleteAnswer`). OpenAI is short-circuited for ranking-primary turns — the model never invents a winner and self-censors in the same pass. Logs `ASK_ULO_INCOMPLETE_EVIDENCE` + `prefer_packet:incomplete_*`.

OpenAI still **synthesizes** natural language; Ulo code still owns retrieval, safety, and validation. Tool-calling is **not** used inside `synthesize.ts`.

### Synthesis style (OpenAI path only)

Prefer-packets and structured incomplete answers skip OpenAI — this applies only when `synthesizeWithOpenAI` runs.

1. **Recency** — domain guides stay in the system prompt; `trailingStyleConstraints()` (anti-slop + conversation style) is appended **after** evidence packets in the final user message.
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
| `propertyRankingLookup` | `rank_properties` (property subject only) | gated |
| Ops graph search | `search_operations_graph` | wrap next |
