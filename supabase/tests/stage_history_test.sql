-- =============================================================================
-- JurisFlow AI — Testes do lote L6: histórico de etapas e métricas operacionais
-- =============================================================================
-- Cobre: trigger de abertura/fechamento do histórico (criar, mudar etapa,
-- concluir, reabrir, cancelar), escrita direta bloqueada para authenticated,
-- backfill não é recriado aqui, public.operational_metrics com médias e
-- contagens conhecidas, p_days (filtro e validação 7..365) e isolamento por
-- escritório (42501).
-- Roda em transação desfeita no final (não deixa lixo).
-- Qualquer falha → raise exception 'FALHOU: ...' → psql para (ON_ERROR_STOP).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
-- "Hoje" do escritório = data em São Paulo (a função usa esse fuso).
set local timezone = 'America/Sao_Paulo';

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

grant usage on schema tsta to authenticated;
grant execute on all functions in schema tsta to authenticated;
grant usage, select on sequence tsta.passed to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures: dois escritórios, membros ativos/inativo e etapas controladas
-- -----------------------------------------------------------------------------
do $$
begin
  perform tsta.set_id('u_admin',    '00000000-0000-4000-9000-00000000c001');
  perform tsta.set_id('u_adv',      '00000000-0000-4000-9000-00000000c002');
  perform tsta.set_id('u_admin_b',  '00000000-0000-4000-9000-00000000c003');
  perform tsta.set_id('u_inactive', '00000000-0000-4000-9000-00000000c004');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'),    'l6.admin@teste.local',    '{"full_name":"Admin L6"}'),
    (tsta.id('u_adv'),      'l6.adv@teste.local',      '{"full_name":"Adv L6"}'),
    (tsta.id('u_admin_b'),  'l6.admin.b@teste.local',  '{"full_name":"Admin B L6"}'),
    (tsta.id('u_inactive'), 'l6.inactive@teste.local', '{"full_name":"Inativo L6"}');

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  perform tsta.set_id('org', public.create_organization('Escritório L6'));
  insert into organization_members (organization_id, user_id, role)
  values (tsta.id('org'), tsta.id('u_adv'), 'advogado');
  insert into organization_members (organization_id, user_id, role, active)
  values (tsta.id('org'), tsta.id('u_inactive'), 'assistente', false);

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_b'))::text, true);
  perform tsta.set_id('org_b', public.create_organization('Escritório L6 B'));

  -- Etapas padrão da categoria "Outros" para os testes do trigger.
  perform tsta.set_id('stage_s1', (select id from workflow_stages
                                    where organization_id = tsta.id('org') and name = 'A fazer'));
  perform tsta.set_id('stage_s2', (select id from workflow_stages
                                    where organization_id = tsta.id('org') and name = 'Em andamento'
                                      and category_id = (select category_id from workflow_stages where id = tsta.id('stage_s1'))));
  perform tsta.set_id('stage_s3', (select id from workflow_stages
                                    where organization_id = tsta.id('org') and name = 'Aguardando documentação'
                                      and category_id = (select category_id from workflow_stages where id = tsta.id('stage_s1'))));
  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  o uuid := tsta.id('org');
  v_cat uuid;
  v_stage uuid;
  v_cli uuid;
  v_d uuid;
begin
  -- Categorias/etapas exclusivas do lote, com nomes únicos, para controlar
  -- médias e contagens sem depender dos fluxos padrão.
  insert into demand_categories (organization_id, name, color, sort_order)
  values (o, 'L6 Abertas', '#111111', 100) returning id into v_cat;
  perform tsta.set_id('cat_abertas', v_cat);
  insert into workflow_stages (organization_id, category_id, name, position)
  values (o, v_cat, 'L6 Aberta A', 0) returning id into v_stage;
  perform tsta.set_id('stage_ab_a', v_stage);
  insert into workflow_stages (organization_id, category_id, name, position)
  values (o, v_cat, 'L6 Aberta B', 1) returning id into v_stage;
  perform tsta.set_id('stage_ab_b', v_stage);

  insert into demand_categories (organization_id, name, color, sort_order)
  values (o, 'L6 Concluidas', '#222222', 101) returning id into v_cat;
  perform tsta.set_id('cat_concluidas', v_cat);
  insert into workflow_stages (organization_id, category_id, name, position)
  values (o, v_cat, 'L6 Passo A', 0) returning id into v_stage;
  perform tsta.set_id('stage_pa', v_stage);
  insert into workflow_stages (organization_id, category_id, name, position)
  values (o, v_cat, 'L6 Passo B', 1) returning id into v_stage;
  perform tsta.set_id('stage_pb', v_stage);

  insert into clients (organization_id, full_name) values (o, 'Cliente L6') returning id into v_cli;
  perform tsta.set_id('cli', v_cli);

  -- Abertas (contagens e idades):
  --   L6 Aberta A: 2 abertas, idades 40 e 10 → média 25, mais antiga 40.
  --   L6 Aberta B: 2 abertas, idades 20 e 60 → média 40, mais antiga 60.
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o, v_cli, tsta.id('cat_abertas'), tsta.id('stage_ab_a'), 'L6 aberta A1',
          'em_andamento', tsta.id('u_admin'), current_date + 1)
  returning id into v_d;
  perform tsta.set_id('d_oa1', v_d);

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o, v_cli, tsta.id('cat_abertas'), tsta.id('stage_ab_a'), 'L6 aberta A2',
          'em_andamento', tsta.id('u_admin'), current_date - 2)
  returning id into v_d;
  perform tsta.set_id('d_oa2', v_d);

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o, v_cli, tsta.id('cat_abertas'), tsta.id('stage_ab_b'), 'L6 aberta B1',
          'em_andamento', tsta.id('u_adv'), current_date - 1)
  returning id into v_d;
  perform tsta.set_id('d_ob1', v_d);

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o, v_cli, tsta.id('cat_abertas'), tsta.id('stage_ab_b'), 'L6 aberta B2',
          'em_andamento', tsta.id('u_adv'), null)
  returning id into v_d;
  perform tsta.set_id('d_ob2', v_d);

  -- Concluídas: cada uma passa por Passo A e depois Passo B (finalizada por status).
  -- Ajustamos os tempos depois como postgres.
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o, v_cli, tsta.id('cat_concluidas'), tsta.id('stage_pa'), 'L6 concluída 1',
          'em_andamento', tsta.id('u_admin'))
  returning id into v_d;
  perform tsta.set_id('d_c1', v_d);
  update demands set stage_id = tsta.id('stage_pb') where id = v_d;
  update demands set status = 'concluida' where id = v_d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o, v_cli, tsta.id('cat_concluidas'), tsta.id('stage_pa'), 'L6 concluída 2',
          'em_andamento', tsta.id('u_admin'))
  returning id into v_d;
  perform tsta.set_id('d_c2', v_d);
  update demands set stage_id = tsta.id('stage_pb') where id = v_d;
  update demands set status = 'concluida' where id = v_d;

  -- Idades das abertas (em dias exatos, para qualquer forma de cálculo).
  update demand_stage_history set entered_at = now() - interval '40 days'
   where demand_id = tsta.id('d_oa1') and left_at is null;
  update demand_stage_history set entered_at = now() - interval '10 days'
   where demand_id = tsta.id('d_oa2') and left_at is null;
  update demand_stage_history set entered_at = now() - interval '20 days'
   where demand_id = tsta.id('d_ob1') and left_at is null;
  update demand_stage_history set entered_at = now() - interval '60 days'
   where demand_id = tsta.id('d_ob2') and left_at is null;

  -- Passagens concluídas:
  --   Passo A: 30 e 50 dias → média 40; left_at 30 dias atrás (dentro de 90).
  --   Passo B: 20 e 25 dias → média 22,5; left_at 10 e 5 dias atrás.
  update demand_stage_history
     set entered_at = now() - interval '60 days',
         left_at = now() - interval '30 days'
   where demand_id = tsta.id('d_c1') and stage_id = tsta.id('stage_pa');
  update demand_stage_history
     set entered_at = now() - interval '80 days',
         left_at = now() - interval '30 days'
   where demand_id = tsta.id('d_c2') and stage_id = tsta.id('stage_pa');
  update demand_stage_history
     set entered_at = now() - interval '30 days',
         left_at = now() - interval '10 days'
   where demand_id = tsta.id('d_c1') and stage_id = tsta.id('stage_pb');
  update demand_stage_history
     set entered_at = now() - interval '30 days',
         left_at = now() - interval '5 days'
   where demand_id = tsta.id('d_c2') and stage_id = tsta.id('stage_pb');

  -- Carga: Admin L6 = 3 tarefas abertas (1 atrasada); Adv L6 = 3 abertas
  -- (2 atrasadas); Inativo L6 tem 1 atrasada mas não deve aparecer.
  insert into tasks (organization_id, assignee_id, title, due_date, status) values
    (o, tsta.id('u_admin'), 'L6 admin atrasada', current_date - 1, 'pendente'),
    (o, tsta.id('u_admin'), 'L6 admin futura',   current_date + 3, 'em_andamento'),
    (o, tsta.id('u_admin'), 'L6 admin sem prazo', null,           'pendente'),
    (o, tsta.id('u_admin'), 'L6 admin concluída', current_date - 5, 'concluida'),
    (o, tsta.id('u_adv'),   'L6 adv atrasada 1', current_date - 5, 'pendente'),
    (o, tsta.id('u_adv'),   'L6 adv atrasada 2', current_date - 1, 'em_andamento'),
    (o, tsta.id('u_adv'),   'L6 adv futura',     current_date + 2, 'pendente'),
    (o, tsta.id('u_adv'),   'L6 adv concluída',  current_date - 4, 'concluida'),
    (o, tsta.id('u_inactive'), 'L6 inativo atrasada', current_date - 1, 'pendente');
end $$;

-- =============================================================================
-- 1. Trigger: criar abre; mudar etapa fecha e abre; concluir fecha sem abrir;
--    reabrir abre; cancelar fecha sem abrir.
-- =============================================================================
savepoint trigger_tests;
do $$
declare
  o uuid := tsta.id('org');
  cli uuid := tsta.id('cli');
  cat uuid := (select category_id from workflow_stages where id = tsta.id('stage_s1'));
  d uuid;
  d2 uuid;
  h_open int;
  h_total int;
  v_stage uuid;
  v_entered_match boolean;
  v_left timestamptz;
  v_closed timestamptz;
begin
  insert into demands (organization_id, client_id, category_id, stage_id, title, status)
  values (o, cli, cat, tsta.id('stage_s1'), 'Demanda trigger', 'em_andamento')
  returning id into d;

  select count(*) into h_open from demand_stage_history where demand_id = d and left_at is null;
  perform tsta.eq(h_open, 1, 'criar demanda abre uma linha de histórico');

  select h.entered_at = dm.stage_changed_at into v_entered_match
    from demand_stage_history h
    join demands dm on dm.id = h.demand_id
   where h.demand_id = d and h.left_at is null;
  perform tsta.eq(v_entered_match, true, 'histórico nasce com entered_at = stage_changed_at');

  select stage_id into v_stage from demand_stage_history where demand_id = d and left_at is null;
  perform tsta.eq(v_stage, tsta.id('stage_s1'), 'histórico nasce com a etapa atual');

  -- Mudança de etapa: fecha a aberta e abre outra.
  update demands set stage_id = tsta.id('stage_s2') where id = d;
  select count(*) into h_total from demand_stage_history where demand_id = d;
  select count(*) into h_open from demand_stage_history where demand_id = d and left_at is null;
  perform tsta.eq(h_total, 2, 'mudar de etapa cria uma nova passagem');
  perform tsta.eq(h_open, 1, 'só uma linha aberta por demanda');
  select stage_id into v_stage from demand_stage_history where demand_id = d and left_at is null;
  perform tsta.eq(v_stage, tsta.id('stage_s2'), 'nova linha usa a etapa nova');
  perform tsta.ok(
    (select left_at is not null from demand_stage_history
      where demand_id = d and stage_id = tsta.id('stage_s1')),
    'passagem anterior fica fechada');

  -- Conclusão: fecha a aberta e não abre outra.
  update demands set status = 'concluida' where id = d;
  select count(*) into h_open from demand_stage_history where demand_id = d and left_at is null;
  select count(*) into h_total from demand_stage_history where demand_id = d;
  perform tsta.eq(h_open, 0, 'concluir fecha a linha aberta');
  perform tsta.eq(h_total, 2, 'concluir não abre outra linha');

  select dm.closed_at, h.left_at into v_closed, v_left
    from demands dm
    join demand_stage_history h on h.demand_id = dm.id
   where dm.id = d and h.stage_id = tsta.id('stage_s2');
  perform tsta.ok(v_left is not null, 'linha fechada tem left_at');
  perform tsta.ok(v_left >= v_closed, 'left_at não é anterior ao closed_at');

  -- Reabertura: abre uma linha nova, mantendo a etapa.
  update demands set status = 'em_andamento' where id = d;
  select count(*) into h_open from demand_stage_history where demand_id = d and left_at is null;
  select count(*) into h_total from demand_stage_history where demand_id = d;
  perform tsta.eq(h_open, 1, 'reabrir abre nova linha');
  perform tsta.eq(h_total, 3, 'reabrir acrescenta uma linha');
  select stage_id into v_stage from demand_stage_history where demand_id = d and left_at is null;
  perform tsta.eq(v_stage, tsta.id('stage_s2'), 'reabrir mantém a etapa');

  -- Cancelamento: fecha e não abre.
  insert into demands (organization_id, client_id, category_id, stage_id, title, status)
  values (o, cli, cat, tsta.id('stage_s1'), 'Demanda cancelada trigger', 'em_andamento')
  returning id into d2;
  update demands set status = 'cancelada' where id = d2;
  select count(*) into h_open from demand_stage_history where demand_id = d2 and left_at is null;
  select count(*) into h_total from demand_stage_history where demand_id = d2;
  perform tsta.eq(h_open, 0, 'cancelar fecha a linha aberta');
  perform tsta.eq(h_total, 1, 'cancelar não abre outra linha');
end $$;
rollback to savepoint trigger_tests;

-- =============================================================================
-- 2. operational_metrics: etapas, gargalos e carga com dados conhecidos
-- =============================================================================
do $$
declare
  m jsonb;
  v jsonb;
begin
  perform tsta.login('u_admin');
  m := public.operational_metrics(tsta.id('org'));

  perform tsta.ok(m is not null, 'operational_metrics devolve jsonb');
  perform tsta.eq(jsonb_typeof(m->'stages'), 'array', 'stages é array');
  perform tsta.eq(jsonb_typeof(m->'bottlenecks'), 'array', 'bottlenecks é array');
  perform tsta.eq(jsonb_typeof(m->'workload'), 'array', 'workload é array');

  -- Etapas ordenadas por categoria e posição (apenas as do lote).
  perform tsta.eq(
    (select array_agg(e->>'name' order by ord)
       from jsonb_array_elements(m->'stages') with ordinality x(e, ord)
      where e->>'category_name' like 'L6 %'),
    array['L6 Aberta A', 'L6 Aberta B', 'L6 Passo A', 'L6 Passo B'],
    'etapas ordenadas por categoria e posição');

  -- L6 Aberta A: 2 abertas, idades 40 e 10 → média 25, mais antiga 40.
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Aberta A';
  perform tsta.ok(v is not null, 'etapa L6 Aberta A presente');
  perform tsta.eq(v->>'category_name', 'L6 Abertas', 'nome da categoria da etapa');
  perform tsta.eq((v->>'position')::int, 0, 'posição da etapa');
  perform tsta.eq((v->>'open_now')::int, 2, 'L6 Aberta A: 2 abertas agora');
  perform tsta.eq((v->>'avg_age_open_days')::numeric, 25::numeric, 'L6 Aberta A: média (40+10)/2 = 25 dias');
  perform tsta.eq((v->>'oldest_open_days')::int, 40, 'L6 Aberta A: mais antiga = 40 dias');
  perform tsta.eq((v->>'passes_completed')::int, 0, 'L6 Aberta A: nenhuma passagem concluída');
  perform tsta.ok((v->>'avg_days_completed') is null, 'L6 Aberta A: tempo médio nulo sem passagens');

  -- L6 Aberta B: 2 abertas, idades 20 e 60 → média 40, mais antiga 60.
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Aberta B';
  perform tsta.eq((v->>'open_now')::int, 2, 'L6 Aberta B: 2 abertas agora');
  perform tsta.eq((v->>'avg_age_open_days')::numeric, 40::numeric, 'L6 Aberta B: média (20+60)/2 = 40 dias');
  perform tsta.eq((v->>'oldest_open_days')::int, 60, 'L6 Aberta B: mais antiga = 60 dias');

  -- L6 Passo A: passagens de 30 e 50 dias → média 40, contagem 2.
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Passo A';
  perform tsta.eq((v->>'open_now')::int, 0, 'L6 Passo A: nenhuma aberta agora');
  perform tsta.ok((v->>'avg_age_open_days') is null, 'L6 Passo A: idade média nula sem abertas');
  perform tsta.ok((v->>'oldest_open_days') is null, 'L6 Passo A: mais antiga nula sem abertas');
  perform tsta.eq((v->>'passes_completed')::int, 2, 'L6 Passo A: 2 passagens encerradas');
  perform tsta.eq((v->>'avg_days_completed')::numeric, 40::numeric, 'L6 Passo A: média (30+50)/2 = 40 dias');

  -- L6 Passo B: passagens de 20 e 25 dias → média 22,5.
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Passo B';
  perform tsta.eq((v->>'passes_completed')::int, 2, 'L6 Passo B: 2 passagens encerradas');
  perform tsta.eq((v->>'avg_days_completed')::numeric, 22.5::numeric, 'L6 Passo B: média (20+25)/2 = 22,5 dias');

  -- Gargalos: só etapas com abertas; empate em 2 abertas desempatado pela idade.
  perform tsta.eq(jsonb_array_length(m->'bottlenecks'), 2, 'gargalos só de etapas com abertas');
  perform tsta.eq(
    (select array_agg(e->>'name' order by ord)
       from jsonb_array_elements(m->'bottlenecks') with ordinality x(e, ord)),
    array['L6 Aberta B', 'L6 Aberta A'],
    'gargalos ordenados por abertas; empate pela idade média desc');

  -- Carga - Admin L6: 2 demandas abertas, 3 tarefas abertas, 1 atrasada,
  -- 1 próxima ação vencida (A2 venceu há 2 dias; A1 vence amanhã).
  -- As demandas concluídas dele não contam.
  select e into v from jsonb_array_elements(m->'workload') e
   where e->>'user_id' = tsta.id('u_admin')::text;
  perform tsta.ok(v is not null, 'Admin L6 aparece na carga');
  perform tsta.eq(v->>'name', 'Admin L6', 'nome do responsável');
  perform tsta.eq((v->>'open_demands')::int, 2, 'Admin L6: 2 demandas abertas (concluídas fora)');
  perform tsta.eq((v->>'open_tasks')::int, 3, 'Admin L6: 3 tarefas abertas');
  perform tsta.eq((v->>'overdue_tasks')::int, 1, 'Admin L6: 1 tarefa atrasada');
  perform tsta.eq((v->>'next_actions_overdue')::int, 1, 'Admin L6: 1 próxima ação vencida');

  -- Carga - Adv L6: 2 demandas abertas, 3 tarefas abertas, 2 atrasadas.
  select e into v from jsonb_array_elements(m->'workload') e
   where e->>'user_id' = tsta.id('u_adv')::text;
  perform tsta.ok(v is not null, 'Adv L6 aparece na carga');
  perform tsta.eq((v->>'open_demands')::int, 2, 'Adv L6: 2 demandas abertas');
  perform tsta.eq((v->>'open_tasks')::int, 3, 'Adv L6: 3 tarefas abertas');
  perform tsta.eq((v->>'overdue_tasks')::int, 2, 'Adv L6: 2 tarefas atrasadas');
  perform tsta.eq((v->>'next_actions_overdue')::int, 1, 'Adv L6: 1 próxima ação vencida');

  -- Ordenação: mais atrasadas primeiro; inativo de fora.
  perform tsta.eq(
    (select array_agg(e->>'name' order by ord)
       from jsonb_array_elements(m->'workload') with ordinality x(e, ord)),
    array['Adv L6', 'Admin L6'],
    'carga ordenada por tarefas atrasadas desc');
  perform tsta.ok(
    not exists (select 1 from jsonb_array_elements(m->'workload') e
                 where e->>'user_id' = tsta.id('u_inactive')::text),
    'membro inativo fica fora da carga');

  -- p_days = 15: só passagens encerradas nos últimos 15 dias.
  -- L6 Passo A (left_at 30 dias atrás) some; L6 Passo B (10 e 5 dias) fica.
  m := public.operational_metrics(tsta.id('org'), 15);
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Passo A';
  perform tsta.eq((v->>'passes_completed')::int, 0, 'p_days=15 exclui passagem encerrada há 30 dias');
  perform tsta.ok((v->>'avg_days_completed') is null, 'p_days=15 zera a média de L6 Passo A');
  select e into v from jsonb_array_elements(m->'stages') e where e->>'name' = 'L6 Passo B';
  perform tsta.eq((v->>'passes_completed')::int, 2, 'p_days=15 mantém passagens encerradas há 10 e 5 dias');
  perform tsta.eq((v->>'avg_days_completed')::numeric, 22.5::numeric, 'p_days=15 mantém a média de L6 Passo B');

  -- Limites válidos de p_days (7 e 365) não recusam.
  perform tsta.ok(public.operational_metrics(tsta.id('org'), 7) is not null, 'p_days=7 é aceito');
  perform tsta.ok(public.operational_metrics(tsta.id('org'), 365) is not null, 'p_days=365 é aceito');

  reset role;
end $$;

-- =============================================================================
-- 3. p_days fora de 7..365 → 22023; outro escritório → 42501
-- =============================================================================
do $$
begin
  perform tsta.login('u_admin');
  perform tsta.expect_error_state(
    format('select public.operational_metrics(%L, 6)', tsta.id('org')),
    '22023', '', 'p_days menor que 7 é recusado');
  perform tsta.expect_error_state(
    format('select public.operational_metrics(%L, 366)', tsta.id('org')),
    '22023', '', 'p_days maior que 365 é recusado');
  reset role;
end $$;

do $$
begin
  perform tsta.login('u_admin_b');
  perform tsta.expect_error_state(
    format('select public.operational_metrics(%L)', tsta.id('org')),
    '42501', '', 'operational_metrics de outro escritório é recusado');
  reset role;
end $$;

-- =============================================================================
-- 4. Escrita direta no histórico: membro lê, mas não insere nem altera
--    (42501 ou 0 linhas, conforme o caminho de bloqueio).
-- =============================================================================
savepoint escrita;
do $$
declare
  v_rows int;
  v_state text;
begin
  perform tsta.login('u_admin');

  perform tsta.ok(
    (select count(*) from public.demand_stage_history where organization_id = tsta.id('org')) > 0,
    'membro lê o histórico pela RLS');

  begin
    insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
    values (tsta.id('org'), tsta.id('d_c1'), tsta.id('stage_pa'), now());
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform tsta.eq(v_state, '42501', 'insert direto no histórico é recusado');

  begin
    update public.demand_stage_history set entered_at = now()
     where organization_id = tsta.id('org') and demand_id = tsta.id('d_c1');
    get diagnostics v_rows = row_count;
    v_state := null;
  exception when others then
    v_state := sqlstate;
    v_rows := null;
  end;
  perform tsta.ok(
    v_state = '42501' or (v_state is null and v_rows = 0),
    'update direto no histórico é recusado ou não afeta linhas');

  reset role;
end $$;
rollback to savepoint escrita;

reset role;
do $$ begin
  raise warning 'stage_history_test.sql: % verificações do lote L6 OK', (select last_value from tsta.passed);
end $$;
rollback;
