-- =============================================================================
-- JurisFlow AI — Testes de segurança (RLS, multiempresa, papéis, LGPD)
-- =============================================================================
-- Executado por supabase/tests/run_local.sh após o stub + migrations.
-- Tudo roda dentro de UMA transação que é desfeita no final (não deixa lixo).
-- Cada cenário roda num SAVEPOINT: o usuário é simulado com
--   set role authenticated + request.jwt.claims = {"sub": <id>}
-- (feito por tst.login), e o savepoint é desfeito ao final do cenário.
-- Qualquer falha → raise exception 'FALHOU: ...' → psql para (ON_ERROR_STOP).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
-- "Hoje" do escritório = data em São Paulo (as regras do banco usam
-- (now() at time zone 'America/Sao_Paulo')::date). Com o fuso da sessão fixado,
-- current_date nos testes passa a ser exatamente essa data.
set local timezone = 'America/Sao_Paulo';

-- -----------------------------------------------------------------------------
-- Helpers de teste (schema tst, descartado no rollback final)
-- -----------------------------------------------------------------------------
create schema tst;
create sequence tst.passed;

-- id de fixture: tst.id('u_a_admin'), tst.id('org_a') ...
create function tst.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tst.' || p, true), '')::uuid $$;

create function tst.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tst.' || p, v::text, false) $$;

-- Simula o usuário (sub do JWT) com o papel "authenticated" do Supabase.
create function tst.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tst.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tst.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $$;

create function tst.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FALHOU: %', label;
  end if;
  perform nextval('tst.passed');
end $$;

-- Executa SQL e exige erro com um dos SQLSTATEs informados.
create function tst.expect_error(q text, states text[], label text) returns void language plpgsql as $$
declare st text; msg text;
begin
  begin
    execute q;
  exception when others then
    st := sqlstate; msg := sqlerrm;
  end;
  if st is null then
    raise exception 'FALHOU: % — a operação deveria ser recusada (%), mas foi aceita', label, states;
  elsif not st = any(states) then
    raise exception 'FALHOU: % — esperava SQLSTATE % e veio % (%)', label, states, st, msg;
  end if;
  perform nextval('tst.passed');
end $$;

-- Igual a expect_error, mas também confere um trecho da mensagem.
create function tst.expect_error_msg(q text, fragment text, label text) returns void language plpgsql as $$
declare msg text;
begin
  begin
    execute q;
  exception when others then
    msg := sqlerrm;
  end;
  if msg is null then
    raise exception 'FALHOU: % — a operação deveria ser recusada, mas foi aceita', label;
  elsif position(fragment in msg) = 0 then
    raise exception 'FALHOU: % — mensagem inesperada: %', label, msg;
  end if;
  perform nextval('tst.passed');
end $$;

-- Linhas afetadas por um UPDATE/DELETE.
create function tst.affected(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end $$;

-- UPDATE/DELETE que não pode ter efeito: 0 linhas OU permissão negada.
create function tst.expect_noop(q text, label text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute q;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;
  if n <> 0 then
    raise exception 'FALHOU: % — % linha(s) afetada(s), esperado 0', label, n;
  end if;
  perform nextval('tst.passed');
end $$;

-- Quantidade de linhas visíveis (permissão negada conta como 0).
create function tst.visible(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

grant usage on schema tst to authenticated, anon;
grant execute on all functions in schema tst to authenticated, anon;
grant usage, select on sequence tst.passed to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Fixtures (como superusuário — RLS não se aplica aqui)
-- -----------------------------------------------------------------------------
do $$
declare
  v_ids jsonb := '{
    "u_a_admin": "00000000-0000-4000-8000-00000000a001",
    "u_a_adv":   "00000000-0000-4000-8000-00000000a002",
    "u_a_asst":  "00000000-0000-4000-8000-00000000a003",
    "u_b_admin": "00000000-0000-4000-8000-00000000b001",
    "u_nobody":  "00000000-0000-4000-8000-00000000c001",
    "u_inv_ok":  "00000000-0000-4000-8000-00000000d001",
    "u_inv_unc": "00000000-0000-4000-8000-00000000d002",
    "cli_a":     "00000000-0000-4000-8000-0000000c1a01",
    "cli_a2":    "00000000-0000-4000-8000-0000000c1a02",
    "cli_b":     "00000000-0000-4000-8000-0000000c1b01",
    "dem_a":     "00000000-0000-4000-8000-0000000de0a1",
    "dem_b":     "00000000-0000-4000-8000-0000000de0b1",
    "task_a":    "00000000-0000-4000-8000-00000007a5a1",
    "task_b":    "00000000-0000-4000-8000-00000007a5b1",
    "con_a":     "00000000-0000-4000-8000-0000000c0a01",
    "con_b":     "00000000-0000-4000-8000-0000000c0b01",
    "pay_a":     "00000000-0000-4000-8000-0000000fa0a1",
    "pay_b":     "00000000-0000-4000-8000-0000000fa0b1",
    "conv_adv":  "00000000-0000-4000-8000-0000000a10a2",
    "conv_asst": "00000000-0000-4000-8000-0000000a10a3",
    "conv_b":    "00000000-0000-4000-8000-0000000a10b1"
  }';
  k text;
begin
  for k in select jsonb_object_keys(v_ids) loop
    perform tst.set_id(k, (v_ids->>k)::uuid);
  end loop;

  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
    (tst.id('u_a_admin'), 'admin.a@teste.local',   '{"full_name":"Admin A"}',      now()),
    (tst.id('u_a_adv'),   'adv.a@teste.local',     '{"full_name":"Advogado A"}',   now()),
    (tst.id('u_a_asst'),  'asst.a@teste.local',    '{"full_name":"Assistente A"}', now()),
    (tst.id('u_b_admin'), 'admin.b@teste.local',   '{"full_name":"Admin B"}',      now()),
    (tst.id('u_nobody'),  'sem.org@teste.local',   '{"full_name":"Sem escritório"}', now()),
    (tst.id('u_inv_ok'),  'convidado@teste.local', '{"full_name":"Convidado"}',    now()),
    (tst.id('u_inv_unc'), 'naoconfirmado@teste.local', '{"full_name":"Não confirmado"}', null);

  -- Escritórios criados pela RPC oficial (cria admin + fluxos padrão)
  perform set_config('request.jwt.claims', json_build_object('sub', tst.id('u_a_admin'))::text, true);
  perform tst.set_id('org_a', public.create_organization('Escritório A'));
  perform set_config('request.jwt.claims', json_build_object('sub', tst.id('u_b_admin'))::text, true);
  perform tst.set_id('org_b', public.create_organization('Escritório B'));

  insert into public.organization_members (organization_id, user_id, role) values
    (tst.id('org_a'), tst.id('u_a_adv'),  'advogado'),
    (tst.id('org_a'), tst.id('u_a_asst'), 'assistente');

  perform tst.set_id('cat_a', (select id from demand_categories where organization_id = tst.id('org_a') and name = 'Outros'));
  perform tst.set_id('cat_b', (select id from demand_categories where organization_id = tst.id('org_b') and name = 'Outros'));
  perform tst.set_id('stage_a0', (select id from workflow_stages where category_id = tst.id('cat_a') order by position limit 1));
  perform tst.set_id('stage_a1', (select id from workflow_stages where category_id = tst.id('cat_a') order by position offset 1 limit 1));
  perform tst.set_id('stage_b0', (select id from workflow_stages where category_id = tst.id('cat_b') order by position limit 1));

  -- Dados do escritório A (criados "como" o admin A, para created_by/actor)
  perform set_config('request.jwt.claims', json_build_object('sub', tst.id('u_a_admin'))::text, true);
  insert into clients (id, organization_id, full_name, cpf, phone, email) values
    (tst.id('cli_a'),  tst.id('org_a'), 'Maria Teste A', '52998224725', '11987654321', 'maria@teste.local'),
    (tst.id('cli_a2'), tst.id('org_a'), 'José Teste A',  '11144477735', '11912345678', null);
  insert into demands (id, organization_id, client_id, category_id, title, responsible_id) values
    (tst.id('dem_a'), tst.id('org_a'), tst.id('cli_a'), tst.id('cat_a'), 'Demanda A', tst.id('u_a_adv'));
  insert into tasks (id, organization_id, title, demand_id, assignee_id, due_date) values
    (tst.id('task_a'), tst.id('org_a'), 'Tarefa A', tst.id('dem_a'), tst.id('u_a_asst'), current_date);
  insert into contracts (id, organization_id, client_id, demand_id, total_amount, installments_count, first_due_date) values
    (tst.id('con_a'), tst.id('org_a'), tst.id('cli_a'), tst.id('dem_a'), 1000, 2, current_date - 40);
  insert into payments (id, organization_id, contract_id, installment_id, amount) values
    (tst.id('pay_a'), tst.id('org_a'), tst.id('con_a'),
     (select id from installments where contract_id = tst.id('con_a') and number = 1), 500);
  insert into ai_conversations (id, organization_id, user_id, title) values
    (tst.id('conv_adv'),  tst.id('org_a'), tst.id('u_a_adv'),  'Conversa do advogado'),
    (tst.id('conv_asst'), tst.id('org_a'), tst.id('u_a_asst'), 'Conversa da assistente');
  insert into ai_messages (organization_id, conversation_id, user_id, role, content) values
    (tst.id('org_a'), tst.id('conv_adv'),  tst.id('u_a_adv'),  'user', 'Pergunta privada do advogado'),
    (tst.id('org_a'), tst.id('conv_asst'), tst.id('u_a_asst'), 'user', 'Pergunta privada da assistente');
  insert into organization_invitations (organization_id, email, role, invited_by) values
    (tst.id('org_a'), 'Convidado@Teste.Local', 'advogado', tst.id('u_a_admin')),
    (tst.id('org_a'), 'naoconfirmado@teste.local', 'assistente', tst.id('u_a_admin'));

  -- Dados do escritório B
  perform set_config('request.jwt.claims', json_build_object('sub', tst.id('u_b_admin'))::text, true);
  insert into clients (id, organization_id, full_name, cpf) values
    (tst.id('cli_b'), tst.id('org_b'), 'Cliente B', '52998224725'); -- mesmo CPF: unicidade é por escritório
  insert into demands (id, organization_id, client_id, category_id, title) values
    (tst.id('dem_b'), tst.id('org_b'), tst.id('cli_b'), tst.id('cat_b'), 'Demanda B');
  insert into tasks (id, organization_id, title, demand_id) values
    (tst.id('task_b'), tst.id('org_b'), 'Tarefa B', tst.id('dem_b'));
  insert into contracts (id, organization_id, client_id, total_amount, installments_count) values
    (tst.id('con_b'), tst.id('org_b'), tst.id('cli_b'), 300, 1);
  insert into payments (id, organization_id, contract_id, amount) values
    (tst.id('pay_b'), tst.id('org_b'), tst.id('con_b'), 100);
  insert into ai_conversations (id, organization_id, user_id) values
    (tst.id('conv_b'), tst.id('org_b'), tst.id('u_b_admin'));

  perform tst.set_id('inst_b', (select id from installments where contract_id = tst.id('con_b') and number = 1));
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Tabelas/views com organization_id usadas nos testes de isolamento
-- Tabelas criadas por migrations posteriores (outros módulos), se existirem:
-- entram nos testes de isolamento, mas não no controle positivo.
create function tst.extra_tables() returns text[] language sql stable as $$
  select coalesce(array_agg(t), '{}') from unnest(array['message_templates','checklist_templates','demand_checklist_items']) t
   where to_regclass('public.' || t) is not null
$$;
create function tst.org_tables() returns text[] language sql stable as $$
  select array['clients','demands','tasks','contracts','installments','payments','activity_logs',
               'demand_categories','workflow_stages','organization_members','organization_invitations',
               'ai_conversations','ai_messages','contract_overview','installment_overview'] || tst.extra_tables()
$$;
grant execute on function tst.org_tables(), tst.extra_tables() to authenticated, anon;

-- =============================================================================
-- 0. Controle positivo: o admin A enxerga os dados de A (os testes negativos
--    abaixo só têm valor se os dados existirem)
-- =============================================================================
savepoint t;
do $$
declare t text;
begin
  perform tst.login('u_a_admin');
  foreach t in array tst.org_tables() loop
    continue when t in ('ai_conversations', 'ai_messages') -- conversas são de outros usuários
               or t = any(tst.extra_tables());
    perform tst.ok(tst.visible(format('select 1 from public.%I where organization_id = %L', t, tst.id('org_a'))) > 0,
                   format('admin A deveria ver linhas de A em %s', t));
  end loop;
  perform tst.ok((select count(*) from organizations) = 1, 'admin A vê apenas o próprio escritório');
  perform tst.ok((select (public.dashboard_metrics(tst.id('org_a'))->>'clients_total')::int) = 2, 'dashboard de A acessível ao admin A');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 1. Isolamento entre escritórios (usuário de B contra dados de A)
-- =============================================================================
savepoint t;
do $$
declare t text;
begin
  perform tst.login('u_b_admin');
  foreach t in array tst.org_tables() loop
    perform tst.ok(tst.visible(format('select 1 from public.%I where organization_id = %L', t, tst.id('org_a'))) = 0,
                   format('B não pode ler linhas de A em %s', t));
  end loop;
  perform tst.ok(tst.visible(format('select 1 from public.organizations where id = %L', tst.id('org_a'))) = 0,
                 'B não pode ler a organização A');
  perform tst.ok((select count(*) from organizations) = 1, 'B vê só o próprio escritório');
  perform tst.ok((select count(*) from clients) = 1, 'B vê só o próprio cliente (controle)');
  perform tst.ok((select count(*) from profiles where id in (tst.id('u_a_admin'), tst.id('u_a_adv'), tst.id('u_a_asst'))) = 0,
                 'B não pode ler perfis (nome/e-mail) de membros de A');
  -- buscar por id direto também não retorna nada
  perform tst.ok(tst.visible(format('select 1 from public.clients where id = %L', tst.id('cli_a'))) = 0, 'B não lê cliente de A por id');
  perform tst.ok(tst.visible(format('select 1 from public.contract_overview where id = %L', tst.id('con_a'))) = 0, 'B não lê contract_overview de A por id');
end $$;
rollback to savepoint t;

-- Inserções com organization_id de A
savepoint t;
do $$
declare a uuid := tst.id('org_a'); bb uuid := tst.id('u_b_admin');
begin
  perform tst.login('u_b_admin');
  perform tst.expect_error(format($q$insert into clients (organization_id, full_name) values (%L, 'Invasor')$q$, a),
                           array['42501'], 'B insere cliente em A');
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, title) values (%L, %L, %L, 'Invasora')$q$,
                           a, tst.id('cli_a'), tst.id('cat_a')), array['42501','23503'], 'B insere demanda em A');
  perform tst.expect_error(format($q$insert into tasks (organization_id, title) values (%L, 'Invasora')$q$, a),
                           array['42501'], 'B insere tarefa em A');
  perform tst.expect_error(format($q$insert into contracts (organization_id, client_id, total_amount) values (%L, %L, 10)$q$, a, tst.id('cli_a')),
                           array['42501','23503'], 'B insere contrato em A');
  perform tst.expect_error(format($q$insert into payments (organization_id, contract_id, amount) values (%L, %L, 10)$q$, a, tst.id('con_a')),
                           array['42501','23503'], 'B insere pagamento em A');
  perform tst.expect_error(format($q$insert into installments (organization_id, contract_id, number, due_date, amount) values (%L, %L, 99, current_date, 1)$q$, a, tst.id('con_a')),
                           array['42501','23503'], 'B insere parcela em A');
  perform tst.expect_error(format($q$insert into demand_categories (organization_id, name) values (%L, 'Invasora')$q$, a),
                           array['42501'], 'B insere categoria em A');
  perform tst.expect_error(format($q$insert into workflow_stages (organization_id, category_id, name, position) values (%L, %L, 'X', 50)$q$, a, tst.id('cat_a')),
                           array['42501','23503'], 'B insere etapa em A');
  perform tst.expect_error(format($q$insert into organization_invitations (organization_id, email, role) values (%L, 'x@y.com', 'admin')$q$, a),
                           array['42501'], 'B convida pessoas para A');
  perform tst.expect_error(format($q$insert into organization_members (organization_id, user_id, role) values (%L, %L, 'admin')$q$, a, bb),
                           array['42501'], 'B se adiciona como membro de A');
  perform tst.expect_error(format($q$insert into ai_conversations (organization_id, user_id) values (%L, %L)$q$, a, bb),
                           array['42501'], 'B cria conversa de IA em A');
  perform tst.expect_error(format($q$insert into ai_messages (organization_id, conversation_id, user_id, role, content) values (%L, %L, %L, 'user', 'x')$q$, a, tst.id('conv_adv'), bb),
                           array['42501','23503'], 'B insere mensagem em conversa de A');
  perform tst.expect_error(format($q$insert into activity_logs (organization_id, entity_type, entity_id, action) values (%L, 'clients', gen_random_uuid(), 'deleted')$q$, a),
                           array['42501'], 'B forja log de atividade em A');
end $$;
rollback to savepoint t;

-- Atualizações/exclusões em linhas de A → 0 linhas
savepoint t;
do $$
declare t text; a uuid := tst.id('org_a');
begin
  perform tst.login('u_b_admin');
  foreach t in array array['clients','demands','tasks','contracts','installments','payments','demand_categories',
                           'workflow_stages','organization_invitations','ai_conversations'] || tst.extra_tables() loop
    perform tst.expect_noop(format('update public.%I set updated_at = now() where organization_id = %L', t, a), format('B atualiza %s de A', t));
    perform tst.expect_noop(format('delete from public.%I where organization_id = %L', t, a), format('B exclui %s de A', t));
  end loop;
  perform tst.expect_noop(format($q$update organization_members set role = 'assistente' where organization_id = %L$q$, a), 'B rebaixa membros de A');
  perform tst.expect_noop(format('delete from organization_members where organization_id = %L', a), 'B remove membros de A');
  perform tst.expect_noop(format($q$update organizations set name = 'Hackeado' where id = %L$q$, a), 'B renomeia A');
  perform tst.expect_noop(format('delete from ai_messages where organization_id = %L', a), 'B exclui mensagens de A');
  perform tst.expect_noop(format('delete from activity_logs where organization_id = %L', a), 'B apaga logs de A');
  perform tst.expect_noop(format($q$update profiles set full_name = 'Hackeado' where id = %L$q$, tst.id('u_a_admin')), 'B altera perfil de membro de A');

  -- RPCs contra A
  perform tst.expect_error(format('select public.dashboard_metrics(%L)', a), array['42501'], 'B lê dashboard_metrics de A');
  perform tst.expect_error(format('select public.anonymize_client(%L)', tst.id('cli_a')), array['42501'], 'B anonimiza cliente de A');
  perform tst.expect_error(format('select public.reorder_workflow_stages(%L, array[%L]::uuid[])', tst.id('cat_a'), tst.id('stage_a0')),
                           array['P0001','42501'], 'B reordena etapas de A');
  perform tst.expect_error(format('select public.delete_workflow_stage(%L, null)', tst.id('stage_a1')),
                           array['P0002','42501'], 'B exclui etapa de A');
end $$;
rollback to savepoint t;

-- Toda função pública do tipo f(p_org uuid, [demais com default]) recusa outro escritório
-- (dashboard_metrics, ai_* das ferramentas da IA, seeds internos...).
savepoint t;
do $$
declare f record; n int := 0;
begin
  perform tst.login('u_b_admin');
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.pronargs >= 1 and p.pronargs - p.pronargdefaults = 1
       and p.proargnames[1] = 'p_org' and p.proargtypes[0] = 'uuid'::regtype
       and p.prorettype not in ('trigger'::regtype, 'boolean'::regtype) -- is_org_member etc. só respondem sobre o próprio usuário
  loop
    perform tst.expect_error(format('select public.%I(%L::uuid)', f.proname, tst.id('org_a')), array['42501'],
                             format('B chama %s com o escritório A', f.sig));
    n := n + 1;
  end loop;
  perform tst.ok(n >= 1, 'funções por escritório encontradas');
  perform tst.ok(not public.is_org_member(tst.id('org_a')), 'is_org_member(A) = false para B');
  perform tst.ok(not public.has_org_role(tst.id('org_a'), array['admin']::public.member_role[]), 'has_org_role(A) = false para B');
end $$;
rollback to savepoint t;

do $$ begin
  perform tst.ok((select name from organizations where id = tst.id('org_a')) = 'Escritório A', 'nome de A intacto após tentativas de B');
  perform tst.ok((select count(*) from clients where organization_id = tst.id('org_a')) = 2, 'clientes de A intactos');
end $$;

-- =============================================================================
-- 2. FKs compostas e troca de escritório
-- =============================================================================
savepoint t;
do $$
declare a uuid := tst.id('org_a');
begin
  perform tst.login('u_a_admin');
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, title) values (%L, %L, %L, 'XX')$q$,
                           a, tst.id('cli_b'), tst.id('cat_a')), array['23503'], 'demanda de A com cliente de B');
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, title) values (%L, %L, %L, 'XX')$q$,
                           a, tst.id('cli_a'), tst.id('cat_b')), array['23503'], 'demanda de A com categoria de B');
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, stage_id, title) values (%L, %L, %L, %L, 'XX')$q$,
                           a, tst.id('cli_a'), tst.id('cat_a'), tst.id('stage_b0')), array['23503'], 'demanda de A com etapa de B');
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, title, responsible_id) values (%L, %L, %L, 'XX', %L)$q$,
                           a, tst.id('cli_a'), tst.id('cat_a'), tst.id('u_b_admin')), array['23503'], 'demanda de A com responsável que não é membro de A');
  perform tst.expect_error(format($q$update demands set stage_id = %L where id = %L$q$, tst.id('stage_b0'), tst.id('dem_a')),
                           array['23503'], 'mover demanda de A para etapa de B');
  perform tst.expect_error(format($q$update demands set client_id = %L where id = %L$q$, tst.id('cli_b'), tst.id('dem_a')),
                           array['23503'], 'trocar cliente da demanda para cliente de B');
  perform tst.expect_error(format($q$insert into tasks (organization_id, title, demand_id) values (%L, 'XX', %L)$q$, a, tst.id('dem_b')),
                           array['23503'], 'tarefa de A ligada à demanda de B');
  perform tst.expect_error(format($q$insert into tasks (organization_id, title, client_id) values (%L, 'XX', %L)$q$, a, tst.id('cli_b')),
                           array['23503'], 'tarefa de A ligada a cliente de B');
  perform tst.expect_error(format($q$insert into tasks (organization_id, title, assignee_id) values (%L, 'XX', %L)$q$, a, tst.id('u_b_admin')),
                           array['23503'], 'tarefa de A atribuída a usuário de B');
  perform tst.expect_error(format($q$insert into contracts (organization_id, client_id, total_amount) values (%L, %L, 10)$q$, a, tst.id('cli_b')),
                           array['23503'], 'contrato de A com cliente de B');
  perform tst.expect_error(format($q$insert into contracts (organization_id, client_id, demand_id, total_amount) values (%L, %L, %L, 10)$q$, a, tst.id('cli_a'), tst.id('dem_b')),
                           array['23503'], 'contrato de A com demanda de B');
  perform tst.expect_error(format($q$insert into payments (organization_id, contract_id, amount) values (%L, %L, 10)$q$, a, tst.id('con_b')),
                           array['23503'], 'pagamento em A referenciando contrato de B');
  perform tst.expect_error(format($q$insert into payments (organization_id, contract_id, installment_id, amount) values (%L, %L, %L, 10)$q$,
                           a, tst.id('con_a'), tst.id('inst_b')), array['P0001','23503'], 'pagamento com parcela de outro escritório');
  perform tst.expect_error(format($q$insert into workflow_stages (organization_id, category_id, name, position) values (%L, %L, 'X', 50)$q$, a, tst.id('cat_b')),
                           array['23503'], 'etapa de A em categoria de B');
  perform tst.expect_error(format($q$insert into ai_messages (organization_id, conversation_id, user_id, role, content) values (%L, %L, %L, 'user', 'x')$q$, a, tst.id('conv_b'), tst.id('u_a_admin')),
                           array['42501','23503'], 'mensagem de A em conversa de B');
  -- mover registros para B (não é membro de B → RLS/trigger)
  perform tst.expect_error(format($q$update clients set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('cli_a')),
                           array['42501'], 'mover cliente de A para B');
  perform tst.expect_error(format($q$update tasks set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('task_a')),
                           array['42501'], 'mover tarefa de A para B');
end $$;
rollback to savepoint t;

-- Mesmo um usuário que é admin dos DOIS escritórios não move registros entre eles
savepoint t;
insert into organization_members (organization_id, user_id, role) values (tst.id('org_b'), tst.id('u_a_admin'), 'admin');
do $$
begin
  perform tst.login('u_a_admin');
  perform tst.expect_error_msg(format($q$update clients set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('cli_a')),
                               'organization_id não pode ser alterado', 'prevent_org_change em clients (admin de A e B)');
  perform tst.expect_error_msg(format($q$update demand_categories set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('cat_a')),
                               'organization_id não pode ser alterado', 'prevent_org_change em demand_categories');
  perform tst.expect_error_msg(format($q$update payments set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('pay_a')),
                               'organization_id não pode ser alterado', 'prevent_org_change em payments');
  perform tst.expect_error_msg(format($q$update demands set organization_id = %L where id = %L$q$, tst.id('org_b'), tst.id('dem_a')),
                               'organization_id não pode ser alterado', 'prevent_org_change em demands');
  -- dual-membro: nem assim usa cliente de B em demanda de A
  perform tst.expect_error(format($q$insert into demands (organization_id, client_id, category_id, title) values (%L, %L, %L, 'XX')$q$,
                           tst.id('org_a'), tst.id('cli_b'), tst.id('cat_a')), array['23503'], 'membro de A e B mistura dados');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 3. Papéis dentro do escritório
-- =============================================================================
-- 3.1 Assistente
savepoint t;
do $$
declare a uuid := tst.id('org_a'); v_pay uuid; v_cli uuid;
begin
  perform tst.login('u_a_asst');
  -- pode ler e criar o operacional
  perform tst.ok((select count(*) from clients) = 2, 'assistente lê clientes');
  insert into clients (organization_id, full_name) values (a, 'Novo pela assistente') returning id into v_cli;
  perform tst.ok(v_cli is not null, 'assistente cria cliente');
  insert into demands (organization_id, client_id, category_id, title) values (a, v_cli, tst.id('cat_a'), 'Demanda da assistente');
  insert into tasks (organization_id, title) values (a, 'Tarefa da assistente');
  perform tst.ok(tst.affected(format($q$update demands set stage_id = %L where id = %L$q$, tst.id('stage_a1'), tst.id('dem_a'))) = 1,
                 'assistente movimenta demanda no Kanban');
  perform tst.ok(tst.affected(format($q$update tasks set status = 'concluida' where id = %L$q$, tst.id('task_a'))) = 1, 'assistente conclui tarefa');
  -- não exclui
  perform tst.expect_noop(format('delete from clients where id = %L', tst.id('cli_a2')), 'assistente exclui cliente');
  perform tst.expect_noop(format('delete from demands where id = %L', tst.id('dem_a')), 'assistente exclui demanda');
  perform tst.expect_noop(format('delete from tasks where id = %L', tst.id('task_a')), 'assistente exclui tarefa');
  -- contratos: só leitura
  perform tst.ok((select count(*) from contract_overview) = 1, 'assistente lê contratos');
  perform tst.expect_error(format($q$insert into contracts (organization_id, client_id, total_amount) values (%L, %L, 10)$q$, a, tst.id('cli_a')),
                           array['42501'], 'assistente cria contrato');
  perform tst.expect_noop(format($q$update contracts set notes = 'x' where id = %L$q$, tst.id('con_a')), 'assistente edita contrato');
  perform tst.expect_noop(format('delete from contracts where id = %L', tst.id('con_a')), 'assistente exclui contrato');
  perform tst.expect_noop(format('update installments set amount = 1 where contract_id = %L', tst.id('con_a')), 'assistente edita parcela');
  -- pagamentos: registra, mas não estorna nem edita
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (a, tst.id('con_a'), (select id from installments where contract_id = tst.id('con_a') and number = 2), 100)
  returning id into v_pay;
  perform tst.ok((select created_by from payments where id = v_pay) = tst.id('u_a_asst'), 'assistente registra pagamento (created_by correto)');
  perform tst.expect_noop(format('delete from payments where id = %L', tst.id('pay_a')), 'assistente estorna pagamento');
  perform tst.expect_noop(format('delete from payments where id = %L', v_pay), 'assistente estorna o próprio pagamento');
  perform tst.expect_noop(format('update payments set amount = 1 where id = %L', tst.id('pay_a')), 'assistente edita pagamento');
  -- fluxos: só leitura
  perform tst.ok((select count(*) from workflow_stages) > 0, 'assistente lê fluxos');
  perform tst.expect_error(format($q$insert into demand_categories (organization_id, name) values (%L, 'Nova')$q$, a), array['42501'], 'assistente cria categoria');
  perform tst.expect_noop(format($q$update workflow_stages set name = 'x' where category_id = %L$q$, tst.id('cat_a')), 'assistente edita etapa');
  perform tst.expect_error(format('select public.reorder_workflow_stages(%L, (select array_agg(id order by position desc) from workflow_stages where category_id = %L))',
                           tst.id('cat_a'), tst.id('cat_a')), array['42501'], 'assistente reordena etapas');
  perform tst.expect_error(format('select public.delete_workflow_stage(%L, %L)', tst.id('stage_a1'), tst.id('stage_a0')),
                           array['42501'], 'assistente exclui etapa');
  -- administração
  perform tst.expect_noop(format($q$update organization_members set role = 'admin' where user_id = %L$q$, tst.id('u_a_asst')), 'assistente se promove a admin');
  perform tst.expect_error(format($q$insert into organization_invitations (organization_id, email, role) values (%L, 'z@z.com', 'admin')$q$, a),
                           array['42501'], 'assistente cria convite');
  perform tst.ok(tst.visible('select 1 from organization_invitations') = 0, 'assistente não lê convites');
  perform tst.expect_noop(format($q$update organizations set name = 'X' where id = %L$q$, a), 'assistente edita escritório');
  perform tst.expect_error(format('select public.anonymize_client(%L)', tst.id('cli_a2')), array['42501'], 'assistente anonimiza cliente');
end $$;
-- o delete_workflow_stage recusado não deixou a demanda movida
reset role;
do $$ begin
  perform tst.ok((select count(*) from workflow_stages where id = tst.id('stage_a1')) = 1, 'etapa continua existindo após tentativa da assistente');
end $$;
rollback to savepoint t;

-- 3.2 Advogado
savepoint t;
do $$
declare a uuid := tst.id('org_a'); v_cat uuid;
begin
  perform tst.login('u_a_adv');
  perform tst.ok(tst.affected(format($q$update contracts set notes = 'Revisado' where id = %L$q$, tst.id('con_a'))) = 1, 'advogado edita contrato');
  insert into contracts (organization_id, client_id, total_amount) values (a, tst.id('cli_a2'), 200);
  perform tst.ok(true, 'advogado cria contrato');
  insert into demand_categories (organization_id, name) values (a, 'Previdenciário especial') returning id into v_cat;
  insert into workflow_stages (organization_id, category_id, name, position) values (a, v_cat, 'Início', 0);
  perform tst.ok(tst.affected(format($q$update workflow_stages set name = 'Triagem' where id = %L$q$, tst.id('stage_a0'))) = 1, 'advogado edita etapa');
  perform public.reorder_workflow_stages(tst.id('cat_a'),
    (select array_agg(id order by position desc) from workflow_stages where category_id = tst.id('cat_a')));
  perform tst.ok((select position from workflow_stages where id = tst.id('stage_a0')) > 0, 'advogado reordena etapas');
  perform tst.ok(tst.affected(format('delete from tasks where id = %L', tst.id('task_a'))) = 1, 'advogado exclui tarefa');
  perform tst.ok(tst.affected(format('delete from payments where id = %L', tst.id('pay_a'))) = 1, 'advogado estorna pagamento');
  -- limites
  perform tst.expect_noop(format('delete from clients where id = %L', tst.id('cli_a2')), 'advogado exclui cliente');
  perform tst.expect_noop(format('delete from contracts where id = %L', tst.id('con_a')), 'advogado exclui contrato');
  perform tst.expect_noop(format($q$update organization_members set role = 'admin' where user_id = %L$q$, tst.id('u_a_adv')), 'advogado se promove');
  perform tst.expect_noop(format($q$update organization_members set active = false where user_id = %L$q$, tst.id('u_a_asst')), 'advogado desativa membro');
  perform tst.expect_noop(format('delete from organization_members where user_id = %L', tst.id('u_a_asst')), 'advogado remove membro');
  perform tst.expect_error(format($q$insert into organization_invitations (organization_id, email, role) values (%L, 'z@z.com', 'assistente')$q$, a),
                           array['42501'], 'advogado cria convite');
  perform tst.ok(tst.visible('select 1 from organization_invitations') = 0, 'advogado não lê convites');
  perform tst.expect_noop('delete from organization_invitations', 'advogado cancela convites');
  perform tst.expect_noop(format($q$update organizations set name = 'X' where id = %L$q$, a), 'advogado edita escritório');
  perform tst.expect_noop(format('delete from demand_categories where id = %L', v_cat), 'advogado exclui categoria');
  perform tst.expect_error(format('select public.anonymize_client(%L)', tst.id('cli_a2')), array['42501'], 'advogado anonimiza cliente');
end $$;
rollback to savepoint t;

-- 3.3 Administrador
savepoint t;
do $$
declare a uuid := tst.id('org_a');
begin
  perform tst.login('u_a_admin');
  perform tst.ok(tst.affected(format($q$update organization_members set role = 'advogado' where user_id = %L and organization_id = %L$q$, tst.id('u_a_asst'), a)) = 1,
                 'admin altera papel');
  perform tst.ok(tst.affected(format($q$update organization_members set active = false where user_id = %L and organization_id = %L$q$, tst.id('u_a_asst'), a)) = 1,
                 'admin desativa membro');
  insert into organization_invitations (organization_id, email, role) values (a, 'novo@teste.local', 'assistente');
  perform tst.ok((select count(*) from organization_invitations where organization_id = a) = 3, 'admin cria e lista convites');
  perform tst.ok(tst.affected($q$delete from organization_invitations where email = 'novo@teste.local'$q$) = 1, 'admin cancela convite');
  perform tst.ok(tst.affected(format($q$update organizations set name = 'Escritório A Renomeado' where id = %L$q$, a)) = 1, 'admin renomeia escritório');
  perform tst.ok(tst.affected(format('delete from clients where id = %L', tst.id('cli_a2'))) = 1, 'admin exclui cliente sem vínculos');
  perform tst.expect_error(format('delete from clients where id = %L', tst.id('cli_a')), array['23503'], 'cliente com demandas/contratos não pode ser excluído');
  -- organization_members: só role/active são atualizáveis
  perform tst.expect_error(format('update organization_members set user_id = %L where user_id = %L', tst.id('u_nobody'), tst.id('u_a_adv')),
                           array['42501'], 'admin troca user_id de um membro');
  perform tst.expect_error(format('update organization_members set organization_id = %L where user_id = %L', tst.id('org_b'), tst.id('u_a_adv')),
                           array['42501'], 'admin troca organization_id de um membro');
  perform tst.expect_error(format($q$insert into organization_members (organization_id, user_id, role) values (%L, %L, 'admin')$q$, a, tst.id('u_nobody')),
                           array['42501'], 'admin insere membro direto (deve usar convite)');
end $$;
rollback to savepoint t;

-- 3.4 protect_last_admin
savepoint t;
do $$
declare a uuid := tst.id('org_a');
begin
  perform tst.login('u_a_admin');
  perform tst.expect_error_msg(format($q$update organization_members set role = 'advogado' where user_id = %L and organization_id = %L$q$, tst.id('u_a_admin'), a),
                               'pelo menos um administrador', 'rebaixar o último admin');
  perform tst.expect_error_msg(format($q$update organization_members set active = false where user_id = %L and organization_id = %L$q$, tst.id('u_a_admin'), a),
                               'pelo menos um administrador', 'desativar o último admin');
  perform tst.expect_error_msg(format($q$delete from organization_members where user_id = %L and organization_id = %L$q$, tst.id('u_a_admin'), a),
                               'pelo menos um administrador', 'remover o último admin');
  -- com um segundo admin, pode se rebaixar
  perform tst.affected(format($q$update organization_members set role = 'admin' where user_id = %L$q$, tst.id('u_a_adv')));
  perform tst.ok(tst.affected(format($q$update organization_members set role = 'advogado' where user_id = %L and organization_id = %L$q$, tst.id('u_a_admin'), a)) = 1,
                 'admin se rebaixa quando há outro admin');
  -- agora o advogado-promovido é o último admin
  perform tst.login('u_a_adv');
  perform tst.expect_error_msg(format($q$update organization_members set active = false where user_id = %L$q$, tst.id('u_a_adv')),
                               'pelo menos um administrador', 'desativar o novo último admin');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 4. Assistente de IA: histórico privado por usuário
-- =============================================================================
savepoint t;
do $$
declare a uuid := tst.id('org_a');
begin
  perform tst.login('u_a_asst');
  perform tst.ok((select count(*) from ai_conversations) = 1, 'assistente vê só a própria conversa');
  perform tst.ok((select count(*) from ai_messages) = 1, 'assistente vê só as próprias mensagens');
  perform tst.ok(tst.visible(format('select 1 from ai_conversations where id = %L', tst.id('conv_adv'))) = 0, 'assistente não vê conversa do advogado');
  perform tst.ok(tst.visible(format('select 1 from ai_messages where conversation_id = %L', tst.id('conv_adv'))) = 0, 'assistente não vê mensagens do advogado');
  perform tst.expect_error(format($q$insert into ai_messages (organization_id, conversation_id, user_id, role, content) values (%L, %L, %L, 'user', 'x')$q$,
                           a, tst.id('conv_adv'), tst.id('u_a_asst')), array['42501'], 'mensagem própria em conversa alheia');
  perform tst.expect_error(format($q$insert into ai_messages (organization_id, conversation_id, user_id, role, content) values (%L, %L, %L, 'assistant', 'x')$q$,
                           a, tst.id('conv_adv'), tst.id('u_a_adv')), array['42501'], 'mensagem em nome do advogado');
  perform tst.expect_error(format($q$insert into ai_conversations (organization_id, user_id) values (%L, %L)$q$, a, tst.id('u_a_adv')),
                           array['42501'], 'criar conversa em nome de outro usuário');
  perform tst.expect_noop(format($q$update ai_conversations set title = 'x' where id = %L$q$, tst.id('conv_adv')), 'editar conversa alheia');
  perform tst.expect_noop(format('delete from ai_conversations where id = %L', tst.id('conv_adv')), 'excluir conversa alheia');
  perform tst.expect_error(format($q$update ai_conversations set user_id = %L where id = %L$q$, tst.id('u_a_adv'), tst.id('conv_asst')),
                           array['42501'], 'transferir a própria conversa para outro usuário');
  -- o próprio usuário consegue usar o histórico
  insert into ai_messages (organization_id, conversation_id, user_id, role, content) values (a, tst.id('conv_asst'), tst.id('u_a_asst'), 'user', 'Nova pergunta');
  perform tst.ok((select count(*) from ai_messages) = 2, 'assistente grava mensagem na própria conversa');
  -- nem o admin vê conversas dos outros
  perform tst.login('u_a_admin');
  perform tst.ok((select count(*) from ai_conversations) = 0 and (select count(*) from ai_messages) = 0, 'admin não vê conversas de IA alheias');
end $$;
rollback to savepoint t;

-- Membro desativado perde o acesso (inclusive ao próprio histórico)
savepoint t;
update organization_members set active = false where user_id = tst.id('u_a_adv');
do $$
declare t text;
begin
  perform tst.login('u_a_adv');
  foreach t in array tst.org_tables() loop
    perform tst.ok(tst.visible(format('select 1 from public.%I', t)) = 0, format('membro desativado não lê %s', t));
  end loop;
  perform tst.ok((select count(*) from organizations) = 0, 'membro desativado não lê organizations');
  perform tst.expect_error(format($q$insert into clients (organization_id, full_name) values (%L, 'XX')$q$, tst.id('org_a')), array['42501'], 'membro desativado cria cliente');
  -- 1.1: o vínculo ativo com o escritório também é exigido no histórico de IA.
  -- A conversa é a do próprio advogado (conv_adv, criada no seed): só user_id = auth.uid()
  -- não pode bastar depois da desativação.
  perform tst.expect_noop(format('delete from ai_conversations where id = %L', tst.id('conv_adv')),
                          'membro desativado exclui a própria conversa de IA');
  perform tst.expect_noop(format($q$update ai_conversations set title = 'invadido' where id = %L$q$, tst.id('conv_adv')),
                          'membro desativado edita a própria conversa de IA');
end $$;
-- Verificado como superusuário (sem RLS): a conversa do ex-membro continua existindo.
reset role;
do $$
begin
  perform tst.ok(tst.visible(format('select 1 from public.ai_conversations where id = %L', tst.id('conv_adv'))) = 1,
                 'conversa do membro desativado continua existindo no banco');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 5. Sem escritório e anônimo
-- =============================================================================
savepoint t;
do $$
declare t text;
begin
  perform tst.login('u_nobody');
  foreach t in array tst.org_tables() || array['organizations'] loop
    perform tst.ok(tst.visible(format('select 1 from public.%I', t)) = 0, format('usuário sem escritório não lê %s', t));
  end loop;
  perform tst.ok((select count(*) from profiles) = 1, 'usuário sem escritório só vê o próprio perfil');
  perform tst.expect_error(format('select public.dashboard_metrics(%L)', tst.id('org_a')), array['42501'], 'sem escritório lê dashboard de A');
  perform tst.ok(public.accept_pending_invitations() = 0, 'sem convite → nada aceito');
end $$;
rollback to savepoint t;

savepoint t;
do $$
declare t text;
begin
  perform tst.login_anon();
  perform tst.ok(current_user = 'anon', 'simulação de anon ativa');
  foreach t in array tst.org_tables() || array['organizations','profiles'] loop
    perform tst.ok(tst.visible(format('select 1 from public.%I', t)) = 0, format('anon não lê %s', t));
  end loop;
  perform tst.expect_error($q$insert into clients (organization_id, full_name) values (gen_random_uuid(), 'XX')$q$, array['42501'], 'anon insere cliente');
  perform tst.expect_error(format('select public.dashboard_metrics(%L)', tst.id('org_a')), array['42501'], 'anon chama dashboard_metrics');
  perform tst.expect_error($q$select public.create_organization('Anon')$q$, array['42501'], 'anon cria escritório');
  perform tst.expect_error(format('select public.anonymize_client(%L)', tst.id('cli_a')), array['42501'], 'anon anonimiza cliente');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 6. created_by não pode ser forjado; perfis
-- =============================================================================
savepoint t;
do $$
declare a uuid := tst.id('org_a'); v uuid;
begin
  perform tst.login('u_a_asst');
  insert into clients (organization_id, full_name, created_by) values (a, 'Forjado', tst.id('u_a_admin')) returning id into v;
  perform tst.ok((select created_by from clients where id = v) = tst.id('u_a_asst'), 'created_by forjado no insert de cliente é corrigido');
  insert into tasks (organization_id, title, created_by) values (a, 'Forjada', tst.id('u_a_admin')) returning id into v;
  perform tst.ok((select created_by from tasks where id = v) = tst.id('u_a_asst'), 'created_by forjado no insert de tarefa é corrigido');
  perform tst.affected(format('update clients set created_by = %L where id = %L', tst.id('u_a_asst'), tst.id('cli_a')));
  perform tst.ok((select created_by from clients where id = tst.id('cli_a')) = tst.id('u_a_admin'), 'created_by é imutável no update');
  perform tst.affected(format('update demands set created_by = %L where id = %L', tst.id('u_a_asst'), tst.id('dem_a')));
  perform tst.ok((select created_by from demands where id = tst.id('dem_a')) = tst.id('u_a_admin'), 'created_by de demanda imutável');
  -- logs registram o ator real
  perform tst.ok((select actor_id from activity_logs where entity_id = v and action = 'created') = tst.id('u_a_asst'), 'actor_id do log = usuário real');

  -- perfil: edita o próprio nome; não altera e-mail nem o perfil de colegas
  perform tst.ok(tst.affected(format($q$update profiles set full_name = 'Assistente Renomeada' where id = %L$q$, tst.id('u_a_asst'))) = 1, 'usuário edita o próprio nome');
  perform tst.expect_noop(format($q$update profiles set full_name = 'X' where id = %L$q$, tst.id('u_a_admin')), 'usuário edita perfil de colega');
  perform tst.expect_error(format($q$update profiles set email = 'admin.a@teste.local' where id = %L$q$, tst.id('u_a_asst')),
                           array['42501'], 'usuário altera o e-mail exibido no perfil (falsificação de identidade)');
  perform tst.ok(tst.visible('select 1 from profiles') = 3, 'membros de A veem os 3 perfis de A');
end $$;
rollback to savepoint t;

-- Convites: invited_by não pode ser forjado
savepoint t;
do $$
declare v uuid;
begin
  perform tst.login('u_a_admin');
  insert into organization_invitations (organization_id, email, role, invited_by)
  values (tst.id('org_a'), 'forjado@teste.local', 'assistente', tst.id('u_b_admin')) returning id into v;
  perform tst.ok((select invited_by from organization_invitations where id = v) = tst.id('u_a_admin'), 'invited_by forjado é corrigido');
  perform tst.affected(format('update organization_invitations set invited_by = %L where id = %L', tst.id('u_a_adv'), v));
  perform tst.ok((select invited_by from organization_invitations where id = v) = tst.id('u_a_admin'), 'invited_by é imutável');
end $$;
rollback to savepoint t;

-- Organizações: admin só altera nome/configurações (não is_demo, id, datas)
savepoint t;
do $$
begin
  perform tst.login('u_a_admin');
  perform tst.ok(tst.affected(format($q$update organizations set settings = '{"x":1}' where id = %L$q$, tst.id('org_a'))) = 1, 'admin altera settings');
  perform tst.expect_error(format('update organizations set is_demo = true where id = %L', tst.id('org_a')), array['42501'], 'admin altera is_demo pela API');
  perform tst.expect_error(format($q$update organizations set created_at = '2000-01-01' where id = %L$q$, tst.id('org_a')), array['42501'], 'admin altera created_at');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 7. LGPD: anonymize_client e logs sem dados pessoais
-- =============================================================================
savepoint t;
do $$
declare c record;
begin
  perform tst.login('u_a_admin');
  update clients set phone = '11955554444', cpf = '39053344705', email = 'novo@teste.local', address = 'Rua Secreta, 123'
   where id = tst.id('cli_a');
  perform public.anonymize_client(tst.id('cli_a'));
  select * into c from clients where id = tst.id('cli_a');
  perform tst.ok(c.full_name = 'Cliente anonimizado' and c.cpf is null and c.phone is null and c.email is null
                 and c.birth_date is null and c.address is null and c.notes is null, 'anonymize_client limpa dados pessoais');
  perform tst.ok(c.anonymized_at is not null and c.status = 'arquivado', 'anonymize_client marca anonymized_at/arquivado');
  perform tst.ok((select count(*) from demands where client_id = tst.id('cli_a')) = 1
                 and (select count(*) from contracts where client_id = tst.id('cli_a')) = 1, 'histórico operacional/financeiro preservado');
  perform tst.ok((select (public.dashboard_metrics(tst.id('org_a'))->>'clients_total')::int) = 1, 'anonimizado não conta como cliente no dashboard');
end $$;
-- verificação como superusuário: nenhum valor pessoal em activity_logs
reset role;
do $$
declare v text;
begin
  foreach v in array array['52998224725','11987654321','39053344705','11955554444','11144477735','maria@teste.local',
                           'novo@teste.local','Rua Secreta','Maria Teste A','José Teste A'] loop
    perform tst.ok(not exists (select 1 from activity_logs where entity_type = 'clients' and changes::text like '%' || v || '%'),
                   format('activity_logs de clientes não contém "%s"', v));
  end loop;
  perform tst.ok(exists (select 1 from activity_logs where entity_type = 'clients' and entity_id = tst.id('cli_a')
                          and changes ? 'cpf' and changes->'cpf' = '{"changed": true}'::jsonb), 'log registra só o NOME do campo alterado');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 8. accept_pending_invitations
-- =============================================================================
savepoint t;
do $$
begin
  perform tst.login('u_inv_ok');
  perform tst.ok((select count(*) from organizations) = 0, 'convidado ainda não vê o escritório');
  perform tst.ok(public.accept_pending_invitations() = 1, 'convite (e-mail confirmado, maiúsculas diferentes) é aceito');
  perform tst.ok((select role from organization_members where user_id = tst.id('u_inv_ok') and organization_id = tst.id('org_a')) = 'advogado',
                 'convidado vira membro com o papel do convite');
  perform tst.ok((select count(*) from clients) = 2, 'convidado passa a ver os dados de A');
  perform tst.ok(public.accept_pending_invitations() = 0, 'convite não é aceito duas vezes');

  perform tst.login('u_inv_unc');
  perform tst.ok(public.accept_pending_invitations() = 0, 'e-mail não confirmado não aceita convite');
  perform tst.ok((select count(*) from organizations) = 0, 'não confirmado continua sem acesso');
end $$;
reset role;
do $$ begin
  perform tst.ok((select accepted_at from organization_invitations where email = 'convidado@teste.local') is not null, 'convite marcado como aceito');
  perform tst.ok((select accepted_at from organization_invitations where email = 'naoconfirmado@teste.local') is null, 'convite não confirmado segue pendente');
end $$;
rollback to savepoint t;

-- Ex-admin desativado e reconvidado como assistente volta como ASSISTENTE
savepoint t;
update organization_members set role = 'admin' where user_id = tst.id('u_a_adv');
update organization_members set active = false where user_id = tst.id('u_a_adv');
insert into organization_invitations (organization_id, email, role) values (tst.id('org_a'), 'adv.a@teste.local', 'assistente');
do $$ begin
  perform tst.login('u_a_adv');
  perform tst.ok(public.accept_pending_invitations() = 1, 'reconvite aceito');
  perform tst.ok((select role from organization_members where user_id = tst.id('u_a_adv')) = 'assistente',
                 'membro reativado recebe o papel do novo convite (sem escalonamento)');
end $$;
rollback to savepoint t;

-- Membro ativo convidado de novo mantém o papel atual
savepoint t;
insert into organization_invitations (organization_id, email, role) values (tst.id('org_a'), 'asst.a@teste.local', 'admin');
do $$ begin
  perform tst.login('u_a_asst');
  perform public.accept_pending_invitations();
  perform tst.ok((select role from organization_members where user_id = tst.id('u_a_asst')) = 'assistente', 'membro ativo mantém o papel');
end $$;
rollback to savepoint t;

-- E-mail do perfil acompanha o auth.users (fonte verificada)
savepoint t;
update auth.users set email = 'asst.novo@teste.local' where id = tst.id('u_a_asst');
do $$ begin
  perform tst.ok((select email from profiles where id = tst.id('u_a_asst')) = 'asst.novo@teste.local', 'profiles.email sincronizado com auth.users');
end $$;
rollback to savepoint t;

-- -----------------------------------------------------------------------------
do $$ begin
  raise warning 'rls_test.sql: % verificações de segurança OK', (select last_value from tst.passed);
end $$;
rollback;
