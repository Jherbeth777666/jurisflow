-- =============================================================================
-- JurisFlow AI — Testes do lote L5: ficha 360° do cliente (public.client_overview)
-- =============================================================================
-- Cobre: demandas abertas (concluída/cancelada fora), checklist pendente,
-- tarefas abertas/atrasadas, financeiro (paga/cancelada fora), última
-- movimentação, limites de 20 demandas / 15 itens e isolamento por escritório.
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
-- Fixtures: dois escritórios, dois clientes no escritório A
-- -----------------------------------------------------------------------------
do $$
begin
  perform tsta.set_id('u_admin', '00000000-0000-4000-9000-00000000b001');
  perform tsta.set_id('u_adv',   '00000000-0000-4000-9000-00000000b002');
  perform tsta.set_id('u_admin_b','00000000-0000-4000-9000-00000000b003');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'),   'overview.admin@teste.local',   '{"full_name":"Admin Overview"}'),
    (tsta.id('u_adv'),     'overview.adv@teste.local',     '{"full_name":"Adv Overview"}'),
    (tsta.id('u_admin_b'), 'overview.admin.b@teste.local', '{"full_name":"Admin B"}');

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  perform tsta.set_id('org', public.create_organization('Escritório Overview'));
  insert into organization_members (organization_id, user_id, role)
  values (tsta.id('org'), tsta.id('u_adv'), 'advogado');

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_b'))::text, true);
  perform tsta.set_id('org_b', public.create_organization('Escritório Overview B'));

  perform tsta.set_id('cat', (select id from demand_categories
                               where organization_id = tsta.id('org') and name = 'Outros'));
  perform tsta.set_id('cat_b', (select id from demand_categories
                                 where organization_id = tsta.id('org_b') and name = 'Outros'));
  perform tsta.set_id('stage_em_andamento', (select id from workflow_stages
                                              where category_id = tsta.id('cat') and name = 'Em andamento'));
  perform tsta.set_id('stage_aguardando', (select id from workflow_stages
                                            where category_id = tsta.id('cat') and name = 'Aguardando documentação'));
  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  o uuid := tsta.id('org');
  cat uuid := tsta.id('cat');
  v_cli uuid;
  v_cli_other uuid;
  v_cli_b uuid;
  v_d uuid;
  v_task uuid;
  v_con uuid;
  v_inst uuid;
begin
  insert into clients (organization_id, full_name) values (o, 'Cliente Overview') returning id into v_cli;
  insert into clients (organization_id, full_name) values (o, 'Outro Cliente') returning id into v_cli_other;
  insert into clients (organization_id, full_name) values (tsta.id('org_b'), 'Cliente B') returning id into v_cli_b;
  perform tsta.set_id('cli', v_cli);
  perform tsta.set_id('cli_other', v_cli_other);
  perform tsta.set_id('cli_b', v_cli_b);

  -- Demanda aberta A: etapa há 5 dias, próxima ação vencida há 3 dias.
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       next_action, next_action_date, opened_at, created_at)
  values (o, v_cli, cat, tsta.id('stage_em_andamento'), 'Demanda aberta A', 'em_andamento',
          'Protocolar contestação', current_date - 3, current_date - 40, '2026-06-01T12:00:00Z')
  returning id into v_d;
  perform tsta.set_id('d_open1', v_d);
  -- A trigger de INSERT reescreve stage_changed_at; fixamos a data depois.
  update demands
     set stage_changed_at = ((current_date - 5)::timestamp + time '12:00')
                            at time zone 'America/Sao_Paulo'
   where id = v_d;

  -- Demanda aberta B: mais recente, próxima ação para hoje (não atrasada).
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       next_action, next_action_date, opened_at, created_at)
  values (o, v_cli, cat, tsta.id('stage_aguardando'), 'Demanda aberta B', 'aguardando_cliente',
          'Ligar para o cliente', current_date, current_date - 5, '2026-07-01T12:00:00Z')
  returning id into v_d;
  perform tsta.set_id('d_open2', v_d);

  -- Concluída e cancelada: não entram em open_demands nem nos documentos pendentes.
  insert into demands (organization_id, client_id, category_id, title, status, opened_at, created_at)
  values (o, v_cli, cat, 'Demanda concluída', 'concluida', current_date - 60, '2026-05-01T12:00:00Z')
  returning id into v_d;
  perform tsta.set_id('d_done', v_d);

  insert into demands (organization_id, client_id, category_id, title, status, opened_at, created_at)
  values (o, v_cli, cat, 'Demanda cancelada', 'cancelada', current_date - 50, '2026-04-01T12:00:00Z')
  returning id into v_d;
  perform tsta.set_id('d_cancel', v_d);

  -- Demanda de outro cliente: não pode vazar para a ficha do Cliente Overview.
  insert into demands (organization_id, client_id, category_id, title, status, opened_at, created_at)
  values (o, v_cli_other, cat, 'Demanda de outro cliente', 'em_andamento',
          current_date - 20, '2026-03-01T12:00:00Z')
  returning id into v_d;
  perform tsta.set_id('d_other', v_d);

  -- Checklist: A tem 5 itens (3 feitos, 2 pendentes); B tem 3 itens
  -- (1 feito, 2 pendentes); a concluída tem 1 item pendente que não aparece.
  insert into demand_checklist_items (organization_id, demand_id, label, done, position) values
    (o, tsta.id('d_open1'), 'Documento feito 1',           true,  0),
    (o, tsta.id('d_open1'), 'Documento feito 2',           true,  1),
    (o, tsta.id('d_open1'), 'Documento feito 3',           true,  2),
    (o, tsta.id('d_open1'), 'RG',                          false, 3),
    (o, tsta.id('d_open1'), 'Comprovante de residência',   false, 4),
    (o, tsta.id('d_open2'), 'Procuração',                  true,  0),
    (o, tsta.id('d_open2'), 'Carteira de trabalho',        false, 1),
    (o, tsta.id('d_open2'), 'Holerite',                    false, 2),
    (o, tsta.id('d_done'),  'Item pendente de concluída',  false, 0);

  -- Tarefas: 2 abertas (1 atrasada), 1 concluída e 1 cancelada (fora);
  -- tarefa de outro cliente também fora.
  insert into tasks (organization_id, client_id, demand_id, title, due_date, status)
  values (o, v_cli, tsta.id('d_open2'), 'Tarefa futura', current_date + 2, 'pendente')
  returning id into v_task;
  perform tsta.set_id('task_future', v_task);

  insert into tasks (organization_id, client_id, demand_id, title, due_date, status)
  values (o, v_cli, tsta.id('d_open1'), 'Tarefa atrasada', current_date - 2, 'em_andamento')
  returning id into v_task;
  perform tsta.set_id('task_overdue', v_task);

  insert into tasks (organization_id, client_id, demand_id, title, due_date, status)
  values (o, v_cli, tsta.id('d_open1'), 'Tarefa concluída', current_date - 9, 'concluida');
  insert into tasks (organization_id, client_id, demand_id, title, due_date, status)
  values (o, v_cli, tsta.id('d_open2'), 'Tarefa cancelada', current_date, 'cancelada');
  insert into tasks (organization_id, client_id, demand_id, title, due_date, status)
  values (o, v_cli_other, tsta.id('d_other'), 'Tarefa de outro cliente', current_date - 1, 'pendente')
  returning id into v_task;
  perform tsta.set_id('task_other', v_task);

  -- Financeiro:
  --   contrato principal 3 x 100. Parcela 1 vencida há 30 dias (100 em aberto);
  --   parcela 2 vencida há 10 dias com 40 pagos → saldo 60; parcela 3 a vencer
  --   em 20 dias (100). Em aberto = 100 + 60 + 100 = 260; vencido = 100 + 60 = 160.
  --   contrato pago (50) e contrato cancelado (70) ficam de fora.
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 300, 3, current_date - 30) returning id into v_con;
  perform tsta.set_id('con_main', v_con);
  update installments set due_date = current_date - 30 where contract_id = v_con and number = 1;
  update installments set due_date = current_date - 10 where contract_id = v_con and number = 2;
  update installments set due_date = current_date + 20 where contract_id = v_con and number = 3;
  select id into v_inst from installments where contract_id = v_con and number = 2;
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (o, v_con, v_inst, 40);

  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 50, 1, current_date - 5) returning id into v_con;
  perform tsta.set_id('con_paid', v_con);
  select id into v_inst from installments where contract_id = v_con and number = 1;
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (o, v_con, v_inst, 50);

  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 70, 1, current_date + 2) returning id into v_con;
  perform tsta.set_id('con_cancel', v_con);
  update contracts set status = 'cancelado' where id = v_con;

  -- Última movimentação: a maior entre cliente, demandas e tarefas do cliente.
  -- O log de outro cliente (2030-01-04) e o de tarefa de outro cliente
  -- (2030-01-05) não podem ser considerados; o esperado é 2030-01-03.
  insert into activity_logs (organization_id, entity_type, entity_id, action, created_at) values
    (o, 'clients', v_cli,                            'updated', '2030-01-01T10:00:00Z'),
    (o, 'demands', tsta.id('d_open1'),               'updated', '2030-01-02T10:00:00Z'),
    (o, 'tasks',   tsta.id('task_future'),           'updated', '2030-01-03T10:00:00Z'),
    (o, 'demands', tsta.id('d_other'),               'updated', '2030-01-04T10:00:00Z'),
    (o, 'tasks',   tsta.id('task_other'),            'updated', '2030-01-05T10:00:00Z');
end $$;

-- =============================================================================
-- 1. Contagens e campos com dados conhecidos
-- =============================================================================
do $$
declare
  cli uuid := tsta.id('cli');
  ov jsonb;
  v jsonb;
begin
  perform tsta.login('u_admin');
  ov := public.client_overview(cli);

  perform tsta.ok(ov is not null, 'a função devolve jsonb');
  perform tsta.eq(jsonb_typeof(ov->'open_demands'), 'array', 'open_demands é array');
  perform tsta.eq(jsonb_typeof(ov->'checklist_pending_items'), 'array', 'checklist_pending_items é array');
  perform tsta.eq(jsonb_typeof(ov->'tasks'), 'object', 'tasks é objeto');
  perform tsta.eq(jsonb_typeof(ov->'finance'), 'object', 'finance é objeto');

  -- Demandas: só as 2 abertas; a mais recente primeiro.
  perform tsta.eq(jsonb_array_length(ov->'open_demands'), 2, 'só demandas não concluídas/canceladas');
  perform tsta.eq(ov->'open_demands'->0->>'title', 'Demanda aberta B', 'demanda mais recente primeiro');

  select e into v from jsonb_array_elements(ov->'open_demands') e
   where e->>'id' = tsta.id('d_open1')::text;
  perform tsta.ok(v is not null, 'demanda A presente em open_demands');
  perform tsta.eq(v->>'title', 'Demanda aberta A', 'open_demands: título');
  perform tsta.eq(v->>'status', 'em_andamento', 'open_demands: status');
  perform tsta.eq(v->>'stage_name', 'Em andamento', 'open_demands: etapa');
  perform tsta.eq(v->>'category_name', 'Outros', 'open_demands: categoria');
  perform tsta.eq(v->>'next_action', 'Protocolar contestação', 'open_demands: próxima ação');
  perform tsta.eq((v->>'next_action_date')::date, current_date - 3, 'open_demands: data da próxima ação');
  perform tsta.eq((v->>'next_action_overdue')::boolean, true, 'open_demands: próxima ação atrasada');
  perform tsta.eq((v->>'checklist_pending')::int, 2, 'open_demands: checklist pendente = 2');
  perform tsta.eq((v->>'checklist_total')::int, 5, 'open_demands: checklist total = 5');
  perform tsta.eq((v->>'days_in_stage')::int, 5, 'open_demands: 5 dias na etapa');

  select e into v from jsonb_array_elements(ov->'open_demands') e
   where e->>'id' = tsta.id('d_open2')::text;
  perform tsta.ok(v is not null, 'demanda B presente em open_demands');
  perform tsta.eq((v->>'next_action_overdue')::boolean, false, 'próxima ação de hoje não está atrasada');
  perform tsta.eq((v->>'checklist_pending')::int, 2, 'open_demands: item feito não conta como pendente');
  perform tsta.eq((v->>'checklist_total')::int, 3, 'open_demands: total do checklist de B');

  -- Checklist pendente: só itens não feitos de demandas abertas,
  -- agrupados por demanda e em ordem de posição dentro de cada uma.
  perform tsta.eq(jsonb_array_length(ov->'checklist_pending_items'), 4, 'só itens pendentes de demandas abertas');
  perform tsta.eq(
    (select array_agg(e->>'label' order by ord)
       from jsonb_array_elements(ov->'checklist_pending_items') with ordinality as x(e, ord)
      where e->>'demand_id' = tsta.id('d_open1')::text),
    array['RG', 'Comprovante de residência'],
    'itens de A na ordem de posição');
  perform tsta.eq(
    (select array_agg(e->>'label' order by ord)
       from jsonb_array_elements(ov->'checklist_pending_items') with ordinality as x(e, ord)
      where e->>'demand_id' = tsta.id('d_open2')::text),
    array['Carteira de trabalho', 'Holerite'],
    'itens de B na ordem de posição');
  perform tsta.eq(
    (select count(*) from (
       select e->>'demand_id' as demand_id,
              lag(e->>'demand_id') over (order by ord) as previous
         from jsonb_array_elements(ov->'checklist_pending_items') with ordinality as x(e, ord)) s
      where previous is not null and demand_id <> previous),
    1::bigint, 'itens agrupados por demanda');
  select e into v from jsonb_array_elements(ov->'checklist_pending_items') e
   where e->>'label' = 'RG';
  perform tsta.eq(v->>'demand_id', tsta.id('d_open1')::text, 'item pendente: demanda');
  perform tsta.eq(v->>'demand_title', 'Demanda aberta A', 'item pendente: título da demanda');

  -- Tarefas: 2 abertas, 1 atrasada; o próximo vencimento é o menor entre as abertas.
  perform tsta.eq((ov->'tasks'->>'open')::int, 2, 'tarefas abertas = 2');
  perform tsta.eq((ov->'tasks'->>'overdue')::int, 1, 'tarefas atrasadas = 1');
  perform tsta.eq((ov->'tasks'->>'next_due_date')::date, current_date - 2,
                  'tarefas: próximo vencimento = menor data das abertas');

  -- Financeiro (conta à mão: 100 + (100 - 40) + 100 = 260; vencido 100 + 60 = 160).
  perform tsta.eq((ov->'finance'->>'open_amount')::numeric, 260.00::numeric,
                  'financeiro em aberto = 100 + 60 + 100');
  perform tsta.eq((ov->'finance'->>'overdue_amount')::numeric, 160.00::numeric,
                  'financeiro vencido = 100 + 60');
  perform tsta.eq((ov->'finance'->>'overdue_count')::int, 2, 'parcelas vencidas = 2');
  perform tsta.eq((ov->'finance'->>'next_due_date')::date, current_date - 30,
                  'financeiro: próximo vencimento = parcela mais antiga em aberto');

  -- Última movimentação: maior created_at entre cliente, suas demandas e tarefas.
  perform tsta.eq((ov->>'last_activity_at')::timestamptz, '2030-01-03T10:00:00Z'::timestamptz,
                  'última movimentação do cliente/demandas/tarefas');

  reset role;
end $$;

-- =============================================================================
-- 2. Concluída/cancelada, item feito, parcela paga e tarefa concluída ficam fora
-- =============================================================================
do $$
declare
  cli uuid := tsta.id('cli');
  ov jsonb;
begin
  perform tsta.login('u_adv');
  ov := public.client_overview(cli);

  perform tsta.ok(not exists (
    select 1 from jsonb_array_elements(ov->'open_demands') e
     where e->>'id' in (tsta.id('d_done')::text, tsta.id('d_cancel')::text)),
    'demandas concluída e cancelada não aparecem');

  perform tsta.ok(not exists (
    select 1 from jsonb_array_elements(ov->'checklist_pending_items') e
     where e->>'demand_id' = tsta.id('d_done')::text),
    'item pendente de demanda concluída não aparece');

  -- As contagens provam a exclusão: se a tarefa concluída contasse, open = 3.
  perform tsta.eq((ov->'tasks'->>'open')::int, 2, 'tarefa concluída e cancelada não contam');
  -- Se a parcela paga (50) ou a cancelada (70) somassem, o total passaria de 260.
  perform tsta.eq((ov->'finance'->>'open_amount')::numeric, 260.00::numeric,
                  'parcela paga e contrato cancelado não somam');

  reset role;
end $$;

-- =============================================================================
-- 3. Limites: no máximo 20 demandas abertas e 15 itens de checklist pendentes
-- =============================================================================
savepoint limites;
do $$
declare
  o uuid := tsta.id('org');
  cat uuid := tsta.id('cat');
  v_cli uuid;
  v_d uuid;
  i int;
begin
  insert into clients (organization_id, full_name) values (o, 'Cliente Capacidade')
  returning id into v_cli;
  perform tsta.set_id('cli_cap', v_cli);

  for i in 1..22 loop
    insert into demands (organization_id, client_id, category_id, title, status, opened_at, created_at)
    values (o, v_cli, cat, 'Capacidade ' || lpad(i::text, 2, '0'), 'em_andamento',
            current_date - 30 + i, timestamptz '2031-01-01 00:00:00+00' + make_interval(mins => i))
    returning id into v_d;
  end loop;

  for i in 1..17 loop
    insert into demand_checklist_items (organization_id, demand_id, label, done, position)
    values (o, v_d, 'Item ' || lpad(i::text, 2, '0'), false, i - 1);
  end loop;
  perform tsta.set_id('d_cap', v_d);
end $$;

do $$
declare
  ov jsonb;
  v jsonb;
begin
  perform tsta.login('u_admin');
  ov := public.client_overview(tsta.id('cli_cap'));

  perform tsta.eq(jsonb_array_length(ov->'open_demands'), 20, 'open_demands limitado a 20');
  perform tsta.eq(ov->'open_demands'->0->>'title', 'Capacidade 22', 'limite mantém as mais recentes');

  perform tsta.eq(jsonb_array_length(ov->'checklist_pending_items'), 15,
                  'checklist_pending_items limitado a 15');
  perform tsta.eq((select e->>'label' from jsonb_array_elements(ov->'checklist_pending_items') e limit 1),
                  'Item 01', 'limite mantém a ordem de posição');

  select e into v from jsonb_array_elements(ov->'open_demands') e
   where e->>'id' = tsta.id('d_cap')::text;
  perform tsta.eq((v->>'checklist_pending')::int, 17, 'checklist pendente conta todos, além do limite da lista');

  reset role;
end $$;
rollback to savepoint limites;

-- =============================================================================
-- 4. Usuário de outro escritório é recusado com 42501
-- =============================================================================
do $$
begin
  perform tsta.login('u_admin_b');
  perform tsta.expect_error_state(
    format('select public.client_overview(%L)', tsta.id('cli')),
    '42501', 'Sem acesso a este escritório',
    'cliente de outro escritório é recusado');
  reset role;
end $$;

reset role;
do $$ begin
  raise warning 'client_overview_test.sql: % verificações da ficha 360° OK', (select last_value from tsta.passed);
end $$;
rollback;
