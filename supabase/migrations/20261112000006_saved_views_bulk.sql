-- =============================================================================
-- JurisFlow AI — Migration L13: filtros salvos e ações em massa
-- =============================================================================
-- * public.saved_views guarda combinações de filtros (query string) por pessoa,
--   com opção de compartilhar com o escritório. Só o dono altera/apaga.
-- * bulk_update_demands / bulk_update_tasks alteram vários itens de uma vez.
--   São SECURITY INVOKER: a RLS das tabelas continua valendo e os gatilhos
--   (histórico de etapa, conclusão, completed_at, auditoria) disparam normalmente.
-- =============================================================================

create table public.saved_views (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null,
  page             text not null check (page in ('demandas', 'tarefas')),
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  query            text not null check (char_length(query) <= 500),
  shared           boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id, page, name),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index saved_views_org_page_idx on public.saved_views(organization_id, page);

alter table public.saved_views enable row level security;

create policy saved_views_select on public.saved_views for select to authenticated
  using (public.is_org_member(organization_id) and (user_id = auth.uid() or shared));

create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy saved_views_update on public.saved_views for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy saved_views_delete on public.saved_views for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.saved_views from anon, authenticated;
grant select, insert, delete on public.saved_views to authenticated;
grant update (name, query, shared) on public.saved_views to authenticated;

-- -----------------------------------------------------------------------------
-- Demandas em massa. Chaves aceitas: responsible_id, priority, stage_id.
-- Devolve quantas demandas (do escritório, visíveis pela RLS) foram atualizadas.
-- -----------------------------------------------------------------------------
create or replace function public.bulk_update_demands(p_org uuid, p_ids uuid[], p_patch jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_resp  boolean;
  v_has_prio  boolean;
  v_has_stage boolean;
  v_resp      uuid;
  v_prio      public.priority_level;
  v_stage     uuid;
  v_cat       uuid;
  n           int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório.' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 200 then
    raise exception 'Informe de 1 a 200 demandas.' using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nenhuma alteração informada.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_patch) k
     where k <> all (array['responsible_id', 'priority', 'stage_id'])
  ) then
    raise exception 'Campo não permitido na alteração em massa.' using errcode = '22023';
  end if;

  v_has_resp  := p_patch ? 'responsible_id';
  v_has_prio  := p_patch ? 'priority';
  v_has_stage := p_patch ? 'stage_id';

  if v_has_resp then
    begin
      v_resp := (p_patch->>'responsible_id')::uuid;
    exception when others then
      raise exception 'Responsável inválido.' using errcode = '22023';
    end;
    if v_resp is not null and not exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_resp and m.active
    ) then
      raise exception 'O responsável precisa ser um membro ativo do escritório.' using errcode = '22023';
    end if;
  end if;

  if v_has_prio then
    begin
      v_prio := (p_patch->>'priority')::public.priority_level;
    exception when others then
      raise exception 'Prioridade inválida.' using errcode = '22023';
    end;
    if v_prio is null then
      raise exception 'Prioridade inválida.' using errcode = '22023';
    end if;
  end if;

  if v_has_stage then
    begin
      v_stage := (p_patch->>'stage_id')::uuid;
    exception when others then
      raise exception 'Etapa inválida.' using errcode = '22023';
    end;
    select s.category_id into v_cat
      from public.workflow_stages s
     where s.id = v_stage and s.organization_id = p_org;
    if v_cat is null then
      raise exception 'Etapa inválida.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.demands d
       where d.organization_id = p_org and d.id = any (p_ids) and d.category_id <> v_cat
    ) then
      raise exception 'A etapa precisa ser da mesma categoria de todas as demandas.' using errcode = '22023';
    end if;
  end if;

  update public.demands d set
    responsible_id = case when v_has_resp  then v_resp  else d.responsible_id end,
    priority       = case when v_has_prio  then v_prio  else d.priority end,
    stage_id       = case when v_has_stage then v_stage else d.stage_id end
   where d.organization_id = p_org
     and d.id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Tarefas em massa. Chaves aceitas: assignee_id, due_date, status.
-- O gatilho tasks_before_write preenche/limpa completed_at.
-- -----------------------------------------------------------------------------
create or replace function public.bulk_update_tasks(p_org uuid, p_ids uuid[], p_patch jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_assignee boolean;
  v_has_due      boolean;
  v_has_status   boolean;
  v_assignee     uuid;
  v_due          date;
  v_status       public.task_status;
  n              int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório.' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 200 then
    raise exception 'Informe de 1 a 200 tarefas.' using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nenhuma alteração informada.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_patch) k
     where k <> all (array['assignee_id', 'due_date', 'status'])
  ) then
    raise exception 'Campo não permitido na alteração em massa.' using errcode = '22023';
  end if;

  v_has_assignee := p_patch ? 'assignee_id';
  v_has_due      := p_patch ? 'due_date';
  v_has_status   := p_patch ? 'status';

  if v_has_assignee then
    begin
      v_assignee := (p_patch->>'assignee_id')::uuid;
    exception when others then
      raise exception 'Responsável inválido.' using errcode = '22023';
    end;
    if v_assignee is not null and not exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_assignee and m.active
    ) then
      raise exception 'O responsável precisa ser um membro ativo do escritório.' using errcode = '22023';
    end if;
  end if;

  if v_has_due then
    begin
      v_due := (p_patch->>'due_date')::date;
    exception when others then
      raise exception 'Data inválida.' using errcode = '22023';
    end;
  end if;

  if v_has_status then
    begin
      v_status := (p_patch->>'status')::public.task_status;
    exception when others then
      raise exception 'Status inválido.' using errcode = '22023';
    end;
    if v_status is null then
      raise exception 'Status inválido.' using errcode = '22023';
    end if;
  end if;

  update public.tasks t set
    assignee_id = case when v_has_assignee then v_assignee else t.assignee_id end,
    due_date    = case when v_has_due      then v_due      else t.due_date end,
    status      = case when v_has_status   then v_status   else t.status end
   where t.organization_id = p_org
     and t.id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bulk_update_demands(uuid, uuid[], jsonb) from public, anon;
revoke all on function public.bulk_update_tasks(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.bulk_update_demands(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.bulk_update_tasks(uuid, uuid[], jsonb) to authenticated;
