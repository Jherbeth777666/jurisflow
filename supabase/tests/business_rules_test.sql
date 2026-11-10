-- =============================================================================
-- JurisFlow AI — Testes das regras de negócio no banco (migration 002)
-- =============================================================================
-- Roda dentro de uma transação desfeita no final. Os cenários usam um usuário
-- administrador real (role authenticated + JWT simulado), como a aplicação faz.
-- Falha → raise exception 'FALHOU: ...'.
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
-- "Hoje" do escritório = data em São Paulo (as regras do banco usam
-- (now() at time zone 'America/Sao_Paulo')::date). Com o fuso da sessão fixado,
-- current_date nos testes passa a ser exatamente essa data.
set local timezone = 'America/Sao_Paulo';

create schema tstb;
create sequence tstb.passed;

create function tstb.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tstb.' || p, true), '')::uuid $$;
create function tstb.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tstb.' || p, v::text, false) $$;

create function tstb.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tstb.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tstb.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tstb.passed');
end $$;

create function tstb.eq(got anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FALHOU: % — obtido %, esperado %', label, got, expected;
  end if;
  perform nextval('tstb.passed');
end $$;

create function tstb.expect_error_msg(q text, fragment text, label text) returns void language plpgsql as $$
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
  perform nextval('tstb.passed');
end $$;

grant usage on schema tstb to authenticated;
grant execute on all functions in schema tstb to authenticated;
grant usage, select on sequence tstb.passed to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures: um escritório criado pela RPC oficial
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstb.set_id('u_admin', '00000000-0000-4000-9000-0000000000a1');
  perform tstb.set_id('u_adv',   '00000000-0000-4000-9000-0000000000a2');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tstb.id('u_admin'), 'regras.admin@teste.local', '{"full_name":"Admin Regras"}'),
    (tstb.id('u_adv'),   'regras.adv@teste.local',   '{"full_name":"Adv Regras"}');
  perform set_config('request.jwt.claims', json_build_object('sub', tstb.id('u_admin'))::text, true);
  perform tstb.set_id('org', public.create_organization('Escritório Regras'));
  insert into organization_members (organization_id, user_id, role) values (tstb.id('org'), tstb.id('u_adv'), 'advogado');
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- =============================================================================
-- 1. Fluxos padrão (seed_default_workflows via create_organization)
-- =============================================================================
do $$
declare
  o uuid := tstb.id('org');
  cat record;
begin
  perform tstb.eq((select count(*) from demand_categories where organization_id = o), 7::bigint, '7 categorias padrão');
  perform tstb.ok((select array_agg(name order by sort_order) from demand_categories where organization_id = o)
                  = array['Salário-maternidade','Aposentadoria','Benefícios por incapacidade','Benefícios relacionados à pesca',
                          'Demandas trabalhistas','Contratos','Outros'], 'categorias na ordem padrão');
  for cat in select * from demand_categories where organization_id = o loop
    perform tstb.ok((select count(*) from workflow_stages where category_id = cat.id) >= 4, format('%s tem etapas', cat.name));
    perform tstb.eq((select count(*) from workflow_stages where category_id = cat.id and is_final), 1::bigint, format('%s tem 1 etapa final', cat.name));
    perform tstb.ok((select is_final from workflow_stages where category_id = cat.id order by position desc limit 1),
                    format('%s: a etapa final é a última', cat.name));
    perform tstb.ok((select array_agg(position order by position) from workflow_stages where category_id = cat.id)
                    = (select array_agg(g) from generate_series(0, (select count(*) - 1 from workflow_stages where category_id = cat.id)::int) g),
                    format('%s: posições contínuas a partir de 0', cat.name));
    perform tstb.eq((select count(*) from workflow_stages where category_id = cat.id and is_waiting_docs),
                    case when cat.name = 'Contratos' then 0::bigint else 1::bigint end, format('%s: etapas de aguardando documentação', cat.name));
  end loop;
  perform tstb.ok((select array_agg(s.name order by s.position) from workflow_stages s join demand_categories c on c.id = s.category_id
                    where c.organization_id = o and c.name = 'Salário-maternidade')
                  = array['Primeiro atendimento','Cadastro da cliente','Solicitação de documentos','Aguardando documentação',
                          'Conferência documental externa','Preparação do requerimento','Protocolo','Acompanhamento','Concluído'],
                  'etapas do salário-maternidade conforme especificação (sem marcadores * e !)');
  perform tstb.ok((select is_waiting_docs from workflow_stages s join demand_categories c on c.id = s.category_id
                    where c.organization_id = o and c.name = 'Salário-maternidade' and s.name = 'Aguardando documentação'), 'flag is_waiting_docs');
  perform tstb.ok(not exists (select 1 from workflow_stages where organization_id = o and (name like '%*' or name like '%!')), 'nomes sem marcadores');
  -- idempotente
  perform public.seed_default_workflows(o);
  perform tstb.eq((select count(*) from demand_categories where organization_id = o), 7::bigint, 'seed_default_workflows é idempotente');
  perform tstb.ok((select count(*) from organization_members where organization_id = o and role = 'admin' and user_id = tstb.id('u_admin')) = 1,
                  'create_organization torna o criador admin');
end $$;

-- ids de apoio
do $$
declare o uuid := tstb.id('org');
begin
  perform tstb.set_id('cat_sm',  (select id from demand_categories where organization_id = o and name = 'Salário-maternidade'));
  perform tstb.set_id('cat_out', (select id from demand_categories where organization_id = o and name = 'Outros'));
  perform tstb.set_id('sm_first', (select id from workflow_stages where category_id = tstb.id('cat_sm') order by position limit 1));
  perform tstb.set_id('sm_wait',  (select id from workflow_stages where category_id = tstb.id('cat_sm') and is_waiting_docs));
  perform tstb.set_id('sm_final', (select id from workflow_stages where category_id = tstb.id('cat_sm') and is_final));
  perform tstb.set_id('out_first', (select id from workflow_stages where category_id = tstb.id('cat_out') order by position limit 1));
  perform tstb.set_id('out_second', (select id from workflow_stages where category_id = tstb.id('cat_out') order by position offset 1 limit 1));
end $$;

-- create_organization: limite de 3 escritórios como admin
savepoint t;
do $$ begin
  perform tstb.login('u_admin');
  perform public.create_organization('Segundo');
  perform public.create_organization('Terceiro');
  perform tstb.expect_error_msg($q$select public.create_organization('Quarto')$q$, 'Limite de escritórios', 'limite de escritórios por usuário');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 2. Demandas: etapa padrão, conclusão automática, reabertura, troca de categoria
-- =============================================================================
savepoint t;
do $$
declare
  o uuid := tstb.id('org');
  v_cli uuid; v_dem uuid; d record;
begin
  perform tstb.login('u_adv');
  insert into clients (organization_id, full_name) values (o, 'Cliente Regras') returning id into v_cli;
  insert into demands (organization_id, client_id, category_id, title)
  values (o, v_cli, tstb.id('cat_sm'), 'Salário-maternidade da cliente') returning id into v_dem;
  select * into d from demands where id = v_dem;
  perform tstb.eq(d.stage_id, tstb.id('sm_first'), 'sem etapa → 1ª etapa da categoria');
  perform tstb.eq(d.status::text, 'em_andamento', 'status inicial em andamento');
  perform tstb.ok(d.closed_at is null and d.stage_changed_at is not null, 'closed_at nulo e stage_changed_at preenchido');
  perform tstb.eq(d.created_by, tstb.id('u_adv'), 'created_by da demanda');

  -- mudança de etapa atualiza stage_changed_at
  reset role;
  update demands set stage_changed_at = now() - interval '20 days' where id = v_dem;
  perform tstb.login('u_adv');
  update demands set stage_id = tstb.id('sm_wait') where id = v_dem;
  select * into d from demands where id = v_dem;
  perform tstb.eq(d.stage_changed_at, now(), 'stage_changed_at atualizado ao mudar de etapa');
  -- editar outro campo não mexe em stage_changed_at
  reset role;
  update demands set stage_changed_at = now() - interval '3 days' where id = v_dem;
  perform tstb.login('u_adv');
  update demands set priority = 'alta' where id = v_dem;
  perform tstb.eq((select stage_changed_at from demands where id = v_dem), now() - interval '3 days', 'stage_changed_at preservado sem mudança de etapa');

  -- etapa final → concluída
  update demands set stage_id = tstb.id('sm_final') where id = v_dem;
  select * into d from demands where id = v_dem;
  perform tstb.eq(d.status::text, 'concluida', 'etapa final conclui a demanda');
  perform tstb.ok(d.closed_at is not null, 'closed_at definido ao concluir');
  perform tstb.ok(exists (select 1 from activity_logs where entity_id = v_dem and action = 'stage_changed'
                          and changes->'stage_id'->>'to' = tstb.id('sm_final')::text), 'log de mudança de etapa');

  -- sai da etapa final → reabre
  update demands set stage_id = tstb.id('sm_wait') where id = v_dem;
  select * into d from demands where id = v_dem;
  perform tstb.eq(d.status::text, 'em_andamento', 'sair da etapa final reabre a demanda');
  perform tstb.ok(d.closed_at is null, 'closed_at limpo ao reabrir');

  -- cancelar define closed_at; reabrir limpa
  update demands set status = 'cancelada' where id = v_dem;
  perform tstb.ok((select closed_at from demands where id = v_dem) is not null, 'cancelada define closed_at');
  update demands set status = 'aguardando_cliente' where id = v_dem;
  perform tstb.ok((select closed_at from demands where id = v_dem) is null, 'status aberto limpa closed_at');

  -- troca de categoria sem informar etapa → 1ª etapa da nova
  update demands set category_id = tstb.id('cat_out') where id = v_dem;
  perform tstb.eq((select stage_id from demands where id = v_dem), tstb.id('out_first'), 'troca de categoria reseta para a 1ª etapa');
  -- troca de categoria informando etapa da nova categoria → mantém a etapa informada
  update demands set category_id = tstb.id('cat_sm'), stage_id = tstb.id('sm_wait') where id = v_dem;
  perform tstb.eq((select stage_id from demands where id = v_dem), tstb.id('sm_wait'), 'troca de categoria com etapa explícita');
  -- etapa de outra categoria é recusada (FK categoria×etapa)
  perform tstb.expect_error_msg(format('update demands set stage_id = %L where id = %L', tstb.id('out_second'), v_dem),
                                'foreign key', 'etapa de outra categoria');
  -- criar já na etapa final → concluída
  insert into demands (organization_id, client_id, category_id, stage_id, title)
  values (o, v_cli, tstb.id('cat_sm'), tstb.id('sm_final'), 'Já concluída') returning id into v_dem;
  perform tstb.eq((select status::text from demands where id = v_dem), 'concluida', 'criar na etapa final já conclui');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 3. Tarefas
-- =============================================================================
savepoint t;
do $$
declare o uuid := tstb.id('org'); v_cli uuid; v_dem uuid; v_task uuid;
begin
  perform tstb.login('u_adv');
  insert into clients (organization_id, full_name) values (o, 'Cliente Tarefa') returning id into v_cli;
  insert into demands (organization_id, client_id, category_id, title) values (o, v_cli, tstb.id('cat_out'), 'Demanda Tarefa') returning id into v_dem;
  insert into tasks (organization_id, title, demand_id) values (o, 'Juntar documentos', v_dem) returning id into v_task;
  perform tstb.eq((select client_id from tasks where id = v_task), v_cli, 'tarefa herda o cliente da demanda');
  update tasks set status = 'concluida' where id = v_task;
  perform tstb.ok((select completed_at from tasks where id = v_task) is not null, 'concluir define completed_at');
  update tasks set status = 'pendente' where id = v_task;
  perform tstb.ok((select completed_at from tasks where id = v_task) is null, 'reabrir limpa completed_at');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 4. Contratos, parcelas e pagamentos
-- =============================================================================
savepoint t;
do $$
declare
  o uuid := tstb.id('org');
  v_cli uuid; v_con uuid; v_con2 uuid; v_pay uuid; v_pay2 uuid;
begin
  perform tstb.login('u_adv');
  insert into clients (organization_id, full_name) values (o, 'Cliente Contrato') returning id into v_cli;

  -- 1000 / 3 → 333,33 + 333,33 + 333,34; vencimentos mensais respeitando fim de mês
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 1000, 3, '2026-01-31') returning id into v_con;
  perform tstb.eq((select count(*) from installments where contract_id = v_con), 3::bigint, '3 parcelas geradas');
  perform tstb.eq((select sum(amount) from installments where contract_id = v_con), 1000.00::numeric, 'parcelas somam exatamente o total');
  perform tstb.ok((select array_agg(amount order by number) from installments where contract_id = v_con) = array[333.33, 333.33, 333.34]::numeric[],
                  'diferença de centavos vai para a última parcela');
  perform tstb.ok((select array_agg(due_date order by number) from installments where contract_id = v_con)
                  = array['2026-01-31','2026-02-28','2026-03-31']::date[], 'vencimentos mensais (fim de mês tratado)');

  -- outros totais
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 100, 7, '2026-05-10') returning id into v_con2;
  perform tstb.eq((select sum(amount) from installments where contract_id = v_con2), 100.00::numeric, '100/7 soma exatamente 100');
  perform tstb.eq((select count(distinct amount) from installments where contract_id = v_con2 and number < 7), 1::bigint, 'parcelas iguais exceto a última');

  -- alterar valor/parcelas sem pagamento → regenera
  update contracts set installments_count = 4, total_amount = 1200 where id = v_con;
  perform tstb.eq((select count(*) from installments where contract_id = v_con), 4::bigint, 'parcelas regeneradas ao alterar contrato sem pagamentos');
  perform tstb.ok((select bool_and(amount = 300) from installments where contract_id = v_con), '1200/4 = 300 cada');

  -- pagamento na parcela 1
  insert into payments (organization_id, contract_id, installment_id, amount)
  values (o, v_con, (select id from installments where contract_id = v_con and number = 1), 300) returning id into v_pay;
  perform tstb.ok(exists (select 1 from activity_logs where entity_id = v_pay and action = 'created' and (changes->>'amount')::numeric = 300), 'log do pagamento');

  -- com pagamento: valor/parcelas/vencimento bloqueados; demais campos liberados
  perform tstb.expect_error_msg(format('update contracts set total_amount = 2000 where id = %L', v_con), 'já possui pagamentos', 'alterar valor com pagamento');
  perform tstb.expect_error_msg(format('update contracts set installments_count = 2 where id = %L', v_con), 'já possui pagamentos', 'alterar parcelas com pagamento');
  perform tstb.expect_error_msg(format($q$update contracts set first_due_date = '2026-02-01' where id = %L$q$, v_con), 'já possui pagamentos', 'alterar 1º vencimento com pagamento');
  update contracts set notes = 'Observação liberada', description = 'Ok' where id = v_con;
  perform tstb.eq((select notes from contracts where id = v_con), 'Observação liberada', 'editar campos descritivos com pagamento');

  -- parcela de outro contrato (mesmo escritório) → recusado
  perform tstb.expect_error_msg(format('insert into payments (organization_id, contract_id, installment_id, amount) values (%L, %L, %L, 10)',
                                o, v_con, (select id from installments where contract_id = v_con2 and number = 1)),
                                'não pertence a este contrato', 'pagamento com parcela de outro contrato');
  perform tstb.expect_error_msg(format('update payments set installment_id = %L where id = %L',
                                (select id from installments where contract_id = v_con2 and number = 1), v_pay),
                                'não pertence a este contrato', 'mover pagamento para parcela de outro contrato');

  -- quitação automática e retorno a ativo após estorno
  perform tstb.eq((select status::text from contracts where id = v_con), 'ativo', 'contrato ativo com pagamento parcial');
  insert into payments (organization_id, contract_id, amount) values (o, v_con, 900) returning id into v_pay2;
  perform tstb.eq((select status::text from contracts where id = v_con), 'quitado', 'contrato quitado automaticamente');
  delete from payments where id = v_pay2;
  perform tstb.eq((select status::text from contracts where id = v_con), 'ativo', 'estorno volta o contrato para ativo');
  -- update do valor do pagamento também recalcula
  update payments set amount = 1200 where id = v_pay;
  perform tstb.eq((select status::text from contracts where id = v_con), 'quitado', 'editar pagamento recalcula status');
  update payments set amount = 10 where id = v_pay;
  perform tstb.eq((select status::text from contracts where id = v_con), 'ativo', 'reduzir pagamento reabre o contrato');

  -- cancelado: não recebe pagamento e não é recalculado
  update contracts set status = 'cancelado' where id = v_con2;
  perform tstb.expect_error_msg(format('insert into payments (organization_id, contract_id, amount) values (%L, %L, 10)', o, v_con2),
                                'contrato cancelado', 'pagamento em contrato cancelado');
  perform tstb.ok((select bool_and(status = 'cancelada') from installment_overview where contract_id = v_con2), 'parcelas de contrato cancelado = cancelada');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 5. Views financeiras (installment_overview / contract_overview)
-- =============================================================================
savepoint t;
do $$
declare
  o uuid := tstb.id('org');
  v_cli uuid; v_con uuid; co record;
begin
  perform tstb.login('u_adv');
  insert into clients (organization_id, full_name) values (o, 'Cliente Views') returning id into v_cli;
  -- 4 x 100: venc. hoje-45, hoje-15, hoje+16, hoje+46 (aprox. mensal)
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 400, 4, current_date - 45) returning id into v_con;
  insert into payments (organization_id, contract_id, installment_id, amount) values
    (o, v_con, (select id from installments where contract_id = v_con and number = 1), 100),  -- paga
    (o, v_con, (select id from installments where contract_id = v_con and number = 2), 40);   -- vencida (parcial, mas vencida)
  -- parcela 3 a vencer com pagamento parcial
  insert into payments (organization_id, contract_id, installment_id, amount) values
    (o, v_con, (select id from installments where contract_id = v_con and number = 3), 30);

  perform tstb.ok((select array_agg(status order by number) from installment_overview where contract_id = v_con)
                  = array['paga','vencida','parcial','a_vencer'], 'status das parcelas: paga/vencida/parcial/a_vencer');
  perform tstb.ok((select array_agg(paid_amount order by number) from installment_overview where contract_id = v_con) = array[100,40,30,0]::numeric[], 'valor pago por parcela');
  perform tstb.ok((select array_agg(remaining_amount order by number) from installment_overview where contract_id = v_con) = array[0,60,70,100]::numeric[], 'saldo por parcela');
  perform tstb.eq((select client_id from installment_overview where contract_id = v_con limit 1), v_cli, 'installment_overview expõe client_id');

  select * into co from contract_overview where id = v_con;
  perform tstb.eq(co.received_amount, 170.00::numeric, 'contract_overview.received_amount');
  perform tstb.eq(co.balance_amount, 230.00::numeric, 'contract_overview.balance_amount');
  perform tstb.eq(co.overdue_count, 1::bigint, 'contract_overview.overdue_count');
  perform tstb.eq(co.next_due_date, (select due_date from installments where contract_id = v_con and number = 2), 'próximo vencimento = parcela vencida em aberto');

  -- quitar tudo: sem vencidas, sem próximo vencimento, saldo 0
  insert into payments (organization_id, contract_id, amount) values (o, v_con, 230);
  select * into co from contract_overview where id = v_con;
  perform tstb.eq(co.status::text, 'quitado', 'quitado via pagamento avulso');
  perform tstb.eq(co.balance_amount, 0.00::numeric, 'saldo zerado');
  -- pagamento avulso (sem parcela) não é atribuído às parcelas
  perform tstb.eq(co.overdue_count, 1::bigint, 'pagamento sem parcela não altera status das parcelas');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 6. dashboard_metrics bate com contagens conhecidas
-- =============================================================================
savepoint t;
do $$
declare
  o uuid := tstb.id('org');
  v_cli uuid; v_cli2 uuid; v_con uuid; m jsonb;
begin
  perform tstb.login('u_admin');
  insert into clients (organization_id, full_name) values (o, 'Cliente Dash 1') returning id into v_cli;
  insert into clients (organization_id, full_name) values (o, 'Cliente Dash 2') returning id into v_cli2;
  insert into clients (organization_id, full_name) values (o, 'Cliente Dash 3');
  -- 3 demandas abertas (1 aguardando documentação), 1 concluída, 1 cancelada
  insert into demands (organization_id, client_id, category_id, title, responsible_id) values
    (o, v_cli,  tstb.id('cat_sm'),  'Aberta 1', tstb.id('u_adv')),
    (o, v_cli2, tstb.id('cat_out'), 'Aberta 2', tstb.id('u_adv'));
  insert into demands (organization_id, client_id, category_id, stage_id, title) values
    (o, v_cli, tstb.id('cat_sm'), tstb.id('sm_wait'),  'Aguardando docs'),
    (o, v_cli, tstb.id('cat_sm'), tstb.id('sm_final'), 'Concluída');
  insert into demands (organization_id, client_id, category_id, title, status) values
    (o, v_cli, tstb.id('cat_out'), 'Cancelada', 'cancelada');
  -- tarefas: 2 vencidas, 1 hoje, 1 em 5 dias, 1 em 30 dias, 1 concluída (vencida), 1 sem prazo
  insert into tasks (organization_id, title, due_date, status, assignee_id) values
    (o, 'Vencida 1', current_date - 3, 'pendente', null),
    (o, 'Vencida 2', current_date - 1, 'em_andamento', null),
    (o, 'Hoje',      current_date,     'pendente', null),
    (o, 'Em 5 dias', current_date + 5, 'pendente', null),
    (o, 'Em 30',     current_date + 30,'pendente', null),
    (o, 'Feita',     current_date - 2, 'concluida', tstb.id('u_adv')),
    (o, 'Sem prazo', null,             'pendente', null);
  -- contratos: 600 (3x, 1ª vencida há 20 dias, sem pagamento) + 400 (1x paga) + 999 cancelado
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli, 600, 3, current_date - 20);
  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (o, v_cli2, 400, 1, current_date) returning id into v_con;
  insert into payments (organization_id, contract_id, amount) values (o, v_con, 400);
  insert into contracts (organization_id, client_id, total_amount, status) values (o, v_cli2, 999, 'cancelado');

  m := public.dashboard_metrics(o);
  perform tstb.eq((m->>'clients_total')::int, 3, 'dashboard: clientes');
  perform tstb.eq((m->>'demands_in_progress')::int, 3, 'dashboard: demandas em andamento');
  perform tstb.eq((m->>'demands_done')::int, 1, 'dashboard: demandas concluídas');
  perform tstb.eq((m->>'demands_waiting_docs')::int, 1, 'dashboard: aguardando documentação');
  perform tstb.eq((m->>'tasks_pending')::int, 6, 'dashboard: tarefas pendentes');
  perform tstb.eq((m->>'tasks_overdue')::int, 2, 'dashboard: tarefas vencidas');
  perform tstb.eq((m->>'deadlines_upcoming')::int, 2, 'dashboard: prazos nos próximos 7 dias');
  perform tstb.eq((m->>'fees_expected')::numeric, 1000::numeric, 'dashboard: honorários previstos (ativos+quitados)');
  perform tstb.eq((m->>'fees_received')::numeric, 400::numeric, 'dashboard: honorários recebidos');
  perform tstb.eq((m->>'installments_overdue')::numeric, 200::numeric, 'dashboard: parcelas vencidas em aberto');
  perform tstb.eq(jsonb_array_length(m->'monthly'), 6, 'dashboard: série mensal de 6 meses');
  perform tstb.eq(jsonb_array_length(m->'revenue_monthly'), 6, 'dashboard: série de receita de 6 meses');
  perform tstb.eq((select (x->>'opened')::int from jsonb_array_elements(m->'monthly') x where x->>'month' = to_char(current_date, 'YYYY-MM')), 5,
                  'dashboard: demandas abertas no mês');
  perform tstb.eq((select (x->>'received')::numeric from jsonb_array_elements(m->'revenue_monthly') x where x->>'month' = to_char(current_date, 'YYYY-MM')), 400::numeric,
                  'dashboard: recebido no mês');
  perform tstb.eq((select sum((x->>'count')::int) from jsonb_array_elements(m->'by_category') x)::int, 3, 'dashboard: por categoria soma as abertas');
  perform tstb.eq((select sum((x->>'count')::int) from jsonb_array_elements(m->'by_status') x)::int, 5, 'dashboard: por status soma todas');
  perform tstb.eq((select (x->>'open_demands')::int from jsonb_array_elements(m->'productivity') x where x->>'user_id' = tstb.id('u_adv')::text), 2,
                  'dashboard: demandas abertas do advogado');
  perform tstb.eq((select (x->>'tasks_done_30d')::int from jsonb_array_elements(m->'productivity') x where x->>'user_id' = tstb.id('u_adv')::text), 1,
                  'dashboard: tarefas concluídas do advogado (30d)');
end $$;
rollback to savepoint t;

-- =============================================================================
-- 7. reorder_workflow_stages / delete_workflow_stage
-- =============================================================================
savepoint t;
do $$
declare
  o uuid := tstb.id('org');
  v_ids uuid[]; v_cli uuid; v_dem uuid; v_new uuid;
begin
  perform tstb.login('u_adv');
  select array_agg(id order by position desc) into v_ids from workflow_stages where category_id = tstb.id('cat_out');
  perform public.reorder_workflow_stages(tstb.id('cat_out'), v_ids);
  perform tstb.ok((select array_agg(id order by position) from workflow_stages where category_id = tstb.id('cat_out')) = v_ids, 'reordenação aplicada');
  perform tstb.ok((select array_agg(position order by position) from workflow_stages where category_id = tstb.id('cat_out')) = array[0,1,2,3],
                  'posições 0..n-1 após reordenar');
  perform tstb.expect_error_msg(format('select public.reorder_workflow_stages(%L, %L::uuid[])', tstb.id('cat_out'), v_ids[1:2]),
                                'incompleta', 'reordenar com lista incompleta');
  perform tstb.expect_error_msg(format('select public.reorder_workflow_stages(%L, %L::uuid[])', tstb.id('cat_out'),
                                array[v_ids[1], v_ids[2], v_ids[3], tstb.id('sm_first')]), 'inválida', 'reordenar com etapa de outra categoria');

  insert into clients (organization_id, full_name) values (o, 'Cliente Fluxo') returning id into v_cli;
  insert into demands (organization_id, client_id, category_id, stage_id, title)
  values (o, v_cli, tstb.id('cat_out'), tstb.id('out_second'), 'Na etapa a excluir') returning id into v_dem;

  perform tstb.expect_error_msg(format('select public.delete_workflow_stage(%L, null)', tstb.id('out_second')),
                                'Escolha uma etapa de destino', 'excluir etapa com demandas sem destino');
  perform tstb.expect_error_msg(format('select public.delete_workflow_stage(%L, %L)', tstb.id('out_second'), tstb.id('sm_first')),
                                'destino inválida', 'destino de outra categoria');
  perform tstb.expect_error_msg(format('select public.delete_workflow_stage(%L, %L)', tstb.id('out_second'), tstb.id('out_second')),
                                'destino inválida', 'destino = a própria etapa');
  perform public.delete_workflow_stage(tstb.id('out_second'), tstb.id('out_first'));
  perform tstb.eq((select stage_id from demands where id = v_dem), tstb.id('out_first'), 'demandas movidas para o destino');
  perform tstb.ok(not exists (select 1 from workflow_stages where id = tstb.id('out_second')), 'etapa excluída com destino');

  insert into workflow_stages (organization_id, category_id, name, position) values (o, tstb.id('cat_out'), 'Vazia', 10) returning id into v_new;
  perform public.delete_workflow_stage(v_new, null);
  perform tstb.ok(not exists (select 1 from workflow_stages where id = v_new), 'etapa vazia excluída sem destino');
  perform tstb.expect_error_msg(format('select public.delete_workflow_stage(%L, null)', v_new), 'não encontrada', 'excluir etapa inexistente');
end $$;
rollback to savepoint t;

-- -----------------------------------------------------------------------------
reset role;
do $$ begin
  raise warning 'business_rules_test.sql: % verificações de regras de negócio OK', (select last_value from tstb.passed);
end $$;
rollback;
