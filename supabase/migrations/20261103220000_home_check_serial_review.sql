-- A serial review is independent of photo-concern dismissal and check confirmation.
create function public.apply_home_check_serial_review(m jsonb,r jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare q jsonb:=coalesce(m#>'{homeCheck,labelReadability}','{}'); v text:=r->>'value'; chars jsonb;warnings jsonb;needs boolean;
begin
 select coalesce(jsonb_agg(x),'[]') into chars from jsonb_array_elements(coalesce(q->'uncertainCharacters','[]')) x where x->>'field' is distinct from 'serialNumber';
 select coalesce(jsonb_agg(x),'[]') into warnings from jsonb_array_elements(coalesce(q->'formatWarnings','[]')) x where (x#>>'{}') !~* 'serial';
 needs:=coalesce((q->>'modelConfidence')::numeric,0)<85 or jsonb_array_length(chars)>0 or jsonb_array_length(warnings)>0 or coalesce(q->>'retakeMessage','') ~* 'do not match|different equipment';
 q:=q||jsonb_build_object('serialConfidence',case when v is null then 0 else 100 end,'uncertainCharacters',chars,'formatWarnings',warnings,'retakeRequested',needs,'retakeMessage',case when needs and coalesce(q->>'retakeMessage','') ~* 'do not match|different equipment' then q->>'retakeMessage' when needs then 'Other label details still need review.' else null end,'status',case when not needs and v is not null then 'readable' else 'uncertain' end);
 q:=jsonb_set(q,'{readings}',coalesce(q->'readings','{}')||jsonb_build_object('serialNumber',v));
 m:=jsonb_set(m,'{homeCheck,fields,serial}',coalesce(m#>'{homeCheck,fields,serial}','{}')||jsonb_build_object('value',v,'source','landlord','confidence',case when v is null then 'low' else 'high' end,'basis',case when v is null then 'Reviewed and left unknown.' else 'Serial checked against the label photo by the property team.' end));
 m:=jsonb_set(m,'{homeCheck,labelReadability}',q);
 return m||jsonb_build_object('serialNumber',v,'serialReview',r);
end $$;
revoke all on function public.apply_home_check_serial_review(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_home_check_serial_review(jsonb,jsonb) to service_role;

create function public.save_home_check_serial_review(p_landlord_id uuid,p_property_id uuid,p_check_id uuid,p_asset_id uuid,p_photo_id uuid,p_serial text,p_unknown boolean,p_actor_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare c public.home_checks;a public.unit_assets;r jsonb;v text:=nullif(trim(p_serial),'');
begin
 select * into c from public.home_checks where id=p_check_id and landlord_id=p_landlord_id and property_id=p_property_id for update;
 if not found or c.confirmed_at is not null or c.status not in ('collecting','completed') then raise exception 'This Home Check cannot be edited.' using errcode='42501';end if;
 select * into a from public.unit_assets where id=p_asset_id and landlord_id=c.landlord_id and home_check_id=c.id and property_id=c.property_id for update;
 if not found or p_actor_id is null or p_unknown is null then raise exception 'Serial review scope mismatch' using errcode='42501';end if;
 if not exists(select 1 from public.home_check_photos h where h.check_id=c.id and h.inspection_photo_id=p_photo_id and h.slot=case when a.home_check_system='water_heater' then 'water_heater_label' else 'heating_label' end)
 or a.metadata#>>'{homeCheck,fields,serial,photoIds,0}' is distinct from p_photo_id::text then raise exception 'The label photo changed. Reopen the review.';end if;
 if p_unknown then v:=null;elsif v is null or length(v)>80 or v ~ '[?\[\]{}\n\r/]' then raise exception 'Enter only the serial number visible on the label.';end if;
 r:=jsonb_build_object('photoId',p_photo_id,'value',v,'decision',case when p_unknown then 'unknown' else 'reviewed' end,'reviewedBy',p_actor_id,'reviewedAt',now());
 update public.unit_assets set metadata=public.apply_home_check_serial_review(metadata,r),updated_at=now() where id=a.id;
 update public.home_checks set labels_readable=(select count(*)=2 and bool_and(nullif(metadata#>>'{homeCheck,fields,make,value}','') is not null and nullif(metadata#>>'{homeCheck,fields,model,value}','') is not null and nullif(metadata#>>'{homeCheck,fields,serial,value}','') is not null) from public.unit_assets where home_check_id=c.id) where id=c.id;
 insert into public.home_check_events(check_id,event_type,role,metadata) values(c.id,'serial_reviewed',c.role,jsonb_build_object('asset_id',a.id,'photo_id',p_photo_id,'decision',r->>'decision','actor_id',p_actor_id));
end $$;
revoke all on function public.save_home_check_serial_review(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_home_check_serial_review(uuid,uuid,uuid,uuid,uuid,text,boolean,uuid) to service_role;

-- Reanalysis of the SAME label must not silently overwrite a human review.
-- A replacement label invalidates the old review rather than copying its serial.
create function public.preserve_home_check_serial_review() returns trigger language plpgsql security invoker set search_path=public as $$
declare r jsonb:=old.metadata->'serialReview';
begin
 if new.home_check_id is not null and new.home_check_id=old.home_check_id and new.landlord_id=old.landlord_id and new.property_id is not distinct from old.property_id and new.metadata->'serialReview' is null and r is not null
 and r->>'photoId'=new.metadata#>>'{homeCheck,fields,serial,photoIds,0}' then
  new.metadata:=public.apply_home_check_serial_review(new.metadata,r);
 end if;
 return new;
end $$;
revoke all on function public.preserve_home_check_serial_review() from public,anon,authenticated;
create trigger preserve_home_check_serial_review before update on public.unit_assets for each row execute function public.preserve_home_check_serial_review();
