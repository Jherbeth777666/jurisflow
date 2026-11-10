-- Testes da migration 006 (modelos de mensagem e checklist de pendências).
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação desfeita no final.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-000000000001', 'ck.admin.a@teste.local',  '{"full_name":"Ana Admin"}'),
  ('a6000000-0000-0000-0000-000000000002', 'ck.adv.a@teste.local',    '{"full_name":"Bruno Advogado"}'),
  ('a6000000-0000-0000-0000-000000000003', 'ck.assist.a@teste.local', '{"full_name":"Carla Assistente"}'),
  ('b6000000-0000-0000-0000-000000000001', 'ck.admin.b@teste.local',  '{"full_name":"Diego Admin B"}'),
  ('c6000000-0000-0000-0000-000000000001', 'ck.fora@teste.local',     '{"full_name":"Estranho"}');

create temp table ck_ids (k text primary key, v uuid);
grant all on ck_ids to authenticated;

do $$
declare v_a uuid; v_b uuid; v_cat_a uuid; v_cat_b uuid; v_d_a uuid; v_d_b uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-000000000001"}', true);
  v_a := public.create_organization('Escritório Checklist A');
  perform set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-000000000001"}', true);
  v_b := public.create_organization('Escritório Checklist B');

  insert into organization_members (organization_id, user_id, role) values
    (v_a, 'a6000000-0000-0000-0000-000000000002', 'advogado'),
    (v_a, 'a6000000-0000-0000-0000-000000000003', 'assistente');

  insert into clients (id, organization_id, full_name) values
    ('c6000000-0000-0000-0000-00000000000a', v_a, 'Cliente A'),
    ('c6000000-0000-0000-0000-00000000000b', v_b, 'Cliente B');

  select id into v_cat_a from demand_categories where organization_id = v_a and name = 'Salário-maternidade';
  select id into v_cat_b from demand_categories where organization_id = v_b and name = 'Salário-maternidade';

  insert into demands (organization_id, client_id, category_id, title)
  values (v_a, 'c6000000-0000-0000-0000-00000000000a', v_cat_a, 'Demanda A') returning id into v_d_a;
  insert into demands (organization_id, client_id, category_id, title)
  values (v_b, 'c6000000-0000-0000-0000-00000000000b', v_cat_b, 'Demanda B') returning id into v_d_b;

  insert into ck_ids values ('org_a', v_a), ('org_b', v_b), ('cat_a', v_cat_a), ('cat_b', v_cat_b),
                            ('d_a', v_d_a), ('d_b', v_d_b);
end $$;

-- ---------------------------------------------------------------------------
-- Modelos padrão criados para as categorias conhecidas (trigger + onboarding)
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v from ck_ids where k = 'org_a');
  n int;
  c record;
begin
  for c in select name from demand_categories where organization_id = v_a
            and name in ('Salário-maternidade','Aposentadoria','Benefícios por incapacidade',
                         'Benefícios relacionados à pesca','Demandas trabalhistas') loop
    select count(*) into n from checklist_templates t join demand_categories dc on dc.id = t.category_id
     where dc.organization_id = v_a and dc.name = c.name;
    if n < 5 then raise exception 'categoria % deveria ter modelos padrão (tem %)', c.name, n; end if;
  end loop;
  select count(*) into n from checklist_templates t join demand_categories dc on dc.id = t.category_id
   where dc.organization_id = v_a and dc.name in ('Contratos','Outros');
  if n <> 0 then raise exception 'Contratos/Outros não deveriam ter modelos padrão (%).', n; end if;
  if not exists (select 1 from checklist_templates t join demand_categories dc on dc.id = t.category_id
                  where dc.organization_id = v_a and dc.name = 'Salário-maternidade'
                    and t.label = 'Certidão de nascimento da criança') then
    raise exception 'item esperado ausente em Salário-maternidade';
  end if;
  -- seed_default_checklists é idempotente e respeita categorias já semeadas
  if public.seed_default_checklists(v_a) <> 0 then raise exception 'seed_default_checklists duplicou modelos'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Assistente do A: lê, aplica modelo, marca itens; não exclui
-- ---------------------------------------------------------------------------
set role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-000000000003"}', true); end $$;
do $$
declare
  v_a uuid := (select v from ck_ids where k = 'org_a');
  v_d uuid := (select v from ck_ids where k = 'd_a');
  v_cat uuid := (select v from ck_ids where k = 'cat_a');
  n int; m int; v_item uuid; r record;
begin
  select count(*) into m from checklist_templates where category_id = v_cat;
  n := public.apply_checklist_template(v_d);
  if n <> m or n = 0 then raise exception 'apply: esperado % itens, inseriu %', m, n; end if;
  n := public.apply_checklist_template(v_d);
  if n <> 0 then raise exception 'apply não é idempotente (inseriu % na 2ª vez)', n; end if;
  if (select count(*) from demand_checklist_items where demand_id = v_d) <> m then
    raise exception 'quantidade de itens após apply incorreta';
  end if;

  -- item manual com mesmo rótulo de um modelo → apply continua sem duplicar
  insert into demand_checklist_items (organization_id, demand_id, label, position)
  values (v_a, v_d, 'Procuração assinada', 99) returning id into v_item;
  if public.apply_checklist_template(v_d) <> 0 then raise exception 'apply duplicou após item manual'; end if;

  -- rótulo duplicado (case/espaços) é bloqueado
  begin
    insert into demand_checklist_items (organization_id, demand_id, label) values (v_a, v_d, '  procuração ASSINADA ');
    raise exception 'rótulo duplicado aceito';
  exception when unique_violation then null;
  end;

  -- marcar: done_at/done_by preenchidos pelo banco (cliente não forja)
  update demand_checklist_items set done = true, done_by = 'a6000000-0000-0000-0000-000000000001' where id = v_item;
  select * into r from demand_checklist_items where id = v_item;
  if r.done_at is null or r.done_by <> 'a6000000-0000-0000-0000-000000000003' then
    raise exception 'done_at/done_by não definidos pelo banco: %', row_to_json(r);
  end if;
  update demand_checklist_items set label = 'Procuração assinada (via original)' where id = v_item;
  select * into r from demand_checklist_items where id = v_item;
  if r.done_at is null then raise exception 'renomear apagou done_at'; end if;
  update demand_checklist_items set done = false where id = v_item;
  select * into r from demand_checklist_items where id = v_item;
  if r.done_at is not null or r.done_by is not null then raise exception 'desmarcar não limpou done_at/done_by'; end if;

  -- assistente não exclui itens (RLS: delete só admin/advogado)
  delete from demand_checklist_items where id = v_item;
  if not exists (select 1 from demand_checklist_items where id = v_item) then
    raise exception 'assistente conseguiu excluir item';
  end if;

  -- assistente não edita modelos
  begin
    insert into checklist_templates (organization_id, category_id, label) values (v_a, v_cat, 'Novo modelo');
    raise exception 'assistente criou modelo de checklist';
  exception when insufficient_privilege then null;
  end;
  update checklist_templates set label = 'x' where category_id = v_cat;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'assistente alterou modelos de checklist'; end if;

  -- assistente lê modelos de mensagem, mas não cria
  begin
    insert into message_templates (organization_id, name, body) values (v_a, 'Teste', 'Olá {{primeiro_nome}}');
    raise exception 'assistente criou modelo de mensagem';
  exception when insufficient_privilege then null;
  end;

  -- reordenar itens
  perform public.reorder_checklist_items(v_d,
    (select array_agg(id order by position desc) from demand_checklist_items where demand_id = v_d));
  if (select label from demand_checklist_items where demand_id = v_d and position = 0) <> 'Procuração assinada (via original)' then
    raise exception 'reorder_checklist_items não reordenou';
  end if;
  begin
    perform public.reorder_checklist_items(v_d, array[v_item]);
    raise exception 'reorder com lista incompleta aceito';
  exception when raise_exception then
    if sqlerrm like 'reorder com lista%' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Advogado do A: exclui itens, CRUD de modelos de mensagem e checklist
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a6000000-0000-0000-0000-000000000002"}', true); end $$;
do $$
declare
  v_a uuid := (select v from ck_ids where k = 'org_a');
  v_d uuid := (select v from ck_ids where k = 'd_a');
  v_cat uuid := (select v from ck_ids where k = 'cat_a');
  v_t uuid; n int;
begin
  insert into message_templates (organization_id, name, subject, body)
  values (v_a, 'Lembrete personalizado', 'Assunto', 'Olá, {{primeiro_nome}}!') returning id into v_t;
  if (select created_by from message_templates where id = v_t) <> 'a6000000-0000-0000-0000-000000000002' then
    raise exception 'created_by não definido em message_templates';
  end if;
  update message_templates set body = 'Olá, {{primeiro_nome}}. Tudo bem?' where id = v_t;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'advogado não editou modelo de mensagem'; end if;
  begin
    insert into message_templates (organization_id, name, body) values (v_a, 'lembrete PERSONALIZADO', 'x');
    raise exception 'nome de modelo duplicado aceito';
  exception when unique_violation then null;
  end;

  insert into checklist_templates (organization_id, category_id, label, position) values (v_a, v_cat, 'Procuração assinada', 50);
  n := public.apply_checklist_template(v_d);
  if n <> 1 then raise exception 'apply deveria trazer só o novo modelo (trouxe %)', n; end if;

  delete from demand_checklist_items where demand_id = v_d and label = 'Procuração assinada';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'advogado não excluiu item'; end if;

  delete from message_templates where id = v_t;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'advogado não excluiu modelo de mensagem'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Isolamento: admin do B não vê nem altera dados do A; FK composta
-- ---------------------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
declare
  v_a uuid := (select v from ck_ids where k = 'org_a');
  v_b uuid := (select v from ck_ids where k = 'org_b');
  v_d_a uuid := (select v from ck_ids where k = 'd_a');
  v_cat_a uuid := (select v from ck_ids where k = 'cat_a');
  n int;
begin
  select count(*) into n from demand_checklist_items where organization_id = v_a;
  if n <> 0 then raise exception 'B viu itens do A (%)', n; end if;
  select count(*) into n from checklist_templates where organization_id = v_a;
  if n <> 0 then raise exception 'B viu modelos do A (%)', n; end if;
  update demand_checklist_items set done = true where organization_id = v_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B alterou itens do A'; end if;

  -- inserir com organization_id do A: RLS bloqueia
  begin
    insert into demand_checklist_items (organization_id, demand_id, label) values (v_a, v_d_a, 'Invasão');
    raise exception 'B inseriu item no A';
  exception when insufficient_privilege then null;
  end;
  -- inserir no próprio org apontando para demanda do A: FK composta bloqueia
  begin
    insert into demand_checklist_items (organization_id, demand_id, label) values (v_b, v_d_a, 'Cruzado');
    raise exception 'FK composta não impediu item ligado a demanda de outro escritório';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into checklist_templates (organization_id, category_id, label) values (v_b, v_cat_a, 'Cruzado');
    raise exception 'FK composta não impediu modelo ligado a categoria de outro escritório';
  exception when foreign_key_violation then null;
  end;

  -- apply em demanda de outro escritório: não encontrada
  begin
    perform public.apply_checklist_template(v_d_a);
    raise exception 'B aplicou modelo em demanda do A';
  exception when no_data_found then null;
  end;
end $$;

-- Usuário sem escritório
do $$ begin perform set_config('request.jwt.claims', '{"sub":"c6000000-0000-0000-0000-000000000001"}', true); end $$;
do $$
begin
  if exists (select 1 from message_templates) or exists (select 1 from demand_checklist_items)
     or exists (select 1 from checklist_templates) then
    raise exception 'usuário sem vínculo viu dados';
  end if;
end $$;

reset role;
set role anon;
do $$
begin
  perform 1 from public.demand_checklist_items;
  raise exception 'anon leu demand_checklist_items';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.apply_checklist_template('00000000-0000-0000-0000-000000000000');
  raise exception 'anon executou apply_checklist_template';
exception when insufficient_privilege then null;
end $$;
reset role;

-- Categoria criada depois do onboarding recebe modelos pelo trigger (se o nome bater)
do $$
declare v_a uuid := (select v from ck_ids where k = 'org_a'); v_cat uuid; n int;
begin
  insert into demand_categories (organization_id, name) values (v_a, 'Aposentadoria rural') returning id into v_cat;
  select count(*) into n from checklist_templates where category_id = v_cat;
  if n = 0 then raise exception 'trigger não semeou nova categoria de aposentadoria'; end if;
  insert into demand_categories (organization_id, name) values (v_a, 'Inventário') returning id into v_cat;
  select count(*) into n from checklist_templates where category_id = v_cat;
  if n <> 0 then raise exception 'categoria desconhecida não deveria receber modelos'; end if;
end $$;

rollback;
\echo '✔ checklists_test: ok'
