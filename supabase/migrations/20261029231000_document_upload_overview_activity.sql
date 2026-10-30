-- Overview rejected document.text_saved. The primary activity log has no
-- event-type allowlist, so the upload note was stored there only.
-- Add the event the document writer already emits.

do $$ declare old_expr text; begin
  select pg_get_expr(conbin, conrelid) into old_expr
  from pg_constraint
  where conrelid = 'public.property_operations_graph'::regclass
    and conname = 'property_operations_graph_event_type_check';
  if old_expr is null then
    raise exception 'Expected property graph event constraint missing';
  end if;
  alter table public.property_operations_graph
    drop constraint property_operations_graph_event_type_check;
  execute 'alter table public.property_operations_graph add constraint property_operations_graph_event_type_check check (('
    || old_expr
    || ') or event_type = ''document.text_saved'')';
end $$;
