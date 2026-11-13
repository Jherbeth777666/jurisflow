-- =============================================================================
-- JurisFlow AI — Testes do lote L3: agenda unificada (public.agenda_items)
-- =============================================================================
-- Cobre: união de tarefas, próximas ações e parcelas; exclusão de concluídas/
-- canceladas/pagas; atraso; filtro "somente minhas"; ordenação; limites de
-- intervalo. Roda em transação desfeita no final (não deixa lixo).
-- Qualquer falha → raise exception 'FALHOU: ...' → psql para (ON_ERROR_STOP).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
-- "Hoje" do escritório = data em São Paulo (agenda_items usa esse fuso).
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
-- Fixtures
-- -----------------------------------------------------------------------------
do $$
begin
  perform tsta.set_id('u_admin', '00000000-0000-4000-9000-00000000a001');
  perform tsta.set_id('u_adv',   '00000000-0000-4000-9000-00000000a002');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'), 'agenda.admin@teste.local', '{"full_name":"Admin Agenda"}'),
    (tsta.id('u_adv'),   'agenda.adv@teste.local',   '{"full_name":"Adv Agenda"}');
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  perform tsta.set_id('org', public.create_organization('Escritório Agenda'));
  insert into organization_members (organization_id, user_id, role)
  values (tsta.id('org'), tsta.id('u_adv'), 'advogado');
  perform tsta.set_id('cat', (select id from demand_categories
                               where organization_id = tsta.id('org') and name = 'Outros'));
  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  o uuid := tsta.id('org');
  u_admin uuid := tsta.id('u_admin');
  u_adv uuid := tsta.id('u_adv');
  cat uuid := tsta.id('cat');
  v_cli uuid;
  v_dmain uuid;
  v_con_main uuid;
  v_con_paid uuid;
  v_con_cancel uuid;
  v_con_out uuid;
  v_inst_main_2 uuid;
  v_inst_paid uuid;
  v_inst_cancel uuid;
  v_inst_out uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin)::text, true);

  insert into clients (organization_id, full_name)
  values (o, 'Cliente Agenda') returning id into v_cli;
  perform tsta.set_id('cli', v_cli);

  insert into demands (organization_id, client_id, category_id, title, responsible_id)
  values (o, v_cli, cat, 'Demanda de apoio', u_admin) returning id into v_dmain;
  perform tsta.set_id('dmain', v_dmain);

  -- Próximas ações: aberta/vencida, fallback de título, suspensa (não concluída),
  -- concluída e cancelada (estas duas não podem aparecer).
  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, v_cli, cat, 'Demanda aberta', u_adv, 'em_andamento',
          'Protocolar contestação', current_date - 2)
  returning id into v_dmain;
  perform tsta.set_id('dopen', v_dmain);

  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, v_cli, cat, 'Demanda sem próxima ação', u_admin, 'aguardando_cliente',
          null, current_date)
  returning id into v_dmain;
  perform tsta.set_id('dfallback', v_dmain);

  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, v_cli, cat, 'Demanda suspensa', u_adv, 'suspensa',
          'Aguardar perícia', current_date + 1)
  returning id into v_dmain;
  perform tsta.set_id('dsusp', v_dmain);

  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, v_cli, cat, 'Demanda concluída', u_adv, 'concluida',
          'Feito', current_date)
  returning id into v_dmain;
  perform tsta.set_id('ddone', v_dmain);

  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, v_cli, cat, 'Demanda cancelada', u_adv, 'cancelada',
          'Cancelado', current_date)
  returning id into v_dmain;
  perform tsta.set_id('dcancel', v_dmain);

  -- Tarefas: hoje, atrasada, futura (aparecem); concluída, cancelada, sem prazo
  -- e fora do intervalo (não aparecem). O cliente é herdado da demanda.
  insert into tasks (organization_id, title, due_date, status, assignee_id, demand_id)
  values
    (o, 'Tarefa de hoje',         current_date,      'pendente',     u_adv,   tsta.id('dmain')),
    (o, 'Tarefa atrasada',        current_date - 3,  'em_andamento', u_admin, tsta.id('dmain')),
    (o, 'Tarefa futura',          current_date + 3,  'pendente',     u_adv,   tsta.id('dmain')),
    (o, 'Tarefa concluída',       current_date - 1,  'concluida',    u_adv,   tsta.id('dmain')),
    (o, 'Tarefa cancelada',       current_date,      'cancelada',    u_adv,   tsta.id('dmain')),
    (o, 'Tarefa fora do intervalo', current_date + 40, 'pendente',   u_adv,   tsta.id('dmain')),
    (o, 'Tarefa sem prazo',       null,              'pendente',     u_adv,   tsta.id('dmain'));
  perform tsta.set_id('task_today',   (select id from tasks where organization_id = o and title = 'Tarefa de hoje'));
  perform tsta.set_id('task_overdue', (select id from tasks where organization_id = o and title = 'Tarefa atrasada'));
  perform tsta.set_id('task_future',  (select id from tasks where organization_id = o and title = 'Tarefa futura'));
  perform tsta.set_id('task_done',    (select id from tasks where organization_id = o and title = 'Tarefa concluída'));
  perform tsta.set_id('task_cancel',  (select id from tasks where organization_id = o and title = 'Tarefa cancelada'));
  perform tsta.set_id('task_out',     (select id from tasks where organization_id = o and title = 'Tarefa fora do intervalo'));
  perform tsta.set_id('task_nodate',  (select id from tasks where organization_id = o and title = 'Tarefa sem prazo'));

  -- Contrato principal: 3 x 100. Parcela 1 vencida, parcela 2 parcial (40 pagos
  -- de 100 → saldo 60) e parcela 3 ainda fora do intervalo de 62 dias usado.
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 300, 3, current_date - 20) returning id into v_con_main;
  select id into v_inst_main_2 from installments where contract_id = v_con_main and number = 2;
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (o, v_con_main, v_inst_main_2, 40);

  -- Contrato pago: não aparece.
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 50, 1, current_date - 5) returning id into v_con_paid;
  select id into v_inst_paid from installments where contract_id = v_con_paid and number = 1;
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (o, v_con_paid, v_inst_paid, 50);

  -- Contrato cancelado: parcela cancelada, não aparece.
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 70, 1, current_date + 2) returning id into v_con_cancel;
  select id into v_inst_cancel from installments where contract_id = v_con_cancel and number = 1;
  update contracts set status = 'cancelado' where id = v_con_cancel;

  -- Contrato fora do intervalo: não aparece.
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 80, 1, current_date + 50) returning id into v_con_out;
  select id into v_inst_out from installments where contract_id = v_con_out and number = 1;

  perform tsta.set_id('con_main', v_con_main);
  perform tsta.set_id('con_paid', v_con_paid);
  perform tsta.set_id('con_cancel', v_con_cancel);
  perform tsta.set_id('con_out', v_con_out);
  perform tsta.set_id('inst_main_1', (select id from installments where contract_id = v_con_main and number = 1));
  perform tsta.set_id('inst_main_2', v_inst_main_2);
  perform tsta.set_id('inst_main_3', (select id from installments where contract_id = v_con_main and number = 3));
  perform tsta.set_id('inst_paid', v_inst_paid);
  perform tsta.set_id('inst_cancel', v_inst_cancel);
  perform tsta.set_id('inst_out', v_inst_out);

  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- =============================================================================
-- 1. Os três tipos aparecem, com os campos esperados
-- =============================================================================
do $$
declare
  o uuid := tsta.id('org');
  v jsonb;
  from_d date := current_date - 30;
  to_d   date := current_date + 32; -- 62 dias exatos (limite permitido)
begin
  perform tsta.login('u_adv');

  perform tsta.eq((select count(*) from public.agenda_items(o, from_d, to_d) where kind = 'task'),
                  3::bigint, 'tarefas abertas no intervalo (hoje, atrasada e futura)');
  perform tsta.eq((select count(*) from public.agenda_items(o, from_d, to_d) where kind = 'next_action'),
                  3::bigint, 'próximas ações abertas no intervalo (aberta, fallback e suspensa)');
  perform tsta.eq((select count(*) from public.agenda_items(o, from_d, to_d) where kind = 'installment'),
                  2::bigint, 'parcelas em aberto no intervalo (vencida e parcial)');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('task_today');
  perform tsta.eq(v->>'kind', 'task', 'tarefa: kind');
  perform tsta.eq(v->>'title', 'Tarefa de hoje', 'tarefa: título');
  perform tsta.eq((v->>'date')::date, current_date, 'tarefa: data');
  perform tsta.eq((v->>'overdue')::boolean, false, 'tarefa de hoje não está atrasada');
  perform tsta.eq(v->>'status', 'pendente', 'tarefa: status');
  perform tsta.eq((v->>'client_id')::uuid, tsta.id('cli'), 'tarefa: cliente herdado da demanda');
  perform tsta.eq((v->>'demand_id')::uuid, tsta.id('dmain'), 'tarefa: demanda');
  perform tsta.eq((v->>'assignee_id')::uuid, tsta.id('u_adv'), 'tarefa: responsável');
  perform tsta.ok(v->>'amount' is null, 'tarefa: sem valor');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('task_overdue');
  perform tsta.eq((v->>'date')::date, current_date - 3, 'tarefa atrasada: data');
  perform tsta.eq((v->>'overdue')::boolean, true, 'tarefa atrasada: overdue=true');
  perform tsta.eq(v->>'status', 'em_andamento', 'tarefa atrasada: status em andamento');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('dopen');
  perform tsta.eq(v->>'kind', 'next_action', 'próxima ação: kind');
  perform tsta.eq(v->>'title', 'Protocolar contestação', 'próxima ação: título');
  perform tsta.eq((v->>'date')::date, current_date - 2, 'próxima ação: data');
  perform tsta.eq((v->>'overdue')::boolean, true, 'próxima ação vencida: overdue=true');
  perform tsta.eq((v->>'client_id')::uuid, tsta.id('cli'), 'próxima ação: cliente');
  perform tsta.eq((v->>'demand_id')::uuid, tsta.id('dopen'), 'próxima ação: demand_id = id');
  perform tsta.eq((v->>'assignee_id')::uuid, tsta.id('u_adv'), 'próxima ação: responsável');
  perform tsta.eq(v->>'status', 'em_andamento', 'próxima ação: status da demanda');
  perform tsta.ok(v->>'amount' is null, 'próxima ação: sem valor');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('dfallback');
  perform tsta.eq(v->>'title', 'Próxima ação', 'próxima ação sem texto usa o título padrão');
  perform tsta.eq((v->>'overdue')::boolean, false, 'próxima ação de hoje não está atrasada');
  perform tsta.eq((v->>'assignee_id')::uuid, tsta.id('u_admin'), 'próxima ação: responsável admin');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('inst_main_1');
  perform tsta.eq(v->>'kind', 'installment', 'parcela: kind');
  perform tsta.eq(v->>'title', 'Parcela 1', 'parcela: título');
  perform tsta.eq((v->>'date')::date, current_date - 20, 'parcela vencida: data');
  perform tsta.eq((v->>'overdue')::boolean, true, 'parcela vencida: overdue=true');
  perform tsta.eq(v->>'status', 'vencida', 'parcela vencida: status');
  perform tsta.eq((v->>'amount')::numeric, 100.00::numeric, 'parcela vencida: valor em aberto');
  perform tsta.eq((v->>'client_id')::uuid, tsta.id('cli'), 'parcela: cliente');
  perform tsta.ok(v->>'assignee_id' is null, 'parcela: sem responsável');

  select to_jsonb(a) into v from public.agenda_items(o, from_d, to_d) a
   where a.id = tsta.id('inst_main_2');
  perform tsta.eq(v->>'title', 'Parcela 2', 'parcela parcial: título');
  perform tsta.eq(v->>'status', 'parcial', 'parcela parcial: status');
  perform tsta.eq((v->>'amount')::numeric, 60.00::numeric,
                  'parcela parcial: saldo = 100 - 40 pagos = 60');
  perform tsta.eq((v->>'overdue')::boolean, false, 'parcela parcial futura não está atrasada');

  reset role;
end $$;

-- =============================================================================
-- 2. Concluída/cancelada/paga/fora do intervalo não aparecem
-- =============================================================================
do $$
declare
  o uuid := tsta.id('org');
  from_d date := current_date - 30;
  to_d   date := current_date + 32;
begin
  perform tsta.login('u_adv');

  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('task_done')),
                  'tarefa concluída não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('task_cancel')),
                  'tarefa cancelada não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('task_nodate')),
                  'tarefa sem prazo não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('task_out')),
                  'tarefa fora do intervalo não aparece');

  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('ddone')),
                  'demanda concluída não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('dcancel')),
                  'demanda cancelada não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('dmain')),
                  'demanda sem próxima ação/data não aparece');

  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('inst_paid')),
                  'parcela paga não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('inst_cancel')),
                  'parcela de contrato cancelado não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('inst_out')),
                  'parcela fora do intervalo não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d) where id = tsta.id('inst_main_3')),
                  '3ª parcela (fora dos 62 dias) não aparece');

  -- Vencidos só entram se o intervalo começa em hoje ou antes.
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, current_date + 1, current_date + 10)
                              where id = tsta.id('task_overdue')),
                  'tarefa vencida não aparece quando o intervalo começa depois de hoje');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, current_date + 1, current_date + 10)
                              where id = tsta.id('dopen')),
                  'próxima ação vencida não aparece quando o intervalo começa depois de hoje');
  perform tsta.ok(exists (select 1 from public.agenda_items(o, current_date - 2, current_date - 1)
                              where id = tsta.id('task_overdue')),
                  'tarefa vencida aparece no intervalo que começa antes de hoje');

  reset role;
end $$;

-- =============================================================================
-- 3. p_only_mine filtra pelo responsável e exclui parcelas
-- =============================================================================
do $$
declare
  o uuid := tsta.id('org');
  from_d date := current_date - 30;
  to_d   date := current_date + 32;
begin
  perform tsta.login('u_adv');

  perform tsta.eq((select count(*) from public.agenda_items(o, from_d, to_d, true) where kind = 'installment'),
                  0::bigint, 'somente minhas: parcelas ficam de fora');
  perform tsta.ok(exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('task_today')),
                  'somente minhas: tarefa do usuário aparece');
  perform tsta.ok(exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('task_future')),
                  'somente minhas: outra tarefa do usuário aparece');
  perform tsta.ok(exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('dopen')),
                  'somente minhas: próxima ação do usuário aparece');
  perform tsta.ok(exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('dsusp')),
                  'somente minhas: próxima ação suspensa do usuário aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('task_overdue')),
                  'somente minhas: tarefa de outro responsável não aparece');
  perform tsta.ok(not exists (select 1 from public.agenda_items(o, from_d, to_d, true) where id = tsta.id('dfallback')),
                  'somente minhas: próxima ação de outro responsável não aparece');

  reset role;
end $$;

-- =============================================================================
-- 4. Ordenação por data, tipo e título
-- =============================================================================
savepoint ordem;
do $$
declare
  o uuid := tsta.id('org');
  d date := current_date + 25;
  v_con uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);

  insert into tasks (organization_id, title, due_date, status, assignee_id, demand_id) values
    (o, 'B ordena', d, 'pendente', tsta.id('u_adv'), tsta.id('dmain')),
    (o, 'A ordena', d, 'pendente', tsta.id('u_adv'), tsta.id('dmain'));
  insert into demands (organization_id, client_id, category_id, title, responsible_id,
                       status, next_action, next_action_date)
  values (o, tsta.id('cli'), tsta.id('cat'), 'Demanda ordem', tsta.id('u_adv'),
          'em_andamento', 'Zeta ação', d);
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, tsta.id('cli'), 123.45, 1, d) returning id into v_con;

  perform tsta.login('u_adv');
  perform tsta.ok(
    (select array_agg(kind || ':' || title order by rn)
       from (select kind, title, row_number() over () as rn
               from public.agenda_items(o, d, d)) x)
    = array['installment:Parcela 1', 'next_action:Zeta ação', 'task:A ordena', 'task:B ordena'],
    'ordenação por data, kind e título');

  reset role;
end $$;
rollback to savepoint ordem;

-- =============================================================================
-- 5. Limite do intervalo: até 62 dias; 63 dias recusa com 22023
-- =============================================================================
do $$
declare
  o uuid := tsta.id('org');
begin
  perform tsta.login('u_adv');

  perform tsta.ok((select count(*) from public.agenda_items(o, current_date - 30, current_date + 32)) >= 0,
                  'intervalo de exatamente 62 dias é aceito');
  perform tsta.expect_error_state(
    format('select * from public.agenda_items(%L, current_date - 30, current_date + 33)', o),
    '22023', 'Intervalo máximo de 62 dias', 'intervalo de 63 dias é recusado');

  reset role;
end $$;

reset role;
do $$ begin
  raise warning 'agenda_test.sql: % verificações da agenda OK', (select last_value from tsta.passed);
end $$;
rollback;
