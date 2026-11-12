-- Testes do lote L9: tarefas-modelo por categoria e RPC kickoff_demand.
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação desfeita no final.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000001', 'tt.admin.a@teste.local',  '{"full_name":"Ana Admin TT"}'),
  ('a7000000-0000-0000-0000-000000000002', 'tt.adv.a@teste.local',    '{"full_name":"Bruno Advogado TT"}'),
  ('a7000000-0000-0000-0000-000000000003', 'tt.assist.a@teste.local', '{"full_name":"Carla Assistente TT"}'),
  ('b7000000-0000-0000-0000-000000000001', 'tt.admin.b@teste.local',  '{"full_name":"Diego Admin TT B"}'),
  ('c7000000-0000-0000-0000-000000000001', 'tt.fora@teste.local',     '{"full_name":"Estranho TT"}');

create temp table tt_ids (k text primary key, v uuid);
grant all on tt_ids to authenticated;

do $$
declare v_a uuid; v_b uuid; v_cat_a uuid; v_cat_b uuid; v_d_a uuid; v_d_b uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001"}', true);
  v_a := public.create_organization('Escritório Tarefas A');
  perform set_config('request.jwt.claims', '{"sub":"b7000000-0000-0000-0000-000000000001"}', true);
  v_b := public.create_organization('Escritório Tarefas B');

  insert into organization_members (organization_id, user_id, role) values
    (v_a, 'a7000000-0000-0000-0000-000000000002', 'advogado'),
    (v_a, 'a7000000-0000-0000-0000-000000000003', 'assistente');

  insert into clients (id, organization_id, full_name) values
    ('c7000000-0000-0000-0000-00000000000a', v_a, 'Cliente Tarefas A'),
    ('c7000000-0000-0000-0000-00000000000b', v_b, 'Cliente Tarefas B');

  select id into v_cat_a from demand_categories where organization_id = v_a and name = 'Salário-maternidade';
  select id into v_cat_b from demand_categories where organization_id = v_b and name = 'Salário-maternidade';

  insert into demands (organization_id, client_id, category_id, title)
  values (v_a, 'c7000000-0000-0000-0000-00000000000a', v_cat_a, 'Demanda Tarefas A') returning id into v_d_a;
  insert into demands (organization_id, client_id, category_id, title)
  values (v_b, 'c7000000-0000-0000-0000-00000000000b', v_cat_b, 'Demanda Tarefas B') returning id into v_d_b;

  insert into tt_ids values
    ('org_a', v_a), ('org_b', v_b), ('cat_a', v_cat_a), ('cat_b', v_cat_b),
    ('d_a', v_d_a), ('d_b', v_d_b);
end $$;

-- ---------------------------------------------------------------------------
-- Admin do A cria modelos; valida título, offset e prioridade
-- ---------------------------------------------------------------------------
set role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from tt_ids where k = 'org_a');
  v_cat uuid := (select v from tt_ids where k = 'cat_a');
  n int;
begin
  insert into task_templates (organization_id, category_id, title, offset_days, priority, position)
  values (v_a, v_cat, 'Conferir documentos pessoais do cliente', 0, 'media', 0);
  insert into task_templates (organization_id, category_id, title, offset_days, priority, position)
  values (v_a, v_cat, 'Solicitar documentos pendentes ao cliente', 2, 'alta', 1);
  insert into task_templates (organization_id, category_id, title, offset_days, priority, position)
  values (v_a, v_cat, 'Retorno ao cliente sobre o andamento', null, 'media', 2);

  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 3 then raise exception 'admin deveria ver 3 modelos de tarefa (viu %)', n; end if;

  begin
    insert into task_templates (organization_id, category_id, title) values (v_a, v_cat, 'ab');
    raise exception 'título com menos de 3 caracteres aceito';
  exception when check_violation then null;
  end;
  begin
    insert into task_templates (organization_id, category_id, title, offset_days) values (v_a, v_cat, 'Offset inválido', 366);
    raise exception 'offset_days acima de 365 aceito';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Assistente lê modelos, mas não cria/edita/exclui
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000003"}', true); end $$;
do $$
declare
  v_a uuid := (select v from tt_ids where k = 'org_a');
  v_cat uuid := (select v from tt_ids where k = 'cat_a');
  n int;
begin
  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 3 then raise exception 'assistente deveria ler 3 modelos de tarefa (leu %)', n; end if;

  begin
    insert into task_templates (organization_id, category_id, title) values (v_a, v_cat, 'Modelo do assistente');
    raise exception 'assistente criou modelo de tarefa';
  exception when insufficient_privilege then null;
  end;

  update task_templates set title = 'Alterado pelo assistente' where organization_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'assistente alterou modelos de tarefa'; end if;

  delete from task_templates where organization_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'assistente excluiu modelos de tarefa'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Advogado cria e exclui modelos (mesmos papéis do checklist-modelo)
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000002"}', true); end $$;
do $$
declare
  v_a uuid := (select v from tt_ids where k = 'org_a');
  v_cat uuid := (select v from tt_ids where k = 'cat_a');
  n int;
begin
  insert into task_templates (organization_id, category_id, title, position)
  values (v_a, v_cat, 'Modelo criado pelo advogado', 10);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'advogado não criou modelo de tarefa'; end if;

  delete from task_templates where organization_id = v_a and title = 'Modelo criado pelo advogado';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'advogado não excluiu modelo de tarefa'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Isolamento entre escritórios e FK composta
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"b7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from tt_ids where k = 'org_a');
  v_b uuid := (select v from tt_ids where k = 'org_b');
  v_cat_a uuid := (select v from tt_ids where k = 'cat_a');
  n int;
begin
  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 0 then raise exception 'B viu modelos de tarefa do A (%)', n; end if;

  begin
    insert into task_templates (organization_id, category_id, title) values (v_a, v_cat_a, 'Invasão');
    raise exception 'B inseriu modelo de tarefa no A';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into task_templates (organization_id, category_id, title) values (v_b, v_cat_a, 'Cruzado');
    raise exception 'FK composta não impediu modelo ligado a categoria de outro escritório';
  exception when foreign_key_violation then null;
  end;
end $$;

-- Usuário sem escritório não vê modelos.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
begin
  if exists (select 1 from task_templates) then
    raise exception 'usuário sem vínculo viu modelos de tarefa';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- kickoff_demand: cria tarefas no escritório/cliente da demanda e aplica checklist
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from tt_ids where k = 'org_a');
  v_cat uuid := (select v from tt_ids where k = 'cat_a');
  v_d uuid := (select v from tt_ids where k = 'd_a');
  v_checklist_count int;
  v_tasks_before int;
  v_res jsonb;
  v_task record;
  n int;
begin
  select count(*) into v_checklist_count from checklist_templates
   where organization_id = v_a and category_id = v_cat;
  if v_checklist_count = 0 then raise exception 'categoria sem modelos de checklist para testar o kickoff'; end if;

  v_res := public.kickoff_demand(
    v_d,
    true,
    jsonb_build_array(jsonb_build_object(
      'title', 'Conferir documentos pessoais do cliente',
      'due_date', '2026-11-20',
      'priority', 'alta',
      'assignee_id', 'a7000000-0000-0000-0000-000000000002'::uuid
    ))
  );

  if (v_res->>'checklist_items')::int <> v_checklist_count then
    raise exception 'kickoff deveria aplicar % itens de checklist (aplicou %)',
      v_checklist_count, v_res->>'checklist_items';
  end if;
  if (v_res->>'tasks_created')::int <> 1 then
    raise exception 'kickoff deveria criar 1 tarefa (criou %)', v_res->>'tasks_created';
  end if;

  select * into v_task from tasks
   where demand_id = v_d and title = 'Conferir documentos pessoais do cliente';
  if not found then raise exception 'tarefa do kickoff não encontrada'; end if;
  if v_task.organization_id <> v_a then raise exception 'tarefa criada no escritório errado'; end if;
  if v_task.client_id <> 'c7000000-0000-0000-0000-00000000000a' then
    raise exception 'tarefa deveria herdar o client_id da demanda (veio %)', v_task.client_id;
  end if;
  if v_task.status <> 'pendente' then raise exception 'tarefa deveria nascer pendente (%)', v_task.status; end if;
  if v_task.due_date <> date '2026-11-20' then raise exception 'due_date incorreta (%)', v_task.due_date; end if;
  if v_task.priority <> 'alta' then raise exception 'prioridade incorreta (%)', v_task.priority; end if;
  if v_task.assignee_id <> 'a7000000-0000-0000-0000-000000000002' then
    raise exception 'assignee_id incorreto (%)', v_task.assignee_id;
  end if;

  -- Chamar de novo não duplica o checklist, mas cria a nova tarefa.
  v_res := public.kickoff_demand(
    v_d,
    true,
    jsonb_build_array(jsonb_build_object(
      'title', 'Solicitar documentos pendentes ao cliente',
      'due_date', null,
      'priority', 'media',
      'assignee_id', null
    ))
  );
  if (v_res->>'checklist_items')::int <> 0 then
    raise exception 'segundo kickoff duplicou o checklist (%)', v_res->>'checklist_items';
  end if;
  if (v_res->>'tasks_created')::int <> 1 then
    raise exception 'segundo kickoff deveria criar 1 tarefa';
  end if;
  select count(*) into n from demand_checklist_items where demand_id = v_d;
  if n <> v_checklist_count then raise exception 'checklist da demanda deveria ter % itens (tem %)', v_checklist_count, n; end if;

  -- Sem p_checklist, não aplica checklist mesmo que ainda faltem itens.
  delete from demand_checklist_items where demand_id = v_d;
  v_res := public.kickoff_demand(
    v_d,
    false,
    jsonb_build_array(jsonb_build_object(
      'title', 'Retorno ao cliente sobre o andamento',
      'due_date', '2026-11-24',
      'priority', 'baixa',
      'assignee_id', null
    ))
  );
  if (v_res->>'checklist_items')::int <> 0 then raise exception 'p_checklist=false aplicou checklist'; end if;
  if (v_res->>'tasks_created')::int <> 1 then raise exception 'p_checklist=false deveria criar a tarefa'; end if;
  select count(*) into n from demand_checklist_items where demand_id = v_d;
  if n <> 0 then raise exception 'p_checklist=false criou % itens de checklist', n; end if;

  -- Validação: mais de 20 tarefas → 22023.
  v_tasks_before := (select count(*) from tasks where demand_id = v_d);
  begin
    perform public.kickoff_demand(
      v_d,
      false,
      (select jsonb_agg(jsonb_build_object(
         'title', 'Tarefa ' || g,
         'due_date', null,
         'priority', 'media',
         'assignee_id', null))
       from generate_series(1, 21) g)
    );
    raise exception 'kickoff aceitou 21 tarefas';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from tasks where demand_id = v_d) <> v_tasks_before then
    raise exception 'kickoff parcialmente inseriu tarefas antes de rejeitar 21 itens';
  end if;

  -- Validação: título curto, prioridade inexistente e data inválida → 22023.
  begin
    perform public.kickoff_demand(v_d, false, '[{"title":"ab","due_date":null,"priority":"media","assignee_id":null}]'::jsonb);
    raise exception 'kickoff aceitou título com 2 caracteres';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.kickoff_demand(v_d, false, '[{"title":"Tarefa válida","due_date":null,"priority":"altissima","assignee_id":null}]'::jsonb);
    raise exception 'kickoff aceitou prioridade inexistente';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.kickoff_demand(v_d, false, '[{"title":"Tarefa válida","due_date":"2026-02-30","priority":"media","assignee_id":null}]'::jsonb);
    raise exception 'kickoff aceitou data inválida';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- kickoff_demand: demanda de outro escritório / usuário sem vínculo → 42501
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"b7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare v_d_a uuid := (select v from tt_ids where k = 'd_a');
begin
  begin
    perform public.kickoff_demand(v_d_a, false, '[]'::jsonb);
    raise exception 'B executou kickoff em demanda do A';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare v_d_a uuid := (select v from tt_ids where k = 'd_a');
begin
  begin
    perform public.kickoff_demand(v_d_a, false, '[]'::jsonb);
    raise exception 'usuário sem vínculo executou kickoff';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- anon não lê modelos nem executa a RPC
-- ---------------------------------------------------------------------------
reset role;
set role anon;
do $$
begin
  perform 1 from public.task_templates;
  raise exception 'anon leu task_templates';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.kickoff_demand('00000000-0000-0000-0000-000000000000', false, '[]'::jsonb);
  raise exception 'anon executou kickoff_demand';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\echo '✔ task_templates_test: ok'
