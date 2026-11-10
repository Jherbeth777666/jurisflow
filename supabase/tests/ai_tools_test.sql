-- Testes das ferramentas do Assistente de IA (migration 004).
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação e é desfeito no final (não interfere em outros testes).
begin;

-- ---------------------------------------------------------------------------
-- Dados: dois escritórios (A e B); A tem admin, advogado e assistente.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'admin.a@teste.local',  '{"full_name":"Ana Admin"}'),
  ('a1000000-0000-0000-0000-000000000002', 'adv.a@teste.local',    '{"full_name":"Bruno Advogado"}'),
  ('a1000000-0000-0000-0000-000000000003', 'assist.a@teste.local', '{"full_name":"Carla Assistente"}'),
  ('b1000000-0000-0000-0000-000000000001', 'admin.b@teste.local',  '{"full_name":"Diego Admin B"}'),
  ('c1000000-0000-0000-0000-000000000001', 'fora@teste.local',     '{"full_name":"Estranho"}');

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

do $$
declare v_a uuid; v_b uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
  v_a := public.create_organization('Escritório A');
  perform set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001"}', true);
  v_b := public.create_organization('Escritório B');
  insert into t_ids values ('org_a', v_a), ('org_b', v_b);

  insert into organization_members (organization_id, user_id, role) values
    (v_a, 'a1000000-0000-0000-0000-000000000002', 'advogado'),
    (v_a, 'a1000000-0000-0000-0000-000000000003', 'assistente');

  -- Clientes com dados pessoais que NUNCA devem aparecer nos resultados
  insert into clients (id, organization_id, full_name, cpf, phone, email, address, notes, birth_date) values
    ('c0000000-0000-0000-0000-00000000000a', v_a, 'Maria Souza', '52998224725', '11987654321',
     'maria@exemplo.com', 'Rua Secreta 1', 'observação sigilosa', '1990-01-01'),
    ('c0000000-0000-0000-0000-00000000000b', v_b, 'João do Escritório B', '11144477735', '21912345678',
     'joao@exemplo.com', 'Rua B', 'nota B', '1985-05-05');
end $$;

-- Demandas e tarefas
do $$
declare
  v_a uuid := (select v from t_ids where k = 'org_a');
  v_b uuid := (select v from t_ids where k = 'org_b');
  v_cat_sm uuid; v_waiting uuid; v_cat_b uuid;
begin
  select id into v_cat_sm from demand_categories where organization_id = v_a and name = 'Salário-maternidade';
  select id into v_waiting from workflow_stages where category_id = v_cat_sm and is_waiting_docs;
  select id into v_cat_b from demand_categories where organization_id = v_b and name = 'Aposentadoria';

  insert into demands (organization_id, client_id, category_id, title, responsible_id, opened_at)
  values (v_a, 'c0000000-0000-0000-0000-00000000000a', v_cat_sm, 'Salário-maternidade Maria',
          'a1000000-0000-0000-0000-000000000002', public.ai_today());
  -- demanda parada há 20 dias, aguardando documentação
  insert into demands (organization_id, client_id, category_id, stage_id, title, opened_at)
  values (v_a, 'c0000000-0000-0000-0000-00000000000a', v_cat_sm, v_waiting, 'SM parada', public.ai_today() - 30);
  update demands set stage_changed_at = now() - interval '20 days' where title = 'SM parada';

  insert into demands (organization_id, client_id, category_id, title, opened_at)
  values (v_b, 'c0000000-0000-0000-0000-00000000000b', v_cat_b, 'Demanda do B', public.ai_today() - 40);
  update demands set stage_changed_at = now() - interval '40 days' where title = 'Demanda do B';

  insert into tasks (organization_id, title, client_id, due_date, assignee_id) values
    (v_a, 'Tarefa atrasada A', 'c0000000-0000-0000-0000-00000000000a', public.ai_today() - 3,
     'a1000000-0000-0000-0000-000000000003'),
    (v_a, 'Tarefa próxima A', null, public.ai_today() + 2, null),
    (v_b, 'Tarefa atrasada B', 'c0000000-0000-0000-0000-00000000000b', public.ai_today() - 5, null);

  insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
  values (v_a, 'c0000000-0000-0000-0000-00000000000a', 3000, 3, public.ai_today() - 40);
end $$;

-- Função auxiliar de teste: falha se o jsonb contiver chaves sensíveis ou dados pessoais
create or replace function pg_temp.assert_no_pii(p jsonb, p_label text) returns void language plpgsql as $$
declare v_txt text := p::text;
begin
  if v_txt ~* '"(cpf|phone|email|address|birth_date|notes)"' then
    raise exception '[%] resultado contém chave sensível: %', p_label, v_txt;
  end if;
  if v_txt like '%52998224725%' or v_txt like '%11987654321%' or v_txt like '%maria@exemplo.com%'
     or v_txt like '%Rua Secreta%' or v_txt like '%sigilosa%' or v_txt like '%1990-01-01%' then
    raise exception '[%] resultado contém dado pessoal: %', p_label, v_txt;
  end if;
end $$;
grant execute on function pg_temp.assert_no_pii(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Como membro (advogado) do escritório A
-- ---------------------------------------------------------------------------
set role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002"}', true); end $$;

do $$
declare
  v_a uuid := (select v from t_ids where k = 'org_a');
  r jsonb;
begin
  r := public.ai_stalled_demands(v_a, 15);
  if (r->>'total')::int <> 1 or r->'items'->0->>'title' <> 'SM parada' then
    raise exception 'ai_stalled_demands: esperado 1 demanda parada, veio %', r;
  end if;
  if (r->'items'->0->>'days_stalled')::int < 20 then raise exception 'days_stalled incorreto: %', r; end if;
  perform pg_temp.assert_no_pii(r, 'stalled');

  -- clamp: p_days absurdo vira 365; negativo vira 1
  r := public.ai_stalled_demands(v_a, 100000);
  if (r->>'min_days')::int <> 365 then raise exception 'clamp p_days máx falhou: %', r; end if;
  r := public.ai_stalled_demands(v_a, -5);
  if (r->>'min_days')::int <> 1 then raise exception 'clamp p_days mín falhou: %', r; end if;

  r := public.ai_waiting_documents(v_a);
  if (r->>'total_demands')::int <> 1 or (r->>'distinct_clients')::int <> 1 then
    raise exception 'ai_waiting_documents incorreto: %', r;
  end if;
  perform pg_temp.assert_no_pii(r, 'waiting_docs');

  r := public.ai_overdue_tasks(v_a);
  if (r->>'total')::int <> 1 or r->'items'->0->>'assignee' <> 'Carla Assistente' then
    raise exception 'ai_overdue_tasks incorreto: %', r;
  end if;
  perform pg_temp.assert_no_pii(r, 'overdue');

  r := public.ai_upcoming_tasks(v_a, 7);
  if (r->>'total')::int <> 1 then raise exception 'ai_upcoming_tasks incorreto: %', r; end if;
  r := public.ai_upcoming_tasks(v_a, 9999);
  if (r->>'days')::int <> 60 then raise exception 'clamp upcoming falhou: %', r; end if;

  r := public.ai_weekly_summary(v_a);
  if (r->>'financial_restricted')::boolean then raise exception 'advogado deveria ver financeiro: %', r; end if;
  if (r->>'tasks_overdue_now')::int <> 1 then raise exception 'ai_weekly_summary incorreto: %', r; end if;
  perform pg_temp.assert_no_pii(r, 'weekly');
  -- data futura é limitada a hoje
  r := public.ai_weekly_summary(v_a, '2999-01-01');
  if (r->>'week_start')::date > public.ai_today() then raise exception 'p_start futuro aceito: %', r; end if;

  -- contagem com busca tolerante a acento/hífen e curingas tratados como literais
  r := public.ai_count_demands(v_a, 'salario maternidade', date_trunc('month', public.ai_today())::date, null, null);
  if (r->>'total')::int <> 1 then raise exception 'ai_count_demands (mês) incorreto: %', r; end if;
  r := public.ai_count_demands(v_a, 'Salário-maternidade');
  if (r->>'total')::int <> 2 then raise exception 'ai_count_demands (todas) incorreto: %', r; end if;
  r := public.ai_count_demands(v_a, '%');
  if (r->>'total')::int <> 0 then raise exception 'curinga %% não foi escapado: %', r; end if;
  r := public.ai_count_demands(v_a);
  if (r->>'total')::int <> 2 then raise exception 'ai_count_demands sem filtro incorreto: %', r; end if;
  begin
    perform public.ai_count_demands(v_a, null, null, null, 'inexistente');
    raise exception 'status inválido deveria falhar';
  exception when sqlstate '22023' then null;
  end;

  r := public.ai_clients_awaiting(v_a);
  if (r->>'total_clients')::int <> 1 or r->'items'->0->>'client' <> 'Maria Souza' then
    raise exception 'ai_clients_awaiting incorreto: %', r;
  end if;
  perform pg_temp.assert_no_pii(r, 'clients_awaiting');

  r := public.ai_financial_overview(v_a);
  if (r->>'fees_expected')::numeric <> 3000 or (r->>'overdue_installments_count')::int < 1 then
    raise exception 'ai_financial_overview incorreto: %', r;
  end if;
  perform pg_temp.assert_no_pii(r, 'financial');

  r := public.ai_office_overview(v_a);
  if (r->>'demands_in_progress')::int <> 2 or (r->>'tasks_overdue')::int <> 1 then
    raise exception 'ai_office_overview incorreto: %', r;
  end if;
  perform pg_temp.assert_no_pii(r, 'office');

  -- Isolamento: os dados do escritório B não aparecem em nenhuma ferramenta do A
  if public.ai_stalled_demands(v_a, 1)::text like '%Demanda do B%'
     or public.ai_overdue_tasks(v_a)::text like '%Tarefa atrasada B%'
     or public.ai_clients_awaiting(v_a)::text like '%João do Escritório B%' then
    raise exception 'vazamento de dados do escritório B para o A';
  end if;
end $$;

-- Histórico de IA: gravação com o JWT do usuário e exclusão em cascata (fluxo da Edge Function/UI)
do $$
declare
  v_a uuid := (select v from t_ids where k = 'org_a');
  v_conv uuid;
begin
  insert into ai_conversations (organization_id, user_id, title)
  values (v_a, 'a1000000-0000-0000-0000-000000000002', 'Teste') returning id into v_conv;
  insert into ai_messages (organization_id, conversation_id, user_id, role, content, tools_used)
  values (v_a, v_conv, 'a1000000-0000-0000-0000-000000000002', 'user', 'oi', '{}'),
         (v_a, v_conv, 'a1000000-0000-0000-0000-000000000002', 'assistant', 'olá', '{ai_office_overview}');
  insert into t_ids values ('conv_adv', v_conv);
end $$;

-- Membro do A tentando consultar o escritório B → 42501 em todas as ferramentas
do $$
declare
  v_b uuid := (select v from t_ids where k = 'org_b');
  f text;
begin
  foreach f in array array['ai_stalled_demands(%L)', 'ai_waiting_documents(%L)', 'ai_overdue_tasks(%L)',
    'ai_upcoming_tasks(%L)', 'ai_weekly_summary(%L)', 'ai_count_demands(%L)', 'ai_clients_awaiting(%L)',
    'ai_financial_overview(%L)', 'ai_office_overview(%L)'] loop
    begin
      execute 'select public.' || format(f, v_b);
      raise exception 'não-membro executou %', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Assistente do escritório A: vê operacional, não vê financeiro
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003"}', true); end $$;
do $$
declare
  v_a uuid := (select v from t_ids where k = 'org_a');
  r jsonb;
begin
  r := public.ai_overdue_tasks(v_a);
  if (r->>'total')::int <> 1 then raise exception 'assistente deveria ver tarefas: %', r; end if;
  begin
    perform public.ai_financial_overview(v_a);
    raise exception 'assistente acessou ai_financial_overview';
  exception when insufficient_privilege then
    null;
  end;
  r := public.ai_weekly_summary(v_a);
  if not (r->>'financial_restricted')::boolean or r->>'payments_received' is not null then
    raise exception 'assistente recebeu valores financeiros no resumo semanal: %', r;
  end if;
  -- conversas de IA são privadas por usuário
  if exists (select 1 from ai_conversations where id = (select v from t_ids where k = 'conv_adv'))
     or exists (select 1 from ai_messages where conversation_id = (select v from t_ids where k = 'conv_adv')) then
    raise exception 'assistente viu conversa de IA do advogado';
  end if;
end $$;

-- O dono exclui a conversa → mensagens removidas em cascata
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002"}', true); end $$;
do $$
declare v_conv uuid := (select v from t_ids where k = 'conv_adv');
begin
  if (select count(*) from ai_messages where conversation_id = v_conv) <> 2 then
    raise exception 'dono não vê as próprias mensagens';
  end if;
  delete from ai_conversations where id = v_conv;
  if not found then raise exception 'dono não conseguiu excluir a conversa'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from ai_messages where conversation_id = (select v from t_ids where k = 'conv_adv')) then
    raise exception 'mensagens não foram excluídas em cascata';
  end if;
end $$;
set role authenticated;

-- ---------------------------------------------------------------------------
-- Admin do escritório B: só vê o B
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from t_ids where k = 'org_a');
  v_b uuid := (select v from t_ids where k = 'org_b');
  r jsonb;
begin
  r := public.ai_stalled_demands(v_b, 15);
  if (r->>'total')::int <> 1 or r->'items'->0->>'title' <> 'Demanda do B' then
    raise exception 'B: ai_stalled_demands incorreto: %', r;
  end if;
  if r::text like '%Maria Souza%' then raise exception 'B viu cliente do A'; end if;
  begin
    perform public.ai_office_overview(v_a);
    raise exception 'admin do B acessou o A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Usuário sem escritório e usuário anônimo
do $$ begin perform set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
begin
  perform public.ai_office_overview((select v from t_ids where k = 'org_a'));
  raise exception 'usuário sem vínculo acessou o escritório A';
exception when insufficient_privilege then null;
end $$;

reset role;
set role anon;
do $$
begin
  perform public.ai_office_overview('00000000-0000-0000-0000-000000000000');
  raise exception 'anon executou ferramenta de IA';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\echo '✔ ai_tools_test: ok'
