-- Testes da migration 008 (correções da revisão independente).
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação desfeita no final.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a8000000-0000-0000-0000-000000000001', 'rv.admin.a@teste.local', '{"full_name":"Rita Admin"}'),
  ('a8000000-0000-0000-0000-000000000002', 'rv.adv.a@teste.local',   '{"full_name":"Rui Advogado"}');

-- ---------------------------------------------------------------------------
-- 1. Anonimização remove o nome do cliente também de activity_logs
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_cat uuid; v_d uuid; v_t uuid; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001"}', true);
  v_a := public.create_organization('Escritório Revisão');
  insert into organization_members (organization_id, user_id, role)
  values (v_a, 'a8000000-0000-0000-0000-000000000002', 'advogado');

  insert into clients (id, organization_id, full_name)
  values ('c8000000-0000-0000-0000-00000000000a', v_a, 'Mariazinha Souza');
  select id into v_cat from demand_categories where organization_id = v_a order by sort_order limit 1;

  insert into demands (organization_id, client_id, category_id, title)
  values (v_a, 'c8000000-0000-0000-0000-00000000000a', v_cat, 'SM Mariazinha Souza') returning id into v_d;
  update demands set title = 'SM Mariazinha Souza - urgente', priority = 'alta' where id = v_d;
  insert into tasks (organization_id, demand_id, title) values (v_a, v_d, 'Ligar para Mariazinha') returning id into v_t;
  update tasks set title = 'Ligar para Mariazinha Souza' where id = v_t;

  select count(*) into n from activity_logs where organization_id = v_a and changes::text ilike '%mariazinha%';
  if n < 2 then raise exception 'pré-condição: esperava logs com o título original (achou %)', n; end if;

  -- advogado não anonimiza
  perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000002"}', true);
  set local role authenticated;
  begin
    perform public.anonymize_client('c8000000-0000-0000-0000-00000000000a');
    raise exception 'advogado não deveria anonimizar';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001"}', true);
  set local role authenticated;
  perform public.anonymize_client('c8000000-0000-0000-0000-00000000000a');
  reset role;

  select count(*) into n from activity_logs where organization_id = v_a and changes::text ilike '%mariazinha%';
  if n <> 0 then raise exception 'activity_logs ainda contém o nome do cliente anonimizado (% registros)', n; end if;

  -- outros campos seguros continuam no log (prioridade)
  select count(*) into n from activity_logs
   where organization_id = v_a and entity_type = 'demands' and entity_id = v_d
     and changes->'priority'->>'to' = 'alta';
  if n <> 1 then raise exception 'anonimização não deveria apagar outros campos do histórico'; end if;

  -- título marcado como alterado, sem valores
  select count(*) into n from activity_logs
   where entity_type = 'demands' and entity_id = v_d and changes->'title' = '{"changed": true}'::jsonb;
  if n < 1 then raise exception 'título deveria permanecer marcado como alterado'; end if;

  if (select title from demands where id = v_d) ilike '%mariazinha%' then
    raise exception 'título da demanda ainda contém o nome';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. anon sem EXECUTE em log_export / anonymize_client
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.log_export(uuid, text, int, boolean, uuid)', 'execute') then
    raise exception 'anon não deveria executar log_export';
  end if;
  if has_function_privilege('anon', 'public.anonymize_client(uuid)', 'execute') then
    raise exception 'anon não deveria executar anonymize_client';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Invariantes gerais: toda tabela de public com RLS; toda função
--    SECURITY DEFINER de public com search_path fixo; views com security_invoker.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'tabela public.% sem RLS', r.relname;
  end loop;
  for r in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    raise exception 'função SECURITY DEFINER public.% sem search_path', r.proname;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v'
              and not coalesce(c.reloptions @> array['security_invoker=true'], false) loop
    raise exception 'view public.% sem security_invoker', r.relname;
  end loop;
end $$;

rollback;
\echo '✔ review_test: ok'
