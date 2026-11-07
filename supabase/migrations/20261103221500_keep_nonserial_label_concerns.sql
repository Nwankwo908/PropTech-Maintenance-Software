-- Serial review must never dismiss another unresolved label/photo concern.
-- A serial review is independent of photo-concern dismissal and check confirmation.
create or replace function public.apply_home_check_serial_review(m jsonb,r jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare q jsonb:=coalesce(m#>'{homeCheck,labelReadability}','{}'); v text:=r->>'value'; chars jsonb;warnings jsonb;needs boolean;
begin
 select coalesce(jsonb_agg(x),'[]') into chars from jsonb_array_elements(coalesce(q->'uncertainCharacters','[]')) x where x->>'field' is distinct from 'serialNumber';
 select coalesce(jsonb_agg(x),'[]') into warnings from jsonb_array_elements(coalesce(q->'formatWarnings','[]')) x where (x#>>'{}') !~* 'serial';
 needs:=(coalesce((q->>'retakeRequested')::boolean,false) and coalesce(q->>'retakeMessage','') !~* 'serial') or coalesce((q->>'modelConfidence')::numeric,0)<85 or jsonb_array_length(chars)>0 or jsonb_array_length(warnings)>0 or coalesce(q->>'retakeMessage','') ~* 'do not match|different equipment';
 q:=q||jsonb_build_object('serialConfidence',case when v is null then 0 else 100 end,'uncertainCharacters',chars,'formatWarnings',warnings,'retakeRequested',needs,'retakeMessage',case when needs and coalesce(q->>'retakeMessage','') ~* 'do not match|different equipment' then q->>'retakeMessage' when needs then 'Other label details still need review.' else null end,'status',case when not needs and v is not null then 'readable' else 'uncertain' end);
 q:=jsonb_set(q,'{readings}',coalesce(q->'readings','{}')||jsonb_build_object('serialNumber',v));
 m:=jsonb_set(m,'{homeCheck,fields,serial}',coalesce(m#>'{homeCheck,fields,serial}','{}')||jsonb_build_object('value',v,'source','landlord','confidence',case when v is null then 'low' else 'high' end,'basis',case when v is null then 'Reviewed and left unknown.' else 'Serial checked against the label photo by the property team.' end));
 m:=jsonb_set(m,'{homeCheck,labelReadability}',q);
 return m||jsonb_build_object('serialNumber',v,'serialReview',r);
end $$;
