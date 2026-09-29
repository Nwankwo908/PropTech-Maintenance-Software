-- Resident quiet hours + property IANA timezone for resident-facing send timing.
-- Residents live in public.users; quiet-hour columns are resident-level settings.
-- Precedence at send time: users.timezone > properties.timezone > America/New_York (never UTC).
--
-- Backfill policy: ONLY high-confidence single-zone US states are auto-filled.
-- Multi-zone / missing / malformed states leave properties.timezone NULL so send-time
-- resolution logs the documented default fallback instead of silently gating on a
-- wrong clock. NOT NULL is deferred until manual review of remaining nulls.

-- ---------------------------------------------------------------------------
-- Named defaults (must match DEFAULT_QUIET_HOURS_* in residentSendTiming.ts)
-- ---------------------------------------------------------------------------
-- DEFAULT_QUIET_HOURS_START = 21 (9 PM)
-- DEFAULT_QUIET_HOURS_END   = 8  (8 AM)

alter table public.users
  add column if not exists quiet_hours_start smallint
    check (quiet_hours_start is null or (quiet_hours_start >= 0 and quiet_hours_start <= 23)),
  add column if not exists quiet_hours_end smallint
    check (quiet_hours_end is null or (quiet_hours_end >= 0 and quiet_hours_end <= 23)),
  add column if not exists timezone text;

comment on column public.users.quiet_hours_start is
  'Resident quiet-hours start hour (0–23, local). Null = use DEFAULT_QUIET_HOURS_START (21).';
comment on column public.users.quiet_hours_end is
  'Resident quiet-hours end hour (0–23, local). Null = use DEFAULT_QUIET_HOURS_END (8).';
comment on column public.users.timezone is
  'Optional resident IANA timezone override. Null = use property.timezone.';

alter table public.properties
  add column if not exists timezone text;

comment on column public.properties.timezone is
  'IANA timezone for this property (source of truth for resident-facing send timing). Nullable until remaining manual_review rows are set; null → logged America/New_York fallback at send time.';

-- ---------------------------------------------------------------------------
-- Pass A: high-confidence single-zone states (no ZIP needed).
-- ---------------------------------------------------------------------------
update public.properties p
set timezone = case upper(trim(coalesce(p.state, '')))
  when 'AL' then 'America/Chicago'
  when 'AR' then 'America/Chicago'
  when 'AZ' then 'America/Phoenix'
  when 'CA' then 'America/Los_Angeles'
  when 'CO' then 'America/Denver'
  when 'CT' then 'America/New_York'
  when 'DE' then 'America/New_York'
  when 'DC' then 'America/New_York'
  when 'GA' then 'America/New_York'
  when 'HI' then 'Pacific/Honolulu'
  when 'IA' then 'America/Chicago'
  when 'IL' then 'America/Chicago'
  when 'LA' then 'America/Chicago'
  when 'MA' then 'America/New_York'
  when 'MD' then 'America/New_York'
  when 'ME' then 'America/New_York'
  when 'MN' then 'America/Chicago'
  when 'MS' then 'America/Chicago'
  when 'MO' then 'America/Chicago'
  when 'MT' then 'America/Denver'
  when 'NC' then 'America/New_York'
  when 'NH' then 'America/New_York'
  when 'NJ' then 'America/New_York'
  when 'NM' then 'America/Denver'
  when 'NV' then 'America/Los_Angeles'
  when 'NY' then 'America/New_York'
  when 'OH' then 'America/New_York'
  when 'OK' then 'America/Chicago'
  when 'PA' then 'America/New_York'
  when 'RI' then 'America/New_York'
  when 'SC' then 'America/New_York'
  when 'UT' then 'America/Denver'
  when 'VA' then 'America/New_York'
  when 'VT' then 'America/New_York'
  when 'WA' then 'America/Los_Angeles'
  when 'WI' then 'America/Chicago'
  when 'WV' then 'America/New_York'
  when 'WY' then 'America/Denver'
  else null
end
where p.timezone is null
  and p.state is not null
  and length(trim(p.state)) > 0
  and upper(trim(p.state)) in (
    'AL','AR','AZ','CA','CO','CT','DE','DC','GA','HI','IA','IL','LA',
    'MA','MD','ME','MN','MS','MO','MT','NC','NH','NJ','NM','NV','NY',
    'OH','OK','PA','RI','SC','UT','VA','VT','WA','WI','WV','WY'
  );

update public.properties p
set timezone = case lower(trim(coalesce(p.state, '')))
  when 'alabama' then 'America/Chicago'
  when 'arizona' then 'America/Phoenix'
  when 'arkansas' then 'America/Chicago'
  when 'california' then 'America/Los_Angeles'
  when 'colorado' then 'America/Denver'
  when 'connecticut' then 'America/New_York'
  when 'delaware' then 'America/New_York'
  when 'district of columbia' then 'America/New_York'
  when 'georgia' then 'America/New_York'
  when 'hawaii' then 'Pacific/Honolulu'
  when 'iowa' then 'America/Chicago'
  when 'illinois' then 'America/Chicago'
  when 'louisiana' then 'America/Chicago'
  when 'massachusetts' then 'America/New_York'
  when 'maryland' then 'America/New_York'
  when 'maine' then 'America/New_York'
  when 'minnesota' then 'America/Chicago'
  when 'mississippi' then 'America/Chicago'
  when 'missouri' then 'America/Chicago'
  when 'montana' then 'America/Denver'
  when 'north carolina' then 'America/New_York'
  when 'new hampshire' then 'America/New_York'
  when 'new jersey' then 'America/New_York'
  when 'new mexico' then 'America/Denver'
  when 'nevada' then 'America/Los_Angeles'
  when 'new york' then 'America/New_York'
  when 'ohio' then 'America/New_York'
  when 'oklahoma' then 'America/Chicago'
  when 'pennsylvania' then 'America/New_York'
  when 'rhode island' then 'America/New_York'
  when 'south carolina' then 'America/New_York'
  when 'utah' then 'America/Denver'
  when 'virginia' then 'America/New_York'
  when 'vermont' then 'America/New_York'
  when 'washington' then 'America/Los_Angeles'
  when 'wisconsin' then 'America/Chicago'
  when 'west virginia' then 'America/New_York'
  when 'wyoming' then 'America/Denver'
  else null
end
where p.timezone is null
  and p.state is not null
  and length(trim(p.state)) > 0
  and lower(trim(p.state)) in (
    'alabama','arizona','arkansas','california','colorado','connecticut',
    'delaware','district of columbia','georgia','hawaii','iowa','illinois',
    'louisiana','massachusetts','maryland','maine','minnesota','mississippi',
    'missouri','montana','north carolina','new hampshire','new jersey',
    'new mexico','nevada','new york','ohio','oklahoma','pennsylvania',
    'rhode island','south carolina','utah','virginia','vermont','washington',
    'wisconsin','west virginia','wyoming'
  );

-- ---------------------------------------------------------------------------
-- Pass B: ZIP-prefix resolution inside multi-zone states.
-- Minority ZIP3 islands first; then majority zone for any other valid ZIP.
-- IN / AK have no majority ZIP rule → remain null (manual_review).
-- ---------------------------------------------------------------------------

-- FL: panhandle CT (324/325); all other FL ZIPs → Eastern
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '324' then 'America/Chicago'
  when '325' then 'America/Chicago'
  else 'America/New_York'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('FL', 'FLORIDA')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- OR: Malheur MT (979); all other OR ZIPs → Pacific (Portland-metro inclusive)
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '979' then 'America/Denver'
  else 'America/Los_Angeles'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('OR', 'OREGON')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- ID: northern panhandle Pacific (838); else Mountain/Boise
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '838' then 'America/Los_Angeles'
  else 'America/Boise'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('ID', 'IDAHO')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- TX: El Paso MT (798/799); else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '798' then 'America/Denver'
  when '799' then 'America/Denver'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('TX', 'TEXAS')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- KS west fringe MT; else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '677' then 'America/Denver'
  when '678' then 'America/Denver'
  when '679' then 'America/Denver'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('KS', 'KANSAS')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- ND southwest MT; else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '586' then 'America/Denver'
  when '588' then 'America/Denver'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('ND', 'NORTH DAKOTA')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- NE panhandle MT; else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '693' then 'America/Denver'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('NE', 'NEBRASKA')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- SD west MT (577); else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '577' then 'America/Denver'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('SD', 'SOUTH DAKOTA')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- TN east ET (376–379); else Central
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '376' then 'America/New_York'
  when '377' then 'America/New_York'
  when '378' then 'America/New_York'
  when '379' then 'America/New_York'
  else 'America/Chicago'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('TN', 'TENNESSEE')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- KY western tip CT (420); else Eastern
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '420' then 'America/Chicago'
  else 'America/New_York'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('KY', 'KENTUCKY')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- MI western UP CT fringe (499); else Detroit/Eastern
update public.properties p
set timezone = case left(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g'), 3)
  when '499' then 'America/Chicago'
  else 'America/Detroit'
end
where p.timezone is null
  and upper(trim(coalesce(p.state, ''))) in ('MI', 'MICHIGAN')
  and length(regexp_replace(coalesce(p.zip_code, ''), '\D', '', 'g')) >= 5;

-- Remaining nulls (IN/AK without ZIP rule, missing ZIP, malformed) stay NULL
-- for manual_review — do NOT default to America/New_York; do NOT set NOT NULL yet.
