-- Testes do lote L11: tarefas sugeridas ao entrar numa etapa do Kanban.
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação desfeita no final.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a8000000-0000-0000-0000-000000000001', 'st.admin.a@teste.local',   '{"full_name":"Ana Admin ST"}'),
  ('a8000000-0000-0000-0000-000000000002', 'st.adv.a@teste.local',     '{"full_name":"Bruno Advogado ST"}'),
  ('a8000000-0000-0000-0000-000000000003', 'st.assist.a@teste.local',  '{"full_name":"Carla Assistente ST"}'),
  ('b8000000-0000-0000-0000-000000000001', 'st.admin.b@teste.local',   '{"full_name":"Diego Admin ST B"}'),
  ('c8000000-0000-0000-0000-000000000001', 'st.fora@teste.local',      '{"full_name":"Estranho ST"}');

create temp table st_ids (k text primary key, v uuid);
grant all on st_ids to authenticated;

do $$
declare
  v_a uuid; v_b uuid;
  v_cat_m_a uuid; v_cat_ap_a uuid; v_cat_m_b uuid;
  v_stage_same uuid; v_stage_other_cat uuid; v_stage_other_org uuid;
  v_d_a uuid; v_d_b uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001"}', true);
  v_a := public.create_organization('Escritório Etapas A');
  perform set_config('request.jwt.claims', '{"sub":"b8000000-0000-0000-0000-000000000001"}', true);
  v_b := public.create_organization('Escritório Etapas B');

  insert into organization_members (organization_id, user_id, role) values
    (v_a, 'a8000000-0000-0000-0000-000000000002', 'advogado'),
    (v_a, 'a8000000-0000-0000-0000-000000000003', 'assistente');

  insert into clients (id, organization_id, full_name) values
    ('c8000000-0000-0000-0000-00000000000a', v_a, 'Cliente Etapas A'),
    ('c8000000-0000-0000-0000-00000000000b', v_b, 'Cliente Etapas B');

  select id into v_cat_m_a  from demand_categories where organization_id = v_a and name = 'Salário-maternidade';
  select id into v_cat_ap_a from demand_categories where organization_id = v_a and name = 'Aposentadoria';
  select id into v_cat_m_b  from demand_categories where organization_id = v_b and name = 'Salário-maternidade';

  -- Mesma categoria, outra categoria e outro escritório.
  select id into v_stage_same      from workflow_stages where category_id = v_cat_m_a  order by position limit 1;
  select id into v_stage_other_cat from workflow_stages where category_id = v_cat_ap_a order by position limit 1;
  select id into v_stage_other_org from workflow_stages where category_id = v_cat_m_b  order by position limit 1;

  insert into demands (organization_id, client_id, category_id, title)
  values (v_a, 'c8000000-0000-0000-0000-00000000000a', v_cat_m_a, 'Demanda Etapas A')
  returning id into v_d_a;

  insert into demands (organization_id, client_id, category_id, title)
  values (v_b, 'c8000000-0000-0000-0000-00000000000b', v_cat_m_b, 'Demanda Etapas B')
  returning id into v_d_b;

  insert into st_ids values
    ('org_a', v_a), ('org_b', v_b),
    ('cat_m_a', v_cat_m_a), ('cat_ap_a', v_cat_ap_a), ('cat_m_b', v_cat_m_b),
    ('stage_same', v_stage_same),
    ('stage_other_cat', v_stage_other_cat),
    ('stage_other_org', v_stage_other_org),
    ('d_a', v_d_a), ('d_b', v_d_b);
end $$;

-- ---------------------------------------------------------------------------
-- Admin do A grava modelo de etapa da mesma categoria (e mantém o de criação)
-- ---------------------------------------------------------------------------
set role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_stage uuid := (select v from st_ids where k = 'stage_same');
  n int;
begin
  insert into task_templates (organization_id, category_id, stage_id, title, offset_days, priority, position)
  values (v_a, v_cat, v_stage, 'Modelo da etapa', 0, 'media', 0);

  insert into task_templates (organization_id, category_id, stage_id, title, offset_days, priority, position)
  values (v_a, v_cat, null, 'Modelo de criação', 2, 'alta', 1);

  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 2 then raise exception 'admin deveria ver 2 modelos (viu %)', n; end if;

  select count(*) into n from task_templates where organization_id = v_a and stage_id = v_stage;
  if n <> 1 then raise exception 'modelo com etapa da mesma categoria não gravou stage_id'; end if;

  select count(*) into n from task_templates where organization_id = v_a and stage_id is null;
  if n <> 1 then raise exception 'modelo de criação deveria manter stage_id nulo'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Etapa de outra categoria ou de outro escritório falha (23503)
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_stage_other_cat uuid := (select v from st_ids where k = 'stage_other_cat');
  v_stage_other_org uuid := (select v from st_ids where k = 'stage_other_org');
begin
  begin
    insert into task_templates (organization_id, category_id, stage_id, title)
    values (v_a, v_cat, v_stage_other_cat, 'Modelo em etapa de outra categoria');
    raise exception 'modelo aceitou etapa de outra categoria';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into task_templates (organization_id, category_id, stage_id, title)
    values (v_a, v_cat, v_stage_other_org, 'Modelo em etapa de outro escritório');
    raise exception 'modelo aceitou etapa de outro escritório';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Excluir a etapa apaga os modelos dela e mantém os de criação
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_temp uuid;
  n int;
begin
  insert into workflow_stages (organization_id, category_id, name, position)
  values (v_a, v_cat, 'Etapa temporária L11', 99)
  returning id into v_temp;

  insert into task_templates (organization_id, category_id, stage_id, title, position)
  values (v_a, v_cat, v_temp, 'Modelo que sai com a etapa', 2);

  delete from workflow_stages where id = v_temp;

  select count(*) into n from task_templates where organization_id = v_a and title = 'Modelo que sai com a etapa';
  if n <> 0 then raise exception 'excluir a etapa não apagou o modelo dela (%)', n; end if;

  select count(*) into n from task_templates where organization_id = v_a and title = 'Modelo de criação';
  if n <> 1 then raise exception 'excluir a etapa apagou o modelo de criação (%)', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: assistente lê, mas não grava; outro escritório não lê
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000003"}', true); end $$;
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_stage uuid := (select v from st_ids where k = 'stage_same');
  n int;
begin
  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 2 then raise exception 'assistente deveria ler 2 modelos (leu %)', n; end if;

  begin
    insert into task_templates (organization_id, category_id, stage_id, title)
    values (v_a, v_cat, v_stage, 'Modelo do assistente');
    raise exception 'assistente criou modelo de etapa';
  exception when insufficient_privilege then null;
  end;

  update task_templates set title = 'Alterado pelo assistente' where organization_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'assistente alterou modelos de etapa'; end if;

  delete from task_templates where organization_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'assistente excluiu modelos de etapa'; end if;
end $$;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"b8000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_stage uuid := (select v from st_ids where k = 'stage_same');
  n int;
begin
  select count(*) into n from task_templates where organization_id = v_a;
  if n <> 0 then raise exception 'B viu modelos de etapa do A (%)', n; end if;

  begin
    insert into task_templates (organization_id, category_id, stage_id, title)
    values (v_a, v_cat, v_stage, 'Invasão de etapa');
    raise exception 'B inseriu modelo de etapa no A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- kickoff_demand(d, false, tarefas) cria as tarefas sem aplicar checklist
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from st_ids where k = 'org_a');
  v_cat uuid := (select v from st_ids where k = 'cat_m_a');
  v_d uuid := (select v from st_ids where k = 'd_a');
  v_res jsonb;
  v_task record;
  v_checklist_models int;
  n int;
begin
  select count(*) into v_checklist_models from checklist_templates
   where organization_id = v_a and category_id = v_cat;
  if v_checklist_models = 0 then
    raise exception 'categoria sem checklist-modelo para provar que p_checklist=false não aplica';
  end if;

  v_res := public.kickoff_demand(
    v_d,
    false,
    jsonb_build_array(jsonb_build_object(
      'title', 'Conferir documentos da etapa',
      'due_date', '2026-11-20',
      'priority', 'alta',
      'assignee_id', null
    ))
  );

  if (v_res->>'checklist_items')::int <> 0 then
    raise exception 'p_checklist=false aplicou checklist (% itens)', v_res->>'checklist_items';
  end if;
  if (v_res->>'tasks_created')::int <> 1 then
    raise exception 'p_checklist=false deveria criar 1 tarefa (criou %)', v_res->>'tasks_created';
  end if;

  select count(*) into n from demand_checklist_items where demand_id = v_d;
  if n <> 0 then raise exception 'p_checklist=false criou % itens de checklist', n; end if;

  select * into v_task from tasks
   where demand_id = v_d and title = 'Conferir documentos da etapa';
  if not found then raise exception 'tarefa da etapa não encontrada'; end if;
  if v_task.organization_id <> v_a then raise exception 'tarefa criada no escritório errado'; end if;
  if v_task.due_date <> date '2026-11-20' then raise exception 'due_date incorreta (%)', v_task.due_date; end if;
  if v_task.priority <> 'alta' then raise exception 'prioridade incorreta (%)', v_task.priority; end if;
  if v_task.status <> 'pendente' then raise exception 'tarefa deveria nascer pendente (%)', v_task.status; end if;
end $$;

rollback;
\echo '✔ stage_task_rules_test: ok'
