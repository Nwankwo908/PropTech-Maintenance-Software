-- Ask Ulo v1 trusted sources: deepen Oregon / Portland-metro coverage for the
-- landlord questions Ulo must answer (notices, habitability, Section 8 / FMR,
-- local duties, EPA lead, building safety). Demo-labeled; not live PACER/GovInfo.

-- ---------------------------------------------------------------------------
-- Legal RAG — federal HUD / EPA / HCV
-- ---------------------------------------------------------------------------
insert into public.legal_rag_chunks (
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
select * from (values
(
  'federal'::text, 'US'::text, null::text, null::text, null::text, null::text,
  'fair_housing'::text,
  'HUD — Housing Choice Voucher (Section 8) program overview'::text,
  '24 C.F.R. Part 982 / HUD HCV'::text,
  'https://www.hud.gov/program_offices/public_indian_housing/programs/hcv'::text,
  'The Housing Choice Voucher (Section 8) program helps eligible families afford private-market rent. Landlords who participate execute a Housing Assistance Payment (HAP) contract with the public housing agency (PHA). Rent reasonableness, Housing Quality Standards (HQS) / NSPIRE inspections, and owner obligations apply in addition to state landlord-tenant law. Payment standards are set by the PHA using HUD Fair Market Rents as a baseline — confirm the current PHA payment standard for the unit bedroom size and ZIP before quoting rent to a voucher holder.'::text,
  '{"source_family":"federal_hud_fha","demo":true,"hierarchy_priority":4}'::jsonb,
  null::text, 'section_8_hcv'::text, null::text,
  'guidance'::text, 'agency_guidance'::text, '2024-01-01'::date
),
(
  'federal', 'US', null, null, null, null,
  'fair_housing',
  'HUD — Fair Market Rents (FMR) orientation',
  'HUD USER Fair Market Rents',
  'https://www.huduser.gov/portal/datasets/fmr.html',
  'HUD publishes Fair Market Rents annually by metropolitan area and bedroom count. PHAs use FMRs (and may set payment standards within allowed percentages of FMR) to cap housing assistance. Operators should look up the current FMR for their MSA and bedroom size on HUD USER, then confirm the local PHA payment standard — FMR alone is not always the HAP rent limit.',
  '{"source_family":"federal_hud_fha","demo":true,"hierarchy_priority":7}'::jsonb,
  null, 'section_8_hcv', null,
  'guidance', 'agency_guidance', '2024-10-01'
),
(
  'federal', 'US', null, null, null, null,
  'fair_housing',
  'EPA / HUD — lead-based paint disclosure (pre-1978 housing)',
  '42 U.S.C. § 4852d; 40 C.F.R. Part 745',
  'https://www.epa.gov/lead/real-estate-disclosure',
  'Federal law requires landlords of most pre-1978 housing to disclose known lead-based paint and lead-based paint hazards, provide the EPA pamphlet Protect Your Family From Lead in Your Home, and include lead disclosure language in leases. Renovation, Repair, and Painting (RRP) work may require certified contractors. This is a national requirement — state and local rules may add duties. Escalate lead and environmental questions for counsel when liability or child exposure is at issue.',
  '{"source_family":"federal_hud_fha","demo":true,"hierarchy_priority":1}'::jsonb,
  null, null, null,
  'requirement', 'published_code', '1996-12-06'
),
(
  'federal', 'US', null, null, null, null,
  'building_code',
  'HUD Housing Quality Standards / NSPIRE — safety orientation',
  'HUD HQS / NSPIRE',
  'https://www.hud.gov/program_offices/public_indian_housing/reac/nspire',
  'Units assisted under HCV must meet HUD Housing Quality Standards or the successor NSPIRE inspection protocol. Life-safety items (smoke detectors, carbon monoxide where required, sanitary facilities, heat, electrical, structural soundness) are commonly cited. Local codes and state habitability statutes still apply to all rentals; HCV adds a parallel inspection gate before HAP payments begin or continue.',
  '{"source_family":"federal_hud_fha","demo":true,"hierarchy_priority":5}'::jsonb,
  null, 'section_8_hcv', null,
  'guidance', 'agency_guidance', '2024-01-01'
)
) as v(
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
where not exists (
  select 1 from public.legal_rag_chunks c
  where c.source_citation = v.source_citation
    and coalesce(c.state_code, '') = coalesce(v.state_code, '')
    and coalesce(c.city_slug, '') = coalesce(v.city_slug, '')
);

-- ---------------------------------------------------------------------------
-- Legal RAG — Oregon state duties (notices, habitability, utilities)
-- ---------------------------------------------------------------------------
insert into public.legal_rag_chunks (
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
select * from (values
(
  'state'::text, 'US'::text, 'OR'::text, null::text, null::text, null::text,
  'landlord_tenant'::text,
  'Oregon — essential services and utility shutoff limits'::text,
  'ORS 90.320 / ORS 90.730 context'::text,
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html'::text,
  'Oregon landlords generally must keep essential services (heat, water, electricity as applicable) available. Deliberately shutting off utilities to force a tenant out can violate landlord-tenant law and may expose the landlord to damages. Use lawful notice and court process for possession — never self-help utility shutoffs.'::text,
  '{"source_family":"state_statute","demo":true,"hierarchy_priority":1}'::jsonb,
  'Oregon Circuit Court'::text, null::text, null::text,
  'requirement'::text, 'published_code'::text, '2024-01-01'::date
),
(
  'state', 'US', 'OR', null, null, null,
  'landlord_tenant',
  'Oregon — smoke alarm and carbon monoxide safety',
  'ORS 90.320 / ORS 479.250 et seq. context',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  'Oregon habitability and fire-safety frameworks require working smoke alarms (and carbon monoxide alarms where applicable) in rental dwellings. Landlords should confirm installation, testing, and replacement duties under current ORS and local fire code before lease-up or renewal. Local city codes may add inspection or documentation requirements.',
  '{"source_family":"state_statute","demo":true,"hierarchy_priority":5}'::jsonb,
  'Oregon Circuit Court', null, null,
  'requirement', 'published_code', '2024-01-01'
),
(
  'state', 'US', 'OR', null, null, null,
  'landlord_tenant',
  'Oregon courts — applying ORS chapter 90 (orientation)',
  'Oregon Circuit / appellate practice note',
  'https://www.courts.oregon.gov/',
  'Oregon Residential Landlord and Tenant Act disputes are heard primarily in Oregon Circuit Court. Appellate opinions interpret notice, habitability, and fee provisions in ORS chapter 90. Aggregator sites (CourtListener, Justia) can help discover cases but are not the official reporter — cite the Oregon courts / legislature text when advising operators. Escalate contested eviction or discrimination matters to counsel.',
  '{"source_family":"court_decisions","demo":true,"hierarchy_priority":2}'::jsonb,
  'Oregon Circuit Court', null, null,
  'guidance', 'agency_guidance', '2024-01-01'
)
) as v(
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
where not exists (
  select 1 from public.legal_rag_chunks c
  where c.source_citation = v.source_citation
    and c.source_title = v.source_title
    and coalesce(c.state_code, '') = coalesce(v.state_code, '')
);

-- ---------------------------------------------------------------------------
-- Legal RAG — city / county / local PHA (Portland metro demo portfolio)
-- ---------------------------------------------------------------------------
insert into public.legal_rag_chunks (
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
select * from (values
(
  'city'::text, 'US'::text, 'OR'::text, 'multnomah'::text, 'Multnomah'::text, 'portland'::text,
  'building_code'::text,
  'Portland — property maintenance / housing code orientation'::text,
  'Portland City Code Title 29 (Property Maintenance)'::text,
  'https://www.portland.gov/code/29'::text,
  'Portland enforces property maintenance and housing standards that address unsafe structures, sanitation, and habitability-related conditions. Operators should treat city housing/property maintenance code as additional local duties on top of ORS 90.320. Confirm current Title 29 requirements and any Portland Housing Bureau rental registration rules before responding to repair disputes.'::text,
  '{"source_family":"municipal_code","demo":true,"hierarchy_priority":3}'::jsonb,
  'Oregon Circuit Court (Multnomah County)'::text, null::text,
  'Portland City Code Title 29'::text,
  'requirement'::text, 'published_code'::text, '2024-01-01'::date
),
(
  'city', 'US', 'OR', 'multnomah', 'Multnomah', 'portland',
  'fair_housing',
  'Home Forward (Portland / Multnomah) — HCV landlord participation',
  'Home Forward HCV landlord info',
  'https://www.homeforward.org/',
  'Home Forward administers Housing Choice Vouchers in much of the Portland / Multnomah area. Participating owners must pass inspections, execute HAP contracts, and follow PHA payment standards and owner briefing rules. Payment standards and utility allowances change — look up the current Home Forward schedule for bedroom size and ZIP; do not rely on outdated demo figures alone when setting asking rent for voucher holders.',
  '{"source_family":"housing_authority","demo":true,"hierarchy_priority":4}'::jsonb,
  'Oregon Circuit Court (Multnomah County)', 'section_8_hcv', null,
  'guidance', 'agency_guidance', '2024-01-01'
),
(
  'city', 'US', 'OR', 'washington', 'Washington', 'hillsboro',
  'fair_housing',
  'Washington County / Hillsboro — HCV and local rental orientation',
  'Washington County Housing Authority / Hillsboro rental context',
  'https://www.washingtoncountyor.gov/',
  'Hillsboro and Washington County properties (e.g. Maple Heights demo) may fall under Washington County Housing Authority voucher administration rather than Home Forward. Section 8 payment standards, inspection protocols, and owner obligations follow the administering PHA. Confirm which agency holds the voucher before quoting rent or scheduling an HQS/NSPIRE inspection.',
  '{"source_family":"housing_authority","demo":true,"hierarchy_priority":4}'::jsonb,
  'Oregon Circuit Court (Washington County)', 'section_8_hcv', null,
  'guidance', 'agency_guidance', '2024-01-01'
),
(
  'county', 'US', 'OR', 'multnomah', 'Multnomah', null,
  'landlord_tenant',
  'Multnomah County — local rental / housing program context',
  'Multnomah County housing programs (orientation)',
  'https://www.multco.us/',
  'Multnomah County partners with cities and PHAs on housing stability programs. County-level rules rarely replace ORS chapter 90, but operators should watch county and city rental protections that stack on state law. For Portland addresses, apply Portland City Code plus ORS; for unincorporated Multnomah, confirm county and state duties.',
  '{"source_family":"municipal_code","demo":true,"hierarchy_priority":3}'::jsonb,
  'Oregon Circuit Court (Multnomah County)', null, null,
  'guidance', 'agency_guidance', '2024-01-01'
)
) as v(
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  domain, source_title, source_citation, source_url, chunk_text, metadata,
  court_system, housing_program, code_set, normative_type, publication_status, effective_on
)
where not exists (
  select 1 from public.legal_rag_chunks c
  where c.source_citation = v.source_citation
    and coalesce(c.city_slug, '') = coalesce(v.city_slug, '')
    and coalesce(c.county_slug, '') = coalesce(v.county_slug, '')
);

-- ---------------------------------------------------------------------------
-- Structured facts — FMR / payment standards, lead, habitability (deterministic)
-- Demo FY-style numbers for Portland-Vancouver-Hillsboro MSA orientation only.
-- ---------------------------------------------------------------------------
insert into public.compliance_structured_facts (
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  fact_key, value_numeric, value_text, unit, source_citation, source_url,
  effective_on, housing_program, normative_type, publication_status, metadata
)
select * from (values
(
  'city'::text, 'US'::text, 'OR'::text, 'multnomah'::text, 'Multnomah'::text, 'portland'::text,
  'hud_fmr_0br'::text, 1400::numeric,
  'Demo FY orientation for Portland metro efficiency FMR — verify current HUD USER / PHA schedule before quoting.'::text,
  'usd_per_month'::text, 'HUD USER FMR (demo)'::text,
  'https://www.huduser.gov/portal/datasets/fmr.html'::text,
  '2024-10-01'::date, 'section_8_hcv'::text, 'guidance'::text, 'agency_guidance'::text,
  '{"source_family":"financial_data","demo":true,"msa":"Portland-Vancouver-Hillsboro"}'::jsonb
),
(
  'city', 'US', 'OR', 'multnomah', 'Multnomah', 'portland',
  'hud_fmr_1br', 1550,
  'Demo FY orientation for Portland metro 1-BR FMR — verify current HUD USER / PHA schedule before quoting.',
  'usd_per_month', 'HUD USER FMR (demo)',
  'https://www.huduser.gov/portal/datasets/fmr.html',
  '2024-10-01', 'section_8_hcv', 'guidance', 'agency_guidance',
  '{"source_family":"financial_data","demo":true,"msa":"Portland-Vancouver-Hillsboro"}'::jsonb
),
(
  'city', 'US', 'OR', 'multnomah', 'Multnomah', 'portland',
  'hud_fmr_2br', 1850,
  'Demo FY orientation for Portland metro 2-BR FMR — PHA payment standards may be set within allowed % of FMR.',
  'usd_per_month', 'HUD USER FMR (demo)',
  'https://www.huduser.gov/portal/datasets/fmr.html',
  '2024-10-01', 'section_8_hcv', 'guidance', 'agency_guidance',
  '{"source_family":"financial_data","demo":true,"msa":"Portland-Vancouver-Hillsboro"}'::jsonb
),
(
  'city', 'US', 'OR', 'multnomah', 'Multnomah', 'portland',
  'hud_fmr_3br', 2600,
  'Demo FY orientation for Portland metro 3-BR FMR — verify current HUD USER / PHA schedule before quoting.',
  'usd_per_month', 'HUD USER FMR (demo)',
  'https://www.huduser.gov/portal/datasets/fmr.html',
  '2024-10-01', 'section_8_hcv', 'guidance', 'agency_guidance',
  '{"source_family":"financial_data","demo":true,"msa":"Portland-Vancouver-Hillsboro"}'::jsonb
),
(
  'city', 'US', 'OR', 'multnomah', 'Multnomah', 'portland',
  'section_8_payment_standard_note', null,
  'Home Forward (and other metro PHAs) publish payment standards by bedroom and sometimes by ZIP. Use the administering PHA schedule — not FMR alone — when answering “What are the payment standards for Section 8?”',
  null, 'PHA payment standards (demo note)',
  'https://www.homeforward.org/',
  '2024-10-01', 'section_8_hcv', 'guidance', 'agency_guidance',
  '{"source_family":"housing_authority","demo":true}'::jsonb
),
(
  'city', 'US', 'OR', 'washington', 'Washington', 'hillsboro',
  'hud_fmr_2br', 1850,
  'Demo: Hillsboro shares the Portland-Vancouver-Hillsboro MSA FMR orientation; confirm Washington County HA payment standard for the voucher.',
  'usd_per_month', 'HUD USER FMR (demo)',
  'https://www.huduser.gov/portal/datasets/fmr.html',
  '2024-10-01', 'section_8_hcv', 'guidance', 'agency_guidance',
  '{"source_family":"financial_data","demo":true,"msa":"Portland-Vancouver-Hillsboro"}'::jsonb
),
(
  'federal', 'US', null, null, null, null,
  'lead_paint_pre1978_disclosure', 1,
  'Required for most pre-1978 target housing: disclose known lead hazards, give EPA pamphlet, use disclosure form in lease.',
  'required_flag', '42 U.S.C. § 4852d; 40 C.F.R. Part 745',
  'https://www.epa.gov/lead/real-estate-disclosure',
  '1996-12-06', null, 'requirement', 'published_code',
  '{"source_family":"laws_regulations","demo":true}'::jsonb
),
(
  'state', 'US', 'OR', null, null, null,
  'habitability_required', 1,
  'Oregon landlords must maintain habitable conditions under ORS 90.320 (plumbing, heat, weatherproofing, sanitation, required alarms).',
  'required_flag', 'ORS 90.320',
  'https://www.oregonlegislature.gov/bills_laws/ors/ors090.html',
  '2024-01-01', null, 'requirement', 'published_code',
  '{"source_family":"state_statute","demo":true}'::jsonb
)
) as v(
  jurisdiction_level, country_code, state_code, county_slug, county_label, city_slug,
  fact_key, value_numeric, value_text, unit, source_citation, source_url,
  effective_on, housing_program, normative_type, publication_status, metadata
)
where not exists (
  select 1 from public.compliance_structured_facts f
  where f.fact_key = v.fact_key
    and coalesce(upper(f.state_code), '') = coalesce(upper(v.state_code), '')
    and coalesce(lower(f.city_slug), '') = coalesce(lower(v.city_slug), '')
);
