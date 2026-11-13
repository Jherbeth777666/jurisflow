-- =============================================================================
-- JurisFlow AI — Migration L6: histórico de etapas e métricas operacionais
-- =============================================================================
-- * demand_stage_history guarda as passagens de cada demanda pelas etapas.
--   A escrita é feita apenas pelo trigger (SECURITY DEFINER); membros só leem.
-- * operational_metrics devolve gargalos por etapa e carga por responsável
--   calculados no banco, com dados reais e RLS do usuário (SECURITY INVOKER).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Histórico de etapas
-- -----------------------------------------------------------------------------
create table public.demand_stage_history (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  demand_id        uuid not null,
  stage_id         uuid,
  entered_at       timestamptz not null default now(),
  left_at          timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, demand_id)
    references public.demands(organization_id, id) on delete cascade
);

create index demand_stage_history_org_stage_idx
  on public.demand_stage_history(organization_id, stage_id, left_at);
create index demand_stage_history_demand_idx
  on public.demand_stage_history(demand_id, entered_at);
-- Uma única passagem aberta por demanda.
create unique index demand_stage_history_open_uidx
  on public.demand_stage_history(demand_id) where left_at is null;

alter table public.demand_stage_history enable row level security;

-- Membros leem; ninguém escreve direto (só o trigger SECURITY DEFINER).
create policy demand_stage_history_select on public.demand_stage_history for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.demand_stage_history from anon, authenticated;
grant select on public.demand_stage_history to authenticated;

-- -----------------------------------------------------------------------------
-- Trigger: mantém o histórico sincronizado com a etapa/status da demanda
-- -----------------------------------------------------------------------------
create or replace function public.demand_stage_history_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('concluida', 'cancelada') then
      insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
      values (new.organization_id, new.id, new.stage_id, new.stage_changed_at);
    end if;
    return new;
  end if;

  -- Conclusão/cancelamento: fecha a passagem aberta e não abre outra.
  if new.status in ('concluida', 'cancelada')
     and (old.status not in ('concluida', 'cancelada')
          or new.stage_id is distinct from old.stage_id) then
    update public.demand_stage_history
       set left_at = coalesce(new.closed_at, now())
     where organization_id = new.organization_id and demand_id = new.id and left_at is null;
    return new;
  end if;

  -- Mudança de etapa: fecha a passagem anterior e abre a nova.
  if new.stage_id is distinct from old.stage_id then
    update public.demand_stage_history
       set left_at = now()
     where organization_id = new.organization_id and demand_id = new.id and left_at is null;
    if new.status not in ('concluida', 'cancelada') then
      insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
      values (new.organization_id, new.id, new.stage_id, new.stage_changed_at);
    end if;
    return new;
  end if;

  -- Reabertura: abre uma nova passagem na etapa atual.
  if old.status in ('concluida', 'cancelada')
     and new.status not in ('concluida', 'cancelada') then
    insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
    select new.organization_id, new.id, new.stage_id, now()
     where not exists (
       select 1 from public.demand_stage_history
        where demand_id = new.id and left_at is null
     );
  end if;

  return new;
end $$;

create trigger demands_stage_history_after_insert after insert on public.demands
  for each row execute function public.demand_stage_history_sync();
create trigger demands_stage_history_after_update after update on public.demands
  for each row execute function public.demand_stage_history_sync();

revoke all on function public.demand_stage_history_sync() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Backfill: demandas já abertas ganham a passagem atual
-- -----------------------------------------------------------------------------
insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
select d.organization_id, d.id, d.stage_id, d.stage_changed_at
  from public.demands d
 where d.status not in ('concluida', 'cancelada');

-- -----------------------------------------------------------------------------
-- RPC: métricas operacionais (gargalos e carga)
-- -----------------------------------------------------------------------------
create or replace function public.operational_metrics(p_org uuid, p_days int default 90)
returns jsonb language plpgsql stable security invoker
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
declare
  v_stages      jsonb;
  v_bottlenecks jsonb;
  v_workload    jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_days is null or p_days < 7 or p_days > 365 then
    raise exception 'O período deve estar entre 7 e 365 dias' using errcode = '22023';
  end if;

  with open_hist as (
    select h.stage_id,
           count(*)::int as open_now,
           round(avg(extract(epoch from (now() - h.entered_at)) / 86400.0)::numeric, 1) as avg_age_open_days,
           ceil(max(extract(epoch from (now() - h.entered_at)) / 86400.0))::int as oldest_open_days
      from public.demand_stage_history h
      join public.demands d
        on d.organization_id = h.organization_id and d.id = h.demand_id
     where h.organization_id = p_org
       and h.left_at is null
       and d.status not in ('concluida', 'cancelada')
     group by h.stage_id
  ),
  completed as (
    select h.stage_id,
           count(*)::int as passes_completed,
           round(avg(extract(epoch from (h.left_at - h.entered_at)) / 86400.0)::numeric, 1) as avg_days_completed
      from public.demand_stage_history h
     where h.organization_id = p_org
       and h.left_at is not null
       and h.left_at >= now() - make_interval(days => p_days)
     group by h.stage_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', s.name,
           'category_name', c.name,
           'position', s.position,
           'open_now', coalesce(o.open_now, 0),
           'avg_age_open_days', o.avg_age_open_days,
           'oldest_open_days', o.oldest_open_days,
           'avg_days_completed', k.avg_days_completed,
           'passes_completed', coalesce(k.passes_completed, 0)
         ) order by c.sort_order, c.name, s.position, s.id), '[]'::jsonb)
    into v_stages
    from public.workflow_stages s
    join public.demand_categories c
      on c.organization_id = s.organization_id and c.id = s.category_id
    left join open_hist o on o.stage_id = s.id
    left join completed k on k.stage_id = s.id
   where s.organization_id = p_org;

  select coalesce(jsonb_agg(e order by b.open_now desc, b.avg_age desc nulls last), '[]'::jsonb)
    into v_bottlenecks
    from (
      select e,
             (e->>'open_now')::int as open_now,
             (e->>'avg_age_open_days')::numeric as avg_age
        from jsonb_array_elements(v_stages) e
       where (e->>'open_now')::int > 0
       order by (e->>'open_now')::int desc, (e->>'avg_age_open_days')::numeric desc nulls last
       limit 5
    ) b;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', w.user_id,
           'name', w.name,
           'open_demands', w.open_demands,
           'open_tasks', w.open_tasks,
           'overdue_tasks', w.overdue_tasks,
           'next_actions_overdue', w.next_actions_overdue
         ) order by w.overdue_tasks desc, w.open_tasks desc, w.name), '[]'::jsonb)
    into v_workload
    from (
      select m.user_id,
             coalesce(nullif(pr.full_name, ''), split_part(pr.email::text, '@', 1), 'Membro') as name,
             (select count(*)::int from public.demands d
               where d.organization_id = m.organization_id and d.responsible_id = m.user_id
                 and d.status not in ('concluida', 'cancelada')) as open_demands,
             (select count(*)::int from public.tasks t
               where t.organization_id = m.organization_id and t.assignee_id = m.user_id
                 and t.status in ('pendente', 'em_andamento')) as open_tasks,
             (select count(*)::int from public.tasks t
               where t.organization_id = m.organization_id and t.assignee_id = m.user_id
                 and t.status in ('pendente', 'em_andamento')
                 and t.due_date < current_date) as overdue_tasks,
             (select count(*)::int from public.demands d
               where d.organization_id = m.organization_id and d.responsible_id = m.user_id
                 and d.status not in ('concluida', 'cancelada')
                 and d.next_action_date < current_date) as next_actions_overdue
        from public.organization_members m
        join public.profiles pr on pr.id = m.user_id
       where m.organization_id = p_org and m.active
    ) w;

  return jsonb_build_object(
    'stages', v_stages,
    'bottlenecks', v_bottlenecks,
    'workload', v_workload
  );
end $$;

revoke all on function public.operational_metrics(uuid, int) from public, anon;
grant execute on function public.operational_metrics(uuid, int) to authenticated;
