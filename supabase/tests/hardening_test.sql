-- =============================================================================
-- JurisFlow AI — Testes da migration 010 (endurecimento pós-auditoria red team)
-- Cada bloco reproduz um ataque CONFIRMADO do relatório e exige que falhe.
-- Tudo numa transação desfeita no final. Falha → raise exception 'FALHOU: ...'.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
set local timezone = 'America/Sao_Paulo';

create schema th;
create function th.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  if current_user <> 'authenticated' then perform set_config('role', 'authenticated', true); end if;
end $$;
-- Executa e exige erro; devolve a mensagem.
create function th.expect_error(q text, label text, states text[] default null) returns text language plpgsql as $$
declare st text; msg text;
begin
  begin execute q; exception when others then st := sqlstate; msg := sqlerrm; end;
  if st is null then raise exception 'FALHOU: % — deveria ser recusado, mas foi aceito', label; end if;
  if states is not null and not st = any(states) then
    raise exception 'FALHOU: % — esperava % e veio % (%)', label, states, st, msg;
  end if;
  return msg;
end $$;
grant usage on schema th to authenticated, anon;
grant execute on all functions in schema th to authenticated, anon;

-- Usuários
insert into auth.users(id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'h.admin@a.test'),
  ('e0000000-0000-0000-0000-000000000002', 'h.adv@a.test'),
  ('e0000000-0000-0000-0000-000000000003', 'h.asst@a.test'),
  ('e0000000-0000-0000-0000-000000000004', 'h.badmin@b.test'),
  ('e0000000-0000-0000-0000-000000000005', 'h.vitima@v.test');
insert into auth.users(id, email, email_confirmed_at) values
  ('e0000000-0000-0000-0000-000000000006', 'h.naoconf@v.test', null);
update profiles set full_name = split_part(email::text, '@', 1) where id::text like 'e0000000-%';

create temp table h_ids (k text primary key, v uuid);
grant select, insert on h_ids to authenticated;

do $$
declare v uuid;
begin
  perform th.login('e0000000-0000-0000-0000-000000000001');
  insert into h_ids values ('org_a', public.create_organization('Hardening A'));
  perform th.login('e0000000-0000-0000-0000-000000000004');
  insert into h_ids values ('org_b', public.create_organization('Hardening B'));
end $$;
reset role;
insert into organization_members(organization_id, user_id, role) values
  ((select v from h_ids where k = 'org_a'), 'e0000000-0000-0000-0000-000000000002', 'advogado'),
  ((select v from h_ids where k = 'org_a'), 'e0000000-0000-0000-0000-000000000003', 'assistente');

-- =============================================================================
-- 1/2. Grants (stub reproduz os default privileges do Supabase)
-- =============================================================================
do $$
declare r record; v_bad text;
  v_allowed text[] := array[
    'is_org_member(uuid)','has_org_role(uuid,member_role[])','shares_org_with(uuid)',
    'create_organization(text)','accept_pending_invitations()','my_pending_invitations()',
    'accept_invitation(uuid)','decline_invitation(uuid)','leave_organization(uuid)',
    'anonymize_client(uuid)','dashboard_metrics(uuid)','log_export(uuid,text,integer,boolean,uuid)',
    'reorder_workflow_stages(uuid,uuid[])','delete_workflow_stage(uuid,uuid)','apply_checklist_template(uuid)',
    'reorder_checklist_items(uuid,uuid[])','reorder_checklist_templates(uuid,uuid[])',
    'ai_consume_quota(uuid,text,integer,integer)','ai_stalled_demands(uuid,integer)','ai_waiting_documents(uuid)',
    'ai_overdue_tasks(uuid)','ai_upcoming_tasks(uuid,integer)','ai_weekly_summary(uuid,date)',
    'ai_count_demands(uuid,text,date,date,text)','ai_clients_awaiting(uuid)','ai_financial_overview(uuid)',
    'ai_office_overview(uuid)','ai_today()','ai_norm(text)','ai_assert_member(uuid)','ai_member_name(uuid)'];
begin
  -- anon: nada em tabelas/views/sequências
  select string_agg(c.relname || ':' || pr, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace,
         unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
   where n.nspname = 'public' and c.relkind in ('r','v','m','p')
     and has_table_privilege('anon', c.oid, pr);
  if v_bad is not null then raise exception 'FALHOU: anon tem privilégios em tabelas: %', v_bad; end if;
  if exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r','v') and a.attnum > 0
                and (has_column_privilege('anon', c.oid, a.attnum, 'SELECT') or has_column_privilege('anon', c.oid, a.attnum, 'UPDATE')
                     or has_column_privilege('anon', c.oid, a.attnum, 'INSERT'))) then
    raise exception 'FALHOU: anon tem privilégio de coluna em tabela do public';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'S'
                and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE'))) then
    raise exception 'FALHOU: sequência do public utilizável por anon/authenticated';
  end if;

  -- funções (exceto as da extensão citext): anon nada; authenticated só a allowlist
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then raise exception 'FALHOU: anon executa: %', v_bad; end if;

  select string_agg(x, ', ') into v_bad from (
    select regexp_replace(replace(p.oid::regprocedure::text, ' ', ''), '^public\.', '') x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('authenticated', p.oid, 'execute')
  ) s where not x = any(v_allowed);
  if v_bad is not null then raise exception 'FALHOU: authenticated executa funções fora da allowlist: %', v_bad; end if;

  select string_agg(x, ', ') into v_bad from unnest(v_allowed) x
   where not has_function_privilege('authenticated', 'public.' || x, 'execute');
  if v_bad is not null then raise exception 'FALHOU: RPC necessária sem EXECUTE: %', v_bad; end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
                and has_function_privilege('authenticated', p.oid, 'execute')) then
    raise exception 'FALHOU: função de trigger executável por authenticated';
  end if;

  -- authenticated: matriz de tabelas
  for r in select * from (values
      ('organization_members','INSERT'), ('organization_members','TRUNCATE'),
      ('ai_messages','UPDATE'), ('ai_messages','DELETE'),
      ('activity_logs','INSERT'), ('activity_logs','UPDATE'), ('activity_logs','DELETE'),
      ('ai_usage','INSERT'), ('ai_usage','UPDATE'), ('ai_usage','DELETE'),
      ('installment_overview','INSERT'), ('installment_overview','UPDATE'), ('installment_overview','DELETE'),
      ('contract_overview','INSERT'), ('contract_overview','UPDATE'), ('contract_overview','DELETE'),
      ('organizations','INSERT'), ('organizations','DELETE'), ('profiles','INSERT'), ('profiles','DELETE'),
      ('clients','TRUNCATE'), ('payments','TRUNCATE'), ('demands','TRIGGER'), ('clients','REFERENCES')) t(tbl, pr)
  loop
    if has_table_privilege('authenticated', 'public.' || r.tbl, r.pr) then
      raise exception 'FALHOU: authenticated tem % em %', r.pr, r.tbl;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.organization_members', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.organization_members', 'organization_id', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.organization_members', 'role', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.organization_members', 'active', 'UPDATE') then
    raise exception 'FALHOU: organization_members deve permitir UPDATE só de role/active';
  end if;
  if has_column_privilege('authenticated', 'public.organization_invitations', 'accepted_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.organization_invitations', 'declined_at', 'INSERT') then
    raise exception 'FALHOU: authenticated altera accepted_at/declined_at de convites';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE') then
    raise exception 'FALHOU: authenticated altera profiles.email';
  end if;
  foreach v_bad in array array['clients','demands','tasks','contracts','installments','payments','demand_categories',
      'workflow_stages','ai_conversations','message_templates','checklist_templates','demand_checklist_items'] loop
    if not (has_table_privilege('authenticated', 'public.' || v_bad, 'SELECT') and has_table_privilege('authenticated', 'public.' || v_bad, 'INSERT')
        and has_table_privilege('authenticated', 'public.' || v_bad, 'UPDATE') and has_table_privilege('authenticated', 'public.' || v_bad, 'DELETE')) then
      raise exception 'FALHOU: authenticated perdeu CRUD em %', v_bad;
    end if;
  end loop;
end $$;

-- Ataques que eram CONFIRMADOS com os grants padrão do Supabase
do $$
declare a uuid := (select v from h_ids where k = 'org_a'); n int;
begin
  -- [P3] admin troca user_id de um membro para a vítima (sem convite)
  perform th.login('e0000000-0000-0000-0000-000000000001');
  perform th.expect_error(format($q$update organization_members set user_id = 'e0000000-0000-0000-0000-000000000005'
                                    where organization_id = %L and user_id = 'e0000000-0000-0000-0000-000000000003'$q$, a),
                          'admin troca user_id de membro', array['42501']);
  -- assistente insere membership / apaga logs / altera mensagens / apaga ai_usage
  perform th.login('e0000000-0000-0000-0000-000000000003');
  perform th.expect_error(format($q$insert into organization_members(organization_id, user_id, role)
                                    values (%L, 'e0000000-0000-0000-0000-000000000005', 'admin')$q$, a),
                          'insert direto em organization_members', array['42501']);
  perform th.expect_error('delete from activity_logs', 'assistente apaga activity_logs', array['42501']);
  perform th.expect_error('update ai_messages set content = $x$x$x$', 'assistente altera ai_messages', array['42501']);
  perform th.expect_error('delete from ai_usage', 'assistente apaga ai_usage', array['42501']);
  perform th.expect_error('truncate clients', 'truncate clients', array['42501']);
  perform th.expect_error('update contract_overview set notes = null', 'update em view', array['42501','55000']);
  -- funções internas não são chamáveis
  perform th.expect_error(format('select public.seed_default_workflows(%L)', a), 'chamar seed_default_workflows', array['42501']);
  perform th.expect_error(format('select public.refresh_contract_status(%L)', a), 'chamar refresh_contract_status', array['42501']);
  perform th.expect_error('select public.anon_name_regex($x$a$x$)', 'chamar anon_name_regex', array['42501']);
  -- anon
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
  perform th.expect_error(format('select public.dashboard_metrics(%L)', a), 'anon chama dashboard_metrics', array['42501']);
  perform th.expect_error('select public.delete_workflow_stage(gen_random_uuid(), null)', 'anon chama delete_workflow_stage', array['42501']);
  perform th.expect_error('select * from clients', 'anon lê clients', array['42501']);
end $$;
reset role;

-- =============================================================================
-- 3. Anonimização ("Ana" × "Mariana"/"Bruna"; "Joana Segredo" com log de entidade excluída)
-- =============================================================================
do $$
declare
  a uuid := (select v from h_ids where k = 'org_a');
  v_cat uuid := (select id from demand_categories where organization_id = (select v from h_ids where k = 'org_a') order by sort_order limit 1);
  v_ana uuid; v_mar uuid; v_bru uuid; v_jo uuid;
  v_dem uuid; v_dem_mar uuid; v_con uuid; v_conv uuid; v_conv_other uuid; v_dem_del uuid; v_conv_jo uuid; v_task_mar uuid;
  r record;
begin
  perform th.login('e0000000-0000-0000-0000-000000000001');
  insert into clients(organization_id, full_name, cpf) values (a, 'Ana', '11144477735') returning id into v_ana;
  insert into clients(organization_id, full_name) values (a, 'Mariana Souza') returning id into v_mar;
  insert into clients(organization_id, full_name) values (a, 'Bruna Ana') returning id into v_bru;
  insert into clients(organization_id, full_name, cpf) values (a, 'Joana Segredo', '12345678909') returning id into v_jo;

  insert into demands(organization_id, client_id, category_id, title, description, notes, next_action)
  values (a, v_ana, v_cat, 'Pensão Ana - irmã da Mariana', 'Banana; Mariana; CPF 111.444.777-35; Ana; ÁNA; anagrama',
          'cpf 111 444 777 35 e 11144477735', 'Ligar para Ana') returning id into v_dem;
  insert into demands(organization_id, client_id, category_id, title, description)
  values (a, v_mar, v_cat, 'Aposentadoria Mariana Souza', 'Mariana, Bruna e banana') returning id into v_dem_mar;
  insert into tasks(organization_id, title, description, demand_id) values (a, 'Ligar p/ Ana', 'Ana ou Mariana?', v_dem);
  insert into tasks(organization_id, title, client_id) values (a, 'Ligar p/ Mariana', v_mar) returning id into v_task_mar;
  update tasks set title = 'Ligar p/ Mariana hoje' where id = v_task_mar;   -- log de título de OUTRA cliente
  insert into contracts(organization_id, client_id, total_amount, description, notes)
  values (a, v_ana, 100, 'Honorários de Ana (CPF 11144477735)', 'Ana mora na Rua X') returning id into v_con;
  insert into payments(organization_id, contract_id, amount, notes) values (a, v_con, 10, 'Pago pela Ana');
  insert into contracts(organization_id, client_id, total_amount, description) values (a, v_mar, 100, 'Honorários de Mariana');
  insert into demand_checklist_items(organization_id, demand_id, label) values
    (a, v_dem, 'Certidão de nascimento de Ana'), (a, v_dem, 'Certidão de nascimento de Ána');
  insert into demand_checklist_items(organization_id, demand_id, label) values (a, v_dem_mar, 'RG da Mariana');

  -- conversa do advogado citando Ana (título) e outra que NÃO cita a Ana
  reset role;
  insert into ai_conversations(organization_id, user_id, title) values (a, 'e0000000-0000-0000-0000-000000000002', 'Prazo da Ana e da Mariana Souza') returning id into v_conv;
  insert into ai_conversations(organization_id, user_id, title) values (a, 'e0000000-0000-0000-0000-000000000002', 'Bruna e Mariana') returning id into v_conv_other;
  insert into ai_messages(organization_id, conversation_id, user_id, role, content) values
    (a, v_conv, 'e0000000-0000-0000-0000-000000000002', 'user', 'Qual o prazo da Mariana Souza? E a banana? E a Ana?'),
    (a, v_conv_other, 'e0000000-0000-0000-0000-000000000002', 'user', 'Bruna e Mariana: banana, anagrama, Mariana Souza');
  perform th.login('e0000000-0000-0000-0000-000000000001');

  perform public.anonymize_client(v_ana);

  select * into r from demands where id = v_dem;
  if r.title <> 'Pensão Cliente anonimizado - irmã da Mariana' then raise exception 'FALHOU: título: %', r.title; end if;
  if r.description <> 'Banana; Mariana; CPF [CPF removido]; Cliente anonimizado; Cliente anonimizado; anagrama' then
    raise exception 'FALHOU: descrição: %', r.description; end if;
  if r.notes <> 'cpf [CPF removido] e [CPF removido]' then raise exception 'FALHOU: notes/CPF: %', r.notes; end if;
  if r.next_action <> 'Ligar para Cliente anonimizado' then raise exception 'FALHOU: next_action: %', r.next_action; end if;
  if (select title || '|' || description from tasks where demand_id = v_dem) <> 'Ligar p/ Cliente anonimizado|Cliente anonimizado ou Mariana?' then
    raise exception 'FALHOU: tarefa da Ana'; end if;
  if (select description || '|' || notes from contracts where id = v_con) <> 'Honorários de Cliente anonimizado (CPF [CPF removido])|Cliente anonimizado mora na Rua X' then
    raise exception 'FALHOU: contrato da Ana: %', (select description || '|' || notes from contracts where id = v_con); end if;
  if (select notes from payments where contract_id = v_con) <> 'Pago pela Cliente anonimizado' then raise exception 'FALHOU: payments.notes'; end if;
  if exists (select 1 from demand_checklist_items where demand_id = v_dem and label ~* '\mana\M') then
    raise exception 'FALHOU: checklist com nome'; end if;
  if (select count(*) from demand_checklist_items where demand_id = v_dem) <> 2 then raise exception 'FALHOU: checklist perdeu item na colisão'; end if;
  if (select title from ai_conversations where id = v_conv) <> 'Prazo da Cliente anonimizado e da Mariana Souza' then
    raise exception 'FALHOU: título da conversa: %', (select title from ai_conversations where id = v_conv); end if;

  -- NADA de outros clientes foi alterado
  reset role;
  if (select content from ai_messages where conversation_id = v_conv) <> 'Qual o prazo da Mariana Souza? E a banana? E a Cliente anonimizado?' then
    raise exception 'FALHOU: mensagem da conversa citante: %', (select content from ai_messages where conversation_id = v_conv); end if;
  if (select content from ai_messages where conversation_id = v_conv_other) <> 'Bruna e Mariana: banana, anagrama, Mariana Souza' then
    raise exception 'FALHOU: conversa que não cita a cliente foi alterada'; end if;
  if (select title from ai_conversations where id = v_conv_other) <> 'Bruna e Mariana' then raise exception 'FALHOU: título de outra conversa alterado'; end if;
  if (select title || '|' || description from demands where id = v_dem_mar) <> 'Aposentadoria Mariana Souza|Mariana, Bruna e banana' then
    raise exception 'FALHOU: demanda da Mariana alterada'; end if;
  if (select title from tasks where id = v_task_mar) <> 'Ligar p/ Mariana hoje' then raise exception 'FALHOU: tarefa da Mariana alterada'; end if;
  if not exists (select 1 from activity_logs where entity_id = v_task_mar and changes->'title'->>'to' = 'Ligar p/ Mariana hoje') then
    raise exception 'FALHOU: log de título da Mariana foi apagado'; end if;
  if (select label from demand_checklist_items where demand_id = v_dem_mar) <> 'RG da Mariana' then raise exception 'FALHOU: checklist da Mariana alterado'; end if;
  if (select full_name from clients where id = v_bru) <> 'Bruna Ana' then raise exception 'FALHOU: cliente Bruna Ana alterada'; end if;
  if (select description from contracts where client_id = v_mar) <> 'Honorários de Mariana' then raise exception 'FALHOU: contrato da Mariana alterado'; end if;
  if exists (select 1 from activity_logs where organization_id = a and changes::text ~ '11144477735|111\.444') then
    raise exception 'FALHOU: CPF em log'; end if;

  -- [08] Joana: demanda editada e EXCLUÍDA (log from/to fica órfão) + conversa com primeiro nome e CPF formatado
  perform th.login('e0000000-0000-0000-0000-000000000001');
  insert into demands(organization_id, client_id, category_id, title) values (a, v_jo, v_cat, 'Revisão Joana Segredo') returning id into v_dem_del;
  update demands set title = 'Revisão Joana Segredo (urgente)' where id = v_dem_del;
  delete from demands where id = v_dem_del;
  insert into ai_conversations(organization_id, user_id, title) values (a, auth.uid(), 'Pendências da Joana') returning id into v_conv_jo;
  insert into ai_messages(organization_id, conversation_id, user_id, role, content)
  values (a, v_conv_jo, auth.uid(), 'user', 'A Joana (CPF 123.456.789-09) está aguardando RG.');
  perform public.anonymize_client(v_jo);
  reset role;
  if exists (select 1 from activity_logs where organization_id = a and changes::text ~* 'joana') then
    raise exception 'FALHOU: nome em activity_logs após anonimização (entidade excluída)'; end if;
  if (select title from ai_conversations where id = v_conv_jo) <> 'Pendências da Cliente' then
    raise exception 'FALHOU: título da conversa Joana: %', (select title from ai_conversations where id = v_conv_jo); end if;
  if (select content from ai_messages where conversation_id = v_conv_jo) <> 'A Cliente (CPF [CPF removido]) está aguardando RG.' then
    raise exception 'FALHOU: mensagem Joana: %', (select content from ai_messages where conversation_id = v_conv_jo); end if;

  -- [A2] nome com curingas/regex não varre o escritório
  perform th.login('e0000000-0000-0000-0000-000000000001');
  insert into clients(id, organization_id, full_name) values ('e1111111-0000-0000-0000-0000000000a1', a, '%_.*');
  perform public.anonymize_client('e1111111-0000-0000-0000-0000000000a1');
  reset role;
  if (select content from ai_messages where conversation_id = v_conv_other) <> 'Bruna e Mariana: banana, anagrama, Mariana Souza' then
    raise exception 'FALHOU: nome com curingas alterou mensagens alheias'; end if;
end $$;
reset role;

-- =============================================================================
-- 4. Convites com consentimento + saída do escritório
-- =============================================================================
do $$
declare
  b uuid := (select v from h_ids where k = 'org_b');
  a uuid := (select v from h_ids where k = 'org_a');
  v_inv uuid; v_inv2 uuid; v_inv_unc uuid; v_exp uuid; r record;
begin
  perform th.login('e0000000-0000-0000-0000-000000000004');
  insert into organization_invitations(organization_id, email, role) values (b, 'H.VITIMA@v.test', 'assistente') returning id into v_inv;
  insert into organization_invitations(organization_id, email, role) values (b, 'h.naoconf@v.test', 'admin') returning id into v_inv_unc;
  -- admin não consegue forjar aceite nem validade longa
  perform th.expect_error(format('update organization_invitations set accepted_at = now() where id = %L', v_inv), 'admin forja accepted_at', array['42501']);
  update organization_invitations set expires_at = now() + interval '1 year' where id = v_inv;
  if (select expires_at from organization_invitations where id = v_inv) > now() + interval '30 days 1 minute' then
    raise exception 'FALHOU: validade do convite acima de 30 dias'; end if;

  -- [I1] a vítima só faz login: nada acontece
  perform th.login('e0000000-0000-0000-0000-000000000005');
  if public.accept_pending_invitations() <> 0 then raise exception 'FALHOU: accept_pending_invitations ainda aceita'; end if;
  if exists (select 1 from organization_members where user_id = auth.uid()) then raise exception 'FALHOU: membership sem consentimento'; end if;
  select * into r from public.my_pending_invitations();
  if r.id is distinct from v_inv or r.organization_name <> 'Hardening B' or r.role <> 'assistente'
     or r.invited_by_name <> 'h.badmin' or r.expires_at <= now() or r.organization_id <> b then
    raise exception 'FALHOU: my_pending_invitations retornou %', r; end if;
  -- [I3] admin de B ainda não lê o perfil da vítima
  perform th.login('e0000000-0000-0000-0000-000000000004');
  if exists (select 1 from profiles where id = 'e0000000-0000-0000-0000-000000000005') then
    raise exception 'FALHOU: admin lê perfil de quem não aceitou'; end if;

  -- recusar
  perform th.login('e0000000-0000-0000-0000-000000000005');
  perform public.decline_invitation(v_inv);
  if (select count(*) from public.my_pending_invitations()) <> 0 then raise exception 'FALHOU: convite recusado ainda listado'; end if;
  perform th.expect_error(format('select public.accept_invitation(%L)', v_inv), 'aceitar convite recusado', array['P0002']);
  -- outro usuário não aceita convite alheio
  perform th.login('e0000000-0000-0000-0000-000000000003');
  perform th.login('e0000000-0000-0000-0000-000000000004');
  insert into organization_invitations(organization_id, email, role) values (b, 'h.vitima@v.test', 'advogado') returning id into v_inv2;
  perform th.login('e0000000-0000-0000-0000-000000000003');
  perform th.expect_error(format('select public.accept_invitation(%L)', v_inv2), 'aceitar convite de outro e-mail', array['P0002']);
  perform th.expect_error(format('select public.decline_invitation(%L)', v_inv2), 'recusar convite de outro e-mail', array['P0002']);
  -- [I4] e-mail não confirmado
  perform th.login('e0000000-0000-0000-0000-000000000006');
  if (select count(*) from public.my_pending_invitations()) <> 0 then raise exception 'FALHOU: não confirmado lista convite'; end if;
  perform th.expect_error(format('select public.accept_invitation(%L)', v_inv_unc), 'não confirmado aceita', array['P0002']);
  -- aceitar explicitamente
  perform th.login('e0000000-0000-0000-0000-000000000005');
  if public.accept_invitation(v_inv2) <> b then raise exception 'FALHOU: accept_invitation não retornou o escritório'; end if;
  if (select role from organization_members where user_id = auth.uid() and organization_id = b) <> 'advogado' then
    raise exception 'FALHOU: papel do convite aceito'; end if;
  -- [I2] membro sai do escritório
  perform public.leave_organization(b);
  if exists (select 1 from organization_members where user_id = 'e0000000-0000-0000-0000-000000000005') then
    raise exception 'FALHOU: leave_organization não removeu'; end if;
  perform th.expect_error(format('select public.leave_organization(%L)', b), 'sair de escritório do qual não é membro', array['42501']);
  -- último admin não sai
  perform th.login('e0000000-0000-0000-0000-000000000004');
  perform th.expect_error(format('select public.leave_organization(%L)', b), 'último admin sai', array['P0001']);
  -- convite expirado
  reset role;
  insert into organization_invitations(organization_id, email, role) values (a, 'h.vitima@v.test', 'assistente') returning id into v_exp;
  update organization_invitations set expires_at = now() - interval '1 minute' where id = v_exp;
  perform th.login('e0000000-0000-0000-0000-000000000005');
  if (select count(*) from public.my_pending_invitations()) <> 0 then raise exception 'FALHOU: convite expirado listado'; end if;
  perform th.expect_error(format('select public.accept_invitation(%L)', v_exp), 'aceitar convite expirado', array['P0002']);
end $$;
reset role;

-- =============================================================================
-- 5/7/8/A/B/(b). Pagamentos, timestamps, coerência status × etapa
-- =============================================================================
do $$
declare
  a uuid := (select v from h_ids where k = 'org_a');
  v_cat uuid := (select id from demand_categories where organization_id = (select v from h_ids where k = 'org_a') and name = 'Salário-maternidade');
  v_cli uuid; v_cli2 uuid; v_con uuid; v_draft uuid; v_pay uuid; v_dem uuid; v_task uuid; v_final uuid; v_before uuid; v_first uuid;
  r record; msg text;
begin
  select id into v_final from workflow_stages where category_id = v_cat and is_final;
  select id into v_before from workflow_stages where category_id = v_cat and not is_final order by position desc limit 1;
  select id into v_first from workflow_stages where category_id = v_cat order by position limit 1;

  perform th.login('e0000000-0000-0000-0000-000000000002');  -- advogado
  insert into clients(organization_id, full_name) values (a, 'Cliente Pagamentos') returning id into v_cli;
  insert into clients(organization_id, full_name) values (a, 'Outro Cliente') returning id into v_cli2;
  insert into contracts(organization_id, client_id, total_amount, installments_count) values (a, v_cli, 1000, 2) returning id into v_con;

  -- [P8] assistente quita contrato com pagamento arbitrário
  perform th.login('e0000000-0000-0000-0000-000000000003');
  msg := th.expect_error(format('insert into payments(organization_id, contract_id, amount) values (%L, %L, 99999999)', a, v_con),
                         'pagamento acima do saldo', array['P0001']);
  if msg not like '%excede o saldo do contrato%' then raise exception 'FALHOU: mensagem de saldo: %', msg; end if;
  msg := th.expect_error(format('insert into payments(organization_id, contract_id, installment_id, amount) values (%L, %L, %L, 600)',
                         a, v_con, (select id from installments where contract_id = v_con and number = 1)),
                         'pagamento acima da parcela', array['P0001']);
  if msg not like '%restante da parcela%' then raise exception 'FALHOU: mensagem de parcela: %', msg; end if;
  insert into payments(organization_id, contract_id, installment_id, amount)
  values (a, v_con, (select id from installments where contract_id = v_con and number = 1), 500) returning id into v_pay;
  insert into payments(organization_id, contract_id, amount) values (a, v_con, 500.005);  -- tolerância de 0,01 (arredonda p/ 500.01)
  if (select status from contracts where id = v_con) <> 'quitado' then raise exception 'FALHOU: contrato deveria estar quitado'; end if;
  perform th.expect_error(format('insert into payments(organization_id, contract_id, amount) values (%L, %L, 1)', a, v_con),
                          'pagamento em contrato já quitado', array['P0001']);

  -- [P9] UPDATE de pagamento gera log com from/to
  perform th.login('e0000000-0000-0000-0000-000000000002');
  perform th.expect_error(format('update payments set amount = 900 where id = %L', v_pay), 'update acima da parcela', array['P0001']);
  update payments set amount = 400, paid_at = current_date - 3, method = 'boleto' where id = v_pay;
  select * into r from activity_logs where entity_id = v_pay and action = 'updated' order by created_at desc limit 1;
  if r.id is null or (r.changes->'amount'->>'from')::numeric <> 500 or (r.changes->'amount'->>'to')::numeric <> 400
     or r.changes->'method'->>'to' <> 'boleto' or not (r.changes ? 'paid_at') then
    raise exception 'FALHOU: log de UPDATE de pagamento: %', r.changes; end if;

  -- (b) contrato com pagamento não troca de cliente
  msg := th.expect_error(format('update contracts set client_id = %L where id = %L', v_cli2, v_con), 'trocar cliente de contrato pago', array['P0001']);
  -- (A) rascunho não recebe pagamento
  insert into contracts(organization_id, client_id, total_amount, status) values (a, v_cli, 300, 'rascunho') returning id into v_draft;
  msg := th.expect_error(format('insert into payments(organization_id, contract_id, amount) values (%L, %L, 10)', a, v_draft), 'pagar rascunho', array['P0001']);
  if msg not like '%rascunho%' then raise exception 'FALHOU: mensagem de rascunho: %', msg; end if;
  update contracts set client_id = v_cli2 where id = v_draft;  -- sem pagamentos: permitido

  -- [P5] timestamps forjados pela API
  perform th.login('e0000000-0000-0000-0000-000000000003');
  insert into demands(organization_id, client_id, category_id, title, closed_at) values (a, v_cli, v_cat, 'Demanda datas', '2001-01-01') returning id into v_dem;
  if (select closed_at from demands where id = v_dem) is not null then raise exception 'FALHOU: closed_at no insert'; end if;
  update demands set created_at = '2000-01-01', stage_changed_at = '1999-01-01' where id = v_dem;
  select * into r from demands where id = v_dem;
  if r.created_at::date = '2000-01-01' then raise exception 'FALHOU: created_at alterado'; end if;
  if r.stage_changed_at::date = '1999-01-01' then raise exception 'FALHOU: stage_changed_at forjado'; end if;
  update demands set status = 'cancelada', closed_at = '2001-01-01' where id = v_dem;
  if (select closed_at::date from demands where id = v_dem) = '2001-01-01' then raise exception 'FALHOU: closed_at forjado'; end if;
  update demands set status = 'em_andamento' where id = v_dem;
  insert into tasks(organization_id, title, status, completed_at) values (a, 'Tarefa datas', 'concluida', '2001-01-01') returning id into v_task;
  if (select completed_at::date from tasks where id = v_task) = '2001-01-01' then raise exception 'FALHOU: completed_at forjado no insert'; end if;
  update tasks set completed_at = '2002-01-01', created_at = '2000-01-01' where id = v_task;
  if (select completed_at::date from tasks where id = v_task) = '2002-01-01' then raise exception 'FALHOU: completed_at forjado no update'; end if;
  if (select created_at::date from tasks where id = v_task) = '2000-01-01' then raise exception 'FALHOU: created_at de tarefa alterado'; end if;
  update clients set created_at = '2000-01-01' where id = v_cli;
  if (select created_at::date from clients where id = v_cli) = '2000-01-01' then raise exception 'FALHOU: created_at de cliente alterado'; end if;

  -- (B) coerência status × etapa final
  update demands set status = 'concluida' where id = v_dem;
  select * into r from demands where id = v_dem;
  if r.stage_id <> v_final or r.closed_at is null then raise exception 'FALHOU: concluir não moveu para a etapa final'; end if;
  update demands set status = 'em_andamento' where id = v_dem;
  select * into r from demands where id = v_dem;
  if r.stage_id <> v_before or r.status <> 'em_andamento' or r.closed_at is not null then
    raise exception 'FALHOU: reabrir na etapa final não voltou para a etapa anterior (%, %)', r.stage_id, r.status; end if;
  update demands set stage_id = v_final where id = v_dem;
  update demands set status = 'cancelada' where id = v_dem;     -- cancelada na final: permanece
  if (select stage_id from demands where id = v_dem) <> v_final then raise exception 'FALHOU: cancelar moveu de etapa'; end if;
  update demands set status = 'aguardando_cliente' where id = v_dem;
  if (select stage_id from demands where id = v_dem) <> v_before then raise exception 'FALHOU: aguardando_cliente na final'; end if;
  -- insert já concluída sem etapa → etapa final
  insert into demands(organization_id, client_id, category_id, title, status) values (a, v_cli, v_cat, 'Nasce concluída', 'concluida') returning id into v_dem;
  if (select stage_id from demands where id = v_dem) <> v_final then raise exception 'FALHOU: insert concluída fora da etapa final'; end if;
end $$;
reset role;

-- =============================================================================
-- 6. log_export
-- =============================================================================
do $$
declare a uuid := (select v from h_ids where k = 'org_a'); b uuid := (select v from h_ids where k = 'org_b');
  v_cli uuid; v_cli_b uuid := (select id from clients where organization_id = (select v from h_ids where k = 'org_b') limit 1); i int; r record;
begin
  perform th.login('e0000000-0000-0000-0000-000000000003');
  perform public.log_export(a, 'clients', 2147483647, true, gen_random_uuid());
  select * into r from activity_logs where entity_type = 'exports' and actor_id = auth.uid() order by created_at desc limit 1;
  if (r.changes->>'rows')::bigint <> 1000000 then raise exception 'FALHOU: rows sem clamp: %', r.changes; end if;
  if r.entity_id <> a then raise exception 'FALHOU: entity_id arbitrário aceito'; end if;
  insert into clients(organization_id, full_name) values (a, 'Cliente Export') returning id into v_cli;
  perform public.log_export(a, 'clients', -5, false, v_cli);
  select * into r from activity_logs where entity_type = 'exports' and actor_id = auth.uid() and entity_id = v_cli;
  if r.id is null or (r.changes->>'rows')::int <> 0 then raise exception 'FALHOU: entity_id do escritório / clamp negativo'; end if;
  for i in 3..60 loop perform public.log_export(a, 'clients', 1); end loop;
  perform th.expect_error(format('select public.log_export(%L, %L, 1)', a, 'clients'), '61ª exportação na hora', array['P0001']);
  perform th.expect_error(format('select public.log_export(%L, %L, 1)', b, 'clients'), 'log_export em outro escritório', array['42501']);
end $$;
reset role;

-- =============================================================================
-- 9/C. ai_consume_quota
-- =============================================================================
do $$
declare a uuid := (select v from h_ids where k = 'org_a'); n int; i int;
begin
  perform th.login('e0000000-0000-0000-0000-000000000003');
  -- [J3] limite do chamador limitado a 200/h no servidor
  select count(*) filter (where ok) into n from (select public.ai_consume_quota(a, 'assistant', 1000) ok from generate_series(1, 210)) s;
  if n <> 200 then raise exception 'FALHOU: teto fixo de 200/h — aceitas %', n; end if;
  -- chamada com 3 parâmetros nomeados (como as Edge Functions) continua funcionando
  if public.ai_consume_quota(p_org => a, p_kind => 'compose', p_limit_per_hour => 5) is not true then
    raise exception 'FALHOU: chamada de 3 parâmetros'; end if;
  -- teto mensal do escritório (contando todos os tipos/usuários)
  if public.ai_consume_quota(a, 'import', 5, 202) is not true then raise exception 'FALHOU: dentro do teto mensal'; end if;
  if public.ai_consume_quota(a, 'import', 5, 202) is not false then raise exception 'FALHOU: teto mensal não aplicado'; end if;
  perform th.login('e0000000-0000-0000-0000-000000000002');
  if public.ai_consume_quota(a, 'assistant', 5, 202) is not false then raise exception 'FALHOU: teto mensal é por escritório'; end if;
  -- retenção: registros >35 dias do próprio usuário são apagados na chamada
  reset role;
  insert into ai_usage(organization_id, user_id, kind, created_at) values
    (a, 'e0000000-0000-0000-0000-000000000002', 'assistant', now() - interval '40 days'),
    (a, 'e0000000-0000-0000-0000-000000000002', 'assistant', now() - interval '20 days'),
    (a, 'e0000000-0000-0000-0000-000000000001', 'assistant', now() - interval '40 days');
  perform th.login('e0000000-0000-0000-0000-000000000002');
  perform public.ai_consume_quota(a, 'assistant', 5);
  reset role;
  if exists (select 1 from ai_usage where user_id = 'e0000000-0000-0000-0000-000000000002' and created_at < now() - interval '35 days') then
    raise exception 'FALHOU: retenção não apagou registros antigos'; end if;
  if not exists (select 1 from ai_usage where user_id = 'e0000000-0000-0000-0000-000000000002' and created_at < now() - interval '19 days') then
    raise exception 'FALHOU: retenção apagou registro de 20 dias'; end if;
  if not exists (select 1 from ai_usage where user_id = 'e0000000-0000-0000-0000-000000000001' and created_at < now() - interval '35 days') then
    raise exception 'FALHOU: retenção apagou registros de OUTRO usuário'; end if;
  if exists (select 1 from pg_proc where proname = 'ai_consume_quota' and pronargs = 3) then
    raise exception 'FALHOU: sobrecarga antiga de ai_consume_quota ainda existe'; end if;
end $$;
reset role;

-- =============================================================================
-- 10. create_organization serializada por usuário; D. dashboard sem date_trunc = m
-- =============================================================================
do $$
begin
  if pg_get_functiondef('public.create_organization(text)'::regprocedure) !~ 'pg_advisory_xact_lock' then
    raise exception 'FALHOU: create_organization sem lock por usuário'; end if;
  if pg_get_functiondef('public.dashboard_metrics(uuid)'::regprocedure) ~ 'date_trunc\(''month'', (opened_at|closed_at|created_at|paid_at|due_date)\)' then
    raise exception 'FALHOU: dashboard_metrics ainda usa date_trunc(...) = m'; end if;
  perform th.login('e0000000-0000-0000-0000-000000000001');
  if (select count(*) from jsonb_object_keys(public.dashboard_metrics((select v from h_ids where k = 'org_a')))) <> 15 then
    raise exception 'FALHOU: dashboard_metrics mudou o formato'; end if;
  -- limite de 3 escritórios continua valendo
  perform public.create_organization('Hardening A2');
  perform public.create_organization('Hardening A3');
  perform th.expect_error($q$select public.create_organization('Hardening A4')$q$, '4º escritório', array['P0001']);
end $$;
reset role;

rollback;
\echo '✔ hardening_test: ok'
