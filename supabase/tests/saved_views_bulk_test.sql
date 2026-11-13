-- =============================================================================
-- JurisFlow AI — Testes de aceite do lote L13: filtros salvos e ações em massa
-- =============================================================================
-- Cobre a migration 20261112000006_saved_views_bulk.sql descrita no plano L13:
--   * saved_views: dono lê/edita/apaga; colega só lê a compartilhada, mas não
--     edita nem apaga; outro escritório não lê; insert com user_id alheio falha;
--     anon não acessa.
--   * bulk_update_demands: 3 prioridades → devolve 3; ids de outro escritório
--     são ignorados na contagem; etapa de outra categoria → 22023 e nada muda;
--     201 ids, patch vazio/chave desconhecida/responsável inválido → 22023;
--     não membro → 42501; gatilhos de etapa/status continuam valendo.
--   * bulk_update_tasks: conclui 2 tarefas (completed_at preenchido), troca
--     responsável, limpa prazo; data inválida → 22023; ids de outro escritório
--     não mudam.
-- Roda em transação desfeita no final. Qualquer falha → raise exception →
-- psql para (ON_ERROR_STOP). Contas feitas à mão estão nos comentários.
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;

create schema tsta;
create sequence tsta.passed;

create function tsta.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tsta.' || p, true), '')::uuid $$;

create function tsta.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tsta.' || p, v::text, false) $$;

create function tsta.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tsta.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tsta.passed');
end $$;

create function tsta.eq(got anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FALHOU: % — obtido %, esperado %', label, got, expected;
  end if;
  perform nextval('tsta.passed');
end $$;

create function tsta.expect_error_state(q text, state text, fragment text, label text) returns void language plpgsql as $$
declare st text; msg text;
begin
  begin
    execute q;
  exception when others then
    st := sqlstate; msg := sqlerrm;
  end;
  if st is null then
    raise exception 'FALHOU: % — a operação deveria ser recusada, mas foi aceita', label;
  elsif st <> state then
    raise exception 'FALHOU: % — esperava SQLSTATE % e veio % (%)', label, state, st, msg;
  elsif position(fragment in msg) = 0 then
    raise exception 'FALHOU: % — mensagem inesperada: %', label, msg;
  end if;
  perform nextval('tsta.passed');
end $$;

grant usage on schema tsta to authenticated, anon;
grant execute on all functions in schema tsta to authenticated, anon;
grant usage, select on sequence tsta.passed to authenticated, anon;

-- =============================================================================
-- Fixtures: 2 escritórios; no A: admin, colega ativo e um membro inativo.
-- =============================================================================
do $$
begin
  perform tsta.set_id('u_admin',     '13000000-0000-4000-a000-000000000001');
  perform tsta.set_id('u_colleague', '13000000-0000-4000-a000-000000000002');
  perform tsta.set_id('u_inactive',  '13000000-0000-4000-a000-000000000003');
  perform tsta.set_id('u_admin_b',   '13000000-0000-4000-a000-000000000004');

  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'),     'l13.admin@teste.local',      '{"full_name":"Ana Admin L13"}'),
    (tsta.id('u_colleague'), 'l13.colega@teste.local',     '{"full_name":"Bruno Colega L13"}'),
    (tsta.id('u_inactive'),  'l13.inativo@teste.local',    '{"full_name":"Carla Inativa L13"}'),
    (tsta.id('u_admin_b'),   'l13.admin.b@teste.local',    '{"full_name":"Diego Admin B L13"}');
end $$;

do $$
declare
  v_a uuid;
  v_b uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  v_a := public.create_organization('Escritório L13 A');
  perform tsta.set_id('org_a', v_a);

  insert into organization_members (organization_id, user_id, role) values
    (v_a, tsta.id('u_colleague'), 'advogado');
  insert into organization_members (organization_id, user_id, role, active) values
    (v_a, tsta.id('u_inactive'), 'assistente', false);

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_b'))::text, true);
  v_b := public.create_organization('Escritório L13 B');
  perform tsta.set_id('org_b', v_b);

  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  o_a uuid := tsta.id('org_a');
  o_b uuid := tsta.id('org_b');
  v_cat_prev_a uuid;
  v_cat_trab_a uuid;
  v_cat_prev_b uuid;
  v_stage_prev_1 uuid;
  v_stage_prev_2 uuid;
  v_stage_prev_final uuid;
  v_stage_trab_1 uuid;
  v_stage_prev_b uuid;
  v_client_a uuid;
  v_client_b uuid;
  v_id uuid;
begin
  select id into v_cat_prev_a from demand_categories
   where organization_id = o_a and name = 'Aposentadoria';
  select id into v_cat_trab_a from demand_categories
   where organization_id = o_a and name = 'Demandas trabalhistas';
  select id into v_cat_prev_b from demand_categories
   where organization_id = o_b and name = 'Aposentadoria';

  select id into v_stage_prev_1 from workflow_stages
   where category_id = v_cat_prev_a order by position limit 1;
  select id into v_stage_prev_2 from workflow_stages
   where category_id = v_cat_prev_a order by position offset 1 limit 1;
  select id into v_stage_prev_final from workflow_stages
   where category_id = v_cat_prev_a and is_final limit 1;
  select id into v_stage_trab_1 from workflow_stages
   where category_id = v_cat_trab_a order by position limit 1;
  select id into v_stage_prev_b from workflow_stages
   where category_id = v_cat_prev_b order by position limit 1;

  perform tsta.set_id('cat_prev_a', v_cat_prev_a);
  perform tsta.set_id('cat_trab_a', v_cat_trab_a);
  perform tsta.set_id('stage_prev_1', v_stage_prev_1);
  perform tsta.set_id('stage_prev_2', v_stage_prev_2);
  perform tsta.set_id('stage_prev_final', v_stage_prev_final);
  perform tsta.set_id('stage_trab_1', v_stage_trab_1);

  insert into clients (organization_id, full_name)
  values (o_a, 'Cliente L13 A') returning id into v_client_a;
  insert into clients (organization_id, full_name)
  values (o_b, 'Cliente L13 B') returning id into v_client_b;

  -- Demandas do escritório A: 3 na categoria Aposentadoria + 1 em trabalhistas.
  insert into demands (organization_id, client_id, category_id, stage_id, title, priority, status, responsible_id)
  values (o_a, v_client_a, v_cat_prev_a, v_stage_prev_1, 'L13 previdenciária 1', 'media', 'em_andamento', tsta.id('u_admin'))
  returning id into v_id;
  perform tsta.set_id('d_prev_1', v_id);

  insert into demands (organization_id, client_id, category_id, stage_id, title, priority, status, responsible_id)
  values (o_a, v_client_a, v_cat_prev_a, v_stage_prev_1, 'L13 previdenciária 2', 'media', 'em_andamento', tsta.id('u_admin'))
  returning id into v_id;
  perform tsta.set_id('d_prev_2', v_id);

  insert into demands (organization_id, client_id, category_id, stage_id, title, priority, status, responsible_id)
  values (o_a, v_client_a, v_cat_prev_a, v_stage_prev_1, 'L13 previdenciária 3', 'media', 'em_andamento', tsta.id('u_admin'))
  returning id into v_id;
  perform tsta.set_id('d_prev_3', v_id);

  insert into demands (organization_id, client_id, category_id, stage_id, title, priority, status, responsible_id)
  values (o_a, v_client_a, v_cat_trab_a, v_stage_trab_1, 'L13 trabalhista', 'media', 'em_andamento', tsta.id('u_admin'))
  returning id into v_id;
  perform tsta.set_id('d_trab', v_id);

  -- Demanda do escritório B para provar o isolamento da atualização em massa.
  insert into demands (organization_id, client_id, category_id, stage_id, title, priority, status, responsible_id)
  values (o_b, v_client_b, v_cat_prev_b, v_stage_prev_b, 'L13 demanda B', 'media', 'em_andamento', tsta.id('u_admin_b'))
  returning id into v_id;
  perform tsta.set_id('d_b', v_id);

  -- Tarefas do escritório A (4 próprias) + 1 do B.
  insert into tasks (organization_id, title, assignee_id, due_date, status)
  values (o_a, 'L13 tarefa 1', tsta.id('u_admin'), current_date + 1, 'pendente')
  returning id into v_id;
  perform tsta.set_id('t_1', v_id);

  insert into tasks (organization_id, title, assignee_id, due_date, status)
  values (o_a, 'L13 tarefa 2', tsta.id('u_admin'), current_date + 2, 'pendente')
  returning id into v_id;
  perform tsta.set_id('t_2', v_id);

  insert into tasks (organization_id, title, assignee_id, due_date, status)
  values (o_a, 'L13 tarefa 3', tsta.id('u_admin'), current_date + 3, 'pendente')
  returning id into v_id;
  perform tsta.set_id('t_3', v_id);

  insert into tasks (organization_id, title, assignee_id, due_date, status)
  values (o_a, 'L13 tarefa 4', tsta.id('u_admin'), current_date + 4, 'pendente')
  returning id into v_id;
  perform tsta.set_id('t_4', v_id);

  insert into tasks (organization_id, title, assignee_id, due_date, status)
  values (o_b, 'L13 tarefa B', tsta.id('u_admin_b'), current_date + 1, 'pendente')
  returning id into v_id;
  perform tsta.set_id('t_b', v_id);

  -- Filtros salvos (4 linhas no escritório A; 1 no B).
  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_a, tsta.id('u_admin'), 'demandas', 'Meus urgentes', 'priority=alta', false)
  returning id into v_id;
  perform tsta.set_id('view_owner_private', v_id);

  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_a, tsta.id('u_admin'), 'demandas', 'Equipe do escritório', 'category=aposentadoria', true)
  returning id into v_id;
  perform tsta.set_id('view_owner_shared', v_id);

  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_a, tsta.id('u_admin'), 'tarefas', 'Meu temporário', 'status=pendente', false)
  returning id into v_id;
  perform tsta.set_id('view_owner_delete', v_id);

  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_a, tsta.id('u_colleague'), 'demandas', 'Meu do colega', 'q=abc', false)
  returning id into v_id;
  perform tsta.set_id('view_colleague_private', v_id);

  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_a, tsta.id('u_colleague'), 'tarefas', 'Do colega', 'status=concluida', true)
  returning id into v_id;
  perform tsta.set_id('view_colleague_shared', v_id);

  insert into saved_views (organization_id, user_id, page, name, query, shared)
  values (o_b, tsta.id('u_admin_b'), 'demandas', 'Outro escritório', 'priority=baixa', true)
  returning id into v_id;
  perform tsta.set_id('view_org_b', v_id);
end $$;

-- =============================================================================
-- 1. saved_views — RLS de leitura/escrita
-- =============================================================================
do $$ begin perform tsta.login('u_admin'); end $$;

do $$
declare
  n int;
begin
  -- Admin A enxerga 3 próprios + 1 compartilhado pelo colega = 4 linhas.
  -- (o filtro privado do colega e o do escritório B ficam de fora)
  perform tsta.eq((select count(*)::int from public.saved_views), 4,
                  'admin vê 4 filtros (3 próprios + 1 compartilhado)');
  perform tsta.ok(
    not exists (select 1 from public.saved_views where name = 'Meu do colega'),
    'admin não vê filtro privado do colega');

  -- O dono apaga o próprio filtro.
  delete from public.saved_views where id = tsta.id('view_owner_delete');
  get diagnostics n = row_count;
  perform tsta.eq(n, 1, 'dono apaga o próprio filtro');
  perform tsta.eq((select count(*)::int from public.saved_views), 3,
                  'sobraram 3 filtros visíveis para o admin');

  -- O dono edita o próprio filtro.
  update public.saved_views set name = 'Meus urgentes (editado)'
   where id = tsta.id('view_owner_private');
  get diagnostics n = row_count;
  perform tsta.eq(n, 1, 'dono edita o próprio filtro');

  -- Inserir em nome de outra pessoa é recusado pela policy de INSERT.
  perform tsta.expect_error_state(
    format('insert into public.saved_views (organization_id, user_id, page, name, query) values (%L, %L, %L, %L, %L)',
           tsta.id('org_a'), tsta.id('u_colleague'), 'demandas', 'Em nome do colega', 'q=x'),
    '42501', '', 'insert com user_id alheio falha');

  -- Inserir em nome próprio é permitido (e removido em seguida).
  insert into public.saved_views (organization_id, user_id, page, name, query)
  values (tsta.id('org_a'), tsta.id('u_admin'), 'demandas', 'Meu novo filtro', 'q=teste');
  get diagnostics n = row_count;
  perform tsta.eq(n, 1, 'dono insere o próprio filtro');
  delete from public.saved_views where name = 'Meu novo filtro';
end $$;

reset role;

do $$ begin perform tsta.login('u_colleague'); end $$;

do $$
declare
  n int;
begin
  -- Colega vê: 2 próprios + 1 compartilhado pelo admin + 1 compartilhado do admin
  -- (owner_private é privado e continua escondido; owner_delete foi apagado) = 3.
  perform tsta.eq((select count(*)::int from public.saved_views), 3,
                  'colega vê 3 filtros (2 próprios + 1 compartilhado)');
  perform tsta.ok(
    exists (select 1 from public.saved_views where id = tsta.id('view_owner_shared')),
    'colega lê o filtro compartilhado do admin');

  update public.saved_views set name = 'invadido'
   where id = tsta.id('view_owner_shared');
  get diagnostics n = row_count;
  perform tsta.eq(n, 0, 'colega não edita filtro compartilhado do admin');

  delete from public.saved_views where id = tsta.id('view_owner_shared');
  get diagnostics n = row_count;
  perform tsta.eq(n, 0, 'colega não apaga filtro compartilhado do admin');
end $$;

reset role;

-- O filtro compartilhado continua intacto depois das tentativas do colega.
do $$ begin
  perform tsta.eq(
    (select name from public.saved_views where id = tsta.id('view_owner_shared')),
    'Equipe do escritório',
    'filtro compartilhado do admin permanece intacto');
end $$;

do $$ begin perform tsta.login('u_admin_b'); end $$;

do $$
begin
  -- Admin B só vê o próprio filtro; nada do escritório A.
  perform tsta.eq((select count(*)::int from public.saved_views), 1,
                  'admin B vê só o filtro do próprio escritório');
  perform tsta.eq(
    (select count(*)::int from public.saved_views where id = tsta.id('view_owner_shared')),
    0, 'admin B não lê filtro compartilhado do escritório A');
end $$;

reset role;

set role anon;
do $$ begin
  perform tsta.expect_error_state(
    'select count(*) from public.saved_views',
    '42501', '', 'anon não lê saved_views');
end $$;
reset role;

-- =============================================================================
-- 2. bulk_update_demands
-- =============================================================================
do $$ begin perform tsta.login('u_admin'); end $$;

do $$
declare
  v_a uuid := tsta.id('org_a');
  n int;
begin
  -- Prioridade de 3 demandas: 3 linhas mudam → devolve 3.
  n := public.bulk_update_demands(
    v_a,
    array[tsta.id('d_prev_1'), tsta.id('d_prev_2'), tsta.id('d_prev_3')],
    '{"priority":"alta"}'::jsonb
  );
  perform tsta.eq(n, 3, 'prioridade de 3 demandas devolve 3');
  perform tsta.eq(
    (select count(*)::int from public.demands
      where id = any(array[tsta.id('d_prev_1'), tsta.id('d_prev_2'), tsta.id('d_prev_3')])
        and priority = 'alta'),
    3, 'as 3 demandas ficaram com prioridade alta');

  -- Id de outro escritório é ignorado; só a própria muda → devolve 1.
  n := public.bulk_update_demands(
    v_a,
    array[tsta.id('d_prev_1'), tsta.id('d_b')],
    '{"priority":"urgente"}'::jsonb
  );
  perform tsta.eq(n, 1, 'id de outro escritório não conta como atualizado');
  perform tsta.eq(
    (select priority::text from public.demands where id = tsta.id('d_prev_1')),
    'urgente', 'demanda própria foi atualizada');

  -- Responsável ativo do escritório e limpeza do responsável.
  n := public.bulk_update_demands(
    v_a, array[tsta.id('d_prev_1')],
    jsonb_build_object('responsible_id', tsta.id('u_colleague'))
  );
  perform tsta.eq(n, 1, 'troca de responsável devolve 1');
  perform tsta.eq(
    (select responsible_id from public.demands where id = tsta.id('d_prev_1')),
    tsta.id('u_colleague'), 'responsável foi trocado');

  n := public.bulk_update_demands(v_a, array[tsta.id('d_prev_1')], '{"responsible_id": null}'::jsonb);
  perform tsta.eq(n, 1, 'limpar responsável devolve 1');
  perform tsta.ok(
    (select responsible_id is null from public.demands where id = tsta.id('d_prev_1')),
    'responsável ficou nulo');

  -- Etapa não final da mesma categoria: gatilho atualiza o histórico.
  n := public.bulk_update_demands(
    v_a, array[tsta.id('d_prev_2')],
    jsonb_build_object('stage_id', tsta.id('stage_prev_2'))
  );
  perform tsta.eq(n, 1, 'troca de etapa da mesma categoria devolve 1');
  perform tsta.eq(
    (select stage_id from public.demands where id = tsta.id('d_prev_2')),
    tsta.id('stage_prev_2'), 'demanda foi para a etapa nova');
  perform tsta.ok(
    exists (select 1 from public.demand_stage_history
             where demand_id = tsta.id('d_prev_2')
               and stage_id = tsta.id('stage_prev_2')
               and left_at is null),
    'gatilho abriu a passagem na etapa nova');

  -- Etapa final: gatilho conclui a demanda e preenche closed_at.
  n := public.bulk_update_demands(
    v_a, array[tsta.id('d_prev_3')],
    jsonb_build_object('stage_id', tsta.id('stage_prev_final'))
  );
  perform tsta.eq(n, 1, 'entrar na etapa final devolve 1');
  perform tsta.eq(
    (select status::text from public.demands where id = tsta.id('d_prev_3')),
    'concluida', 'gatilho da etapa final concluiu a demanda');
  perform tsta.ok(
    (select closed_at is not null from public.demands where id = tsta.id('d_prev_3')),
    'gatilho preencheu closed_at');

  -- Etapa de outra categoria: 22023 e NADA muda (nem a prioridade no mesmo patch).
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid, %L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), tsta.id('d_trab'),
           jsonb_build_object('priority', 'baixa', 'stage_id', tsta.id('stage_prev_1'))),
    '22023', '', 'etapa de outra categoria é recusada');
  perform tsta.eq(
    (select priority::text from public.demands where id = tsta.id('d_prev_1')),
    'urgente', 'patch inválido não alterou a prioridade');

  -- 201 ids → 22023 (limite é 200).
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array(select gen_random_uuid() from generate_series(1,201)), %L::jsonb)',
           v_a, '{"priority":"alta"}'),
    '22023', '', '201 ids é recusado');

  -- 0 ids → 22023 (mínimo é 1).
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[]::uuid[], %L::jsonb)',
           v_a, '{"priority":"alta"}'),
    '22023', '', 'lista vazia é recusada');

  -- Patch vazio, chave desconhecida e valor de prioridade inválido → 22023.
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), '{}'),
    '22023', '', 'patch vazio é recusado');
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), '{"foo":1}'),
    '22023', '', 'chave desconhecida é recusada');
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), '{"priority":"extrema"}'),
    '22023', '', 'prioridade inválida é recusada');

  -- Responsável que não é membro, membro inativo e escritório estranho → 22023.
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), jsonb_build_object('responsible_id', tsta.id('u_admin_b'))),
    '22023', '', 'responsável de outro escritório é recusado');
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('d_prev_1'), jsonb_build_object('responsible_id', tsta.id('u_inactive'))),
    '22023', '', 'responsável inativo é recusado');
end $$;

reset role;

-- Quem não é membro do escritório recebe 42501.
do $$ begin perform tsta.login('u_admin_b'); end $$;
do $$
begin
  perform tsta.expect_error_state(
    format('select public.bulk_update_demands(%L::uuid, array[%L::uuid], %L::jsonb)',
           tsta.id('org_a'), tsta.id('d_prev_1'), '{"priority":"alta"}'),
    '42501', '', 'não membro é recusado');
end $$;
reset role;

-- A demanda e a tarefa do escritório B continuam intactas (verificado como postgres).
do $$
begin
  perform tsta.eq(
    (select priority::text from public.demands where id = tsta.id('d_b')),
    'media', 'demanda do escritório B não mudou');
end $$;

-- =============================================================================
-- 3. bulk_update_tasks
-- =============================================================================
do $$ begin perform tsta.login('u_admin'); end $$;

do $$
declare
  v_a uuid := tsta.id('org_a');
  n int;
begin
  -- Concluir 2 tarefas: 2 linhas → devolve 2 e o gatilho preenche completed_at.
  n := public.bulk_update_tasks(
    v_a,
    array[tsta.id('t_1'), tsta.id('t_2')],
    '{"status":"concluida"}'::jsonb
  );
  perform tsta.eq(n, 2, 'concluir 2 tarefas devolve 2');
  perform tsta.eq(
    (select count(*)::int from public.tasks
      where id = any(array[tsta.id('t_1'), tsta.id('t_2')])
        and status = 'concluida'
        and completed_at is not null),
    2, 'as 2 tarefas ficaram concluídas com completed_at');

  -- Trocar responsável da tarefa 3.
  n := public.bulk_update_tasks(
    v_a, array[tsta.id('t_3')],
    jsonb_build_object('assignee_id', tsta.id('u_colleague'))
  );
  perform tsta.eq(n, 1, 'trocar responsável devolve 1');
  perform tsta.eq(
    (select assignee_id from public.tasks where id = tsta.id('t_3')),
    tsta.id('u_colleague'), 'responsável da tarefa foi trocado');

  -- Limpar o prazo.
  n := public.bulk_update_tasks(v_a, array[tsta.id('t_3')], '{"due_date": null}'::jsonb);
  perform tsta.eq(n, 1, 'limpar prazo devolve 1');
  perform tsta.ok(
    (select due_date is null from public.tasks where id = tsta.id('t_3')),
    'prazo da tarefa ficou nulo');

  -- Data inválida → 22023 e a tarefa 4 não muda.
  perform tsta.expect_error_state(
    format('select public.bulk_update_tasks(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('t_4'), '{"due_date":"2026-13-01"}'),
    '22023', '', 'data inválida é recusada');
  perform tsta.eq(
    (select due_date from public.tasks where id = tsta.id('t_4')),
    current_date + 4, 'data inválida não alterou o prazo da tarefa');
  perform tsta.eq(
    (select status::text from public.tasks where id = tsta.id('t_4')),
    'pendente', 'data inválida não alterou o status da tarefa');

  -- Ids misturados com outro escritório: só a própria muda → devolve 1.
  n := public.bulk_update_tasks(
    v_a,
    array[tsta.id('t_3'), tsta.id('t_b')],
    '{"status":"concluida"}'::jsonb
  );
  perform tsta.eq(n, 1, 'tarefa de outro escritório não conta como atualizada');

  -- Mesmas regras de validação: chave desconhecida/atribuído inválido → 22023.
  perform tsta.expect_error_state(
    format('select public.bulk_update_tasks(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('t_4'), '{"foo":1}'),
    '22023', '', 'chave desconhecida em tarefas é recusada');
  perform tsta.expect_error_state(
    format('select public.bulk_update_tasks(%L::uuid, array[%L::uuid], %L::jsonb)',
           v_a, tsta.id('t_4'), jsonb_build_object('assignee_id', tsta.id('u_admin_b'))),
    '22023', '', 'responsável de outro escritório em tarefa é recusado');
  perform tsta.expect_error_state(
    format('select public.bulk_update_tasks(%L::uuid, array(select gen_random_uuid() from generate_series(1,201)), %L::jsonb)',
           v_a, '{"status":"concluida"}'),
    '22023', '', '201 ids em tarefas é recusado');
end $$;

reset role;

do $$ begin perform tsta.login('u_admin_b'); end $$;
do $$
begin
  perform tsta.expect_error_state(
    format('select public.bulk_update_tasks(%L::uuid, array[%L::uuid], %L::jsonb)',
           tsta.id('org_a'), tsta.id('t_4'), '{"status":"concluida"}'),
    '42501', '', 'não membro não atualiza tarefas do escritório');
end $$;
reset role;

do $$
begin
  -- Tarefa do escritório B não mudou (verificado como postgres).
  perform tsta.eq(
    (select status::text from public.tasks where id = tsta.id('t_b')),
    'pendente', 'tarefa do escritório B não mudou');
  perform tsta.eq(
    (select assignee_id from public.tasks where id = tsta.id('t_b')),
    tsta.id('u_admin_b'), 'responsável da tarefa do escritório B não mudou');
end $$;

reset role;
do $$
begin
  raise warning 'saved_views_bulk_test.sql: % verificações do lote L13 OK',
    (select last_value from tsta.passed);
end $$;
rollback;
