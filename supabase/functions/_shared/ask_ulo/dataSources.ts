/**
 * Domain → source mapping for Ask Ulo retrieval.
 *
 * Legal chunks live only in `legal_rag_chunks` (pgvector). Ops never go there.
 * Numeric compliance values live only in `compliance_structured_facts`.
 * Live portfolio attention always comes from ops graph / portfolio tables.
 *
 * Legal trust order (answers):
 * 1. Official law — statutes, regs, courts, city/county/building codes on .gov / legislature / clerk
 * 2. Agency guidance — HUD, EPA, Census, housing-authority handbooks & FAQs
 * 3. Aggregators / mirrors (CourtListener, Municode, Justia, etc.) — discovery only;
 *    find faster, then confirm on the official government or court source before answering
 * Never: blogs, opinion, unofficial legal summaries
 *
 * Retrieval (hybrid every legal question when both paths return hits):
 * - Pre-filter by document passport (type, publisher, authority, geo, housing program,
 *   citation/currency/version lineage) before search
 * - Semantic: pgvector HNSW + match_legal_rag_chunks (text-embedding-3-small)
 * - Keyword: Postgres FTS (search_vector + match_legal_rag_chunks_fts) with landlord→statute
 *   synonym expansion; token fallback if FTS RPC unavailable
 * - Fuse with Reciprocal Rank Fusion (RRF) so exact citations and meaning both contribute
 *
 * Document passport (digital ID card on every legal_rag_chunks row):
 * - document_type, publisher_name/kind, normative_type, authority_tier
 * - country / state / county / city, housing_program, source_citation + source_url
 * - effective_on, last_updated_on, replaces_chunk_id
 * - refresh_cadence / source_checked_at / next_check_at (tied to ask_ulo_source_feeds)
 * - Court extras: court_system, case_number, holding_summary
 * - Equipment-manual extras: manufacturer, equipment_model/type, manual_version
 *
 * Source freshness (ask_ulo_source_feeds + refresh-ask-ulo-sources cron):
 * - Federal & state law, court opinions, council/clerk announcements → daily
 * - Published city/county codes → weekly
 * - HUD FMR / income limits → on HUD’s official release schedule (API when available)
 * - Equipment manuals → on manufacturer release only
 * - Prefer official .gov / HUD hosts; aggregators are refused for refresh
 *
 * Answer quality gate (before showing any answer — answerQualityGate.ts):
 * 1. Location — address / portfolio / question → city, county, state
 * 2. Topic — legal, maintenance, finance, market, … → matching tools only
 * 3. Scope — pre-filter corpus (geo + housing program + passport) before search
 * 4. Sources — official over third-party; recent over stale; on-point over loose
 * 5. Grounding — important claims need official backing; never invent as fact
 * Extra: lightweight safety QC on the draft (does not replace official sources)
 *
 * Fair Housing / AI screening safety (fairHousingSafety.ts):
 * - Never recommend approve/deny on protected characteristics or proxies (ZIP, name/accent, kids stereotypes, etc.)
 * - Never invent pretextual denial reasons
 * - Hard-block discriminatory requests; soft-refuse other approve/deny asks (explain rules only)
 * - Lawful discussion limited to written, consistently applied documented criteria + company policy/counsel
 * - Aligns with HUD FHEO guidance that automated screening can still violate the FHA
 *
 * Sensitive situations → human handoff (legalSensitiveTopics + humanDecisionSafety):
 * - Disability accommodations / ESA, domestic violence, retaliation, lockouts/utility shutoffs,
 *   lead/mold/asbestos, criminal screening, eviction process — explain rules, don’t decide
 * - Soft-refuse accommodation grants, eviction strategy, DV/retaliation responses
 *
 * Legal attribution (legalAnswerAttribution.ts): every legal answer should state location,
 * source authority (law vs guidance), and currency when known
 *
 * Privacy (privacyRedact.ts): redact email/phone/SSN/credit scores before external LLM;
 * screening questions isolate ops-graph packets from synthesis
 *
 * Retrieval reuse (retrievalCache.ts + ask_ulo_retrieval_cache):
 * - Key = intent + topic bucket + jurisdiction + normalized question + source freshness token
 * - Freshness from ask_ulo_source_feeds fingerprints — unchanged feeds → cache hit
 * - On hit: skip embedding + hybrid RAG + structured re-fetch (still synthesize with live property/ops)
 * - Does not cache final LLM answers; 14-day TTL safety net
 *
 * Continuous evaluation (ask_ulo_evals + faithfulnessCheck + ask_ulo.feedback):
 * - Per answer: location/topic/scope/sources/grounding status, refuse/clarify/counsel flags
 * - Faithfulness score (rule-based hard claims vs retrieved citations)
 * - Latency + token usage + estimated $ cost; retrieval_cache_hit
 * - Human thumbs + override reasons (wrong_location, bad_citation, unsupported_claim, …)
 * - Counsel handoff stamps counsel_handoff_at; daily rollup via ask_ulo_eval_daily view
 * - Graph events: ask_ulo.answered (eval_id + metrics) and ask_ulo.feedback
 *
 * Executive briefing (executive_briefing intent + portfolioBriefingLookup):
 * - Broad prompts ("how healthy is my portfolio", "catch me up", "what did I miss") →
 *   full ops briefing: Overall Assessment, What's Going Well, What Needs Attention,
 *   Recommended Next Steps, What Ulo Handled
 * - Narrow factual ("how many open work orders") → short Quick Answer
 * - Briefing packet synthesizes health score, occupancy, open/critical/aging WOs,
 *   recurring hotspots, escalated/awaiting workflows, recent Ulo graph actions
 * - Never invent scores; unavailable signals stated explicitly
 *
 * Period summary (period_summary + periodSummaryLookup):
 * - "summary of everything this week" → activity diary (maintenance, vendors, rent/leasing)
 * - Never answer with only current open-ticket count
 *
 * Dynamic response (dynamicResponse.ts):
 * - Choose format from the request; do not force Why I reached / Confidence / Next Steps
 *
 * Property priority (property_priority + propertyRankingLookup + reasoningMode):
 * - Comparison / ranking / diagnosis / recommendation never fall to General filler
 * - Ranks buildings on severity-first signals; incomplete property-level data → say what's missing
 * - Never answer ranking questions with only a portfolio-wide ticket total
 *
 * Unit maintenance ranking (unit_maintenance_ranking + unitMaintenanceRankingLookup):
 * - Entity=unit, metric=maintenance-request count; group by unit_id; top 3–5
 * - Disclose timeframe (user-stated or default 60 days); distinguish total / recent / open
 * - If unit_id linkage missing: say so — never fabricate a unit ranking
 *
 * Reasoning transparency (reasoningTransparency.ts):
 * - Analytical answers include ## Why I reached this conclusion + ## Confidence
 * - Plain-English evidence only — never expose graphs, packets, retrieval, filters
 * - Recommendations follow findings; "no action needed" when nothing justifies work
 * - Confidence High/Medium/Low reflects data completeness, not model certainty
 *
 * v1 seed footprint (Oregon / Portland metro demo):
 * - Federal: FHA, HCV/Section 8, FMR orientation, lead disclosure, HQS/NSPIRE
 * - State OR: ORS ch. 90 notices, deposits, late fees, habitability, entry, utilities, alarms
 * - Local: Portland Title 29/30, Multnomah context, Home Forward + Washington County HA notes
 * - Structured: notice/deposit/late-fee caps, FMR demo figures, lead + habitability flags
 * - Currency fields: effective_on / repealed_on / publication_status (pending ordinances)
 *
 * Still roadmap (do not mix into legal vectors):
 * - National multi-state statute ingest; full re-chunk when a feed probe reports “changed”
 * - Live HUD USER FMR API write-back into compliance_structured_facts
 * - Full historical statute versions (“what applied on date X”) beyond effective/repealed filters
 * - Full PHA form libraries; ICC IPMC licensed text beyond orientation excerpts
 * - Ops: always via ops_graph_lookup against live graph / portfolio tables
 */

export type AskUloSourceFamily =
  | "state_statute"
  | "municipal_code"
  | "federal_hud_fha"
  | "icc_ipmc"
  | "state_finance"
  | "market_orientation"
  | "ops_graph"
  | "structured_compliance"

export const ASK_ULO_DATA_SOURCE_NOTES = {
  legal:
    "five-check quality gate (location → topic → scope → sources → grounding + safety QC) then " +
    "Fair Housing screening guard (block protected-trait/proxy decisions; refuse approve/deny; " +
    "lawful documented criteria + company policy/counsel only); " +
    "sensitive-situation handoff (DV, retaliation, accommodations, self-help, lead/mold, eviction); " +
    "PII redact before external LLM + screening ops isolation; legal attribution footer; " +
    "retrieval reuse (jurisdiction+topic+source-freshness cache skips re-embed/RAG); then " +
    "hybrid RAG with document-passport pre-filter (geo/program/type/authority) then " +
    "pgvector semantic + FTS keyword (RRF fuse) over legal_rag_chunks; " +
    "continuous eval (ask_ulo_evals: quality gate, faithfulness, latency/cost, human override); " +
    "official source feeds refresh on cadence (daily federal/state/court/clerk; weekly city code; " +
    "HUD on publisher schedule; manuals on manufacturer release); " +
    "prefer official statutes/codes/courts on .gov (verify before answering); " +
    "CourtListener/Municode/etc. are discovery-only; " +
    "apply via property_snapshot + lease/ops dossier so answers differ by portfolio; " +
    "OR/Portland metro v1 seeds cover notices, habitability, Section 8, lead, local codes",
  maintenance: "ICC IPMC + Portland Title 29 orientation → legal_rag_chunks domain building_code",
  finance:
    "HUD FMR demo facts in compliance_structured_facts; FRED / ACS / FHFA later as structured indexes",
  market:
    "live comps / rent AVM → RentCast or Zillow RapidAPI when keyed; else public Zillow Research ZORI (ZIP/city/metro); " +
    "portfolio snapshot personalizes location/occupancy",
  ops: "executive briefing for broad portfolio prompts (health, workflows, occupancy, Ulo actions); " +
    "narrow factual ops stay Quick Answer; operations_graph + tickets/workflows via ops_graph_lookup",
} as const
