-- =============================================================================
-- JurisFlow AI — L9: demanda nasce pronta
-- =============================================================================
-- * task_templates: tarefas sugeridas por categoria (editáveis). offset_days é
--   um deslocamento em dias a partir da criação da demanda, usado apenas para
--   SUGERIR datas internas de organização — não são prazos jurídicos.
-- * kickoff_demand: aplica o checklist-modelo e cria as tarefas confirmadas pela
--   pessoa ao criar a demanda (tudo ou nada, respeitando a RLS de quem chama).
-- =============================================================================

create table public.task_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  category_id      uuid not null,
  title            text not null check (char_length(btrim(title)) between 3 and 160),
  offset_days      int check (offset_days is null or offset_days between 0 and 365),
  priority         public.priority_level not null default 'media',
  position         int not null default 0 check (position >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id)
    references public.demand_categories(organization_id, id) on delete cascade
);
create index task_templates_category_idx on public.task_templates(category_id, position);

create or replace function public.task_templates_before_write()
returns trigger language plpgsql as $$
begin
  new.title := btrim(new.title);
  return new;
end $$;

create trigger task_templates_trim before insert or update on public.task_templates
  for each row execute function public.task_templates_before_write();
create trigger task_templates_updated_at before update on public.task_templates
  for each row execute function public.set_updated_at();
create trigger task_templates_no_org_change before update on public.task_templates
  for each row execute function public.prevent_org_change();

-- RLS: ler membros; escrever admin/advogado (igual ao checklist-modelo)
alter table public.task_templates enable row level security;

create policy task_templates_select on public.task_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy task_templates_insert on public.task_templates for insert to authenticated
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy task_templates_update on public.task_templates for update to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]))
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy task_templates_delete on public.task_templates for delete to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));

revoke all on public.task_templates from anon;
grant select, insert, update, delete on public.task_templates to authenticated;

-- Reordena os modelos de tarefa de uma categoria (mesmo padrão do checklist).
create or replace function public.reorder_task_templates(p_category uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.task_templates where category_id = p_category)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'A lista de modelos está desatualizada. Recarregue a página.' using errcode = 'P0001';
  end if;
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.task_templates set position = i - 1 where id = p_ids[i] and category_id = p_category;
    if not found then raise exception 'Item inválido ou sem permissão.' using errcode = '42501'; end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- kickoff_demand (SECURITY INVOKER → RLS do usuário continua valendo)
-- p_tasks: [{ title, due_date (AAAA-MM-DD|null), priority, assignee_id|null }], máx. 20
-- -----------------------------------------------------------------------------
create or replace function public.kickoff_demand(p_demand uuid, p_checklist boolean, p_tasks jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_org     uuid;
  v_client  uuid;
  v_items   int := 0;
  v_created int := 0;
  v_tasks   jsonb := coalesce(p_tasks, '[]'::jsonb);
  t         jsonb;
  v_title   text;
  v_due     date;
  v_prio    public.priority_level;
  v_assign  uuid;
begin
  select organization_id, client_id into v_org, v_client from public.demands where id = p_demand;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Demanda não encontrada ou sem permissão.' using errcode = '42501';
  end if;

  if jsonb_typeof(v_tasks) <> 'array' then
    raise exception 'A lista de tarefas é inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_tasks) > 20 then
    raise exception 'No máximo 20 tarefas por vez.' using errcode = '22023';
  end if;

  if coalesce(p_checklist, false) then
    v_items := public.apply_checklist_template(p_demand);
  end if;

  for t in select value from jsonb_array_elements(v_tasks) loop
    begin
      if jsonb_typeof(t) <> 'object' then raise exception 'item inválido' using errcode = '22023'; end if;
      v_title := btrim(coalesce(t->>'title', ''));
      if char_length(v_title) not between 3 and 160 then
        raise exception 'O título da tarefa deve ter entre 3 e 160 caracteres.' using errcode = '22023';
      end if;
      v_due := nullif(t->>'due_date', '')::date;
      v_prio := coalesce(nullif(t->>'priority', ''), 'media')::public.priority_level;
      v_assign := nullif(t->>'assignee_id', '')::uuid;
    exception
      when sqlstate '22023' then raise;
      when others then
        raise exception 'Dados da tarefa inválidos (data, prioridade ou responsável).' using errcode = '22023';
    end;

    insert into public.tasks (organization_id, title, client_id, demand_id, assignee_id, due_date, priority, status)
    values (v_org, v_title, v_client, p_demand, v_assign, v_due, v_prio, 'pendente');
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('checklist_items', v_items, 'tasks_created', v_created);
end $$;

revoke all on function public.reorder_task_templates(uuid, uuid[]) from public, anon;
revoke all on function public.kickoff_demand(uuid, boolean, jsonb) from public, anon;
grant execute on function public.reorder_task_templates(uuid, uuid[]) to authenticated;
grant execute on function public.kickoff_demand(uuid, boolean, jsonb) to authenticated;
