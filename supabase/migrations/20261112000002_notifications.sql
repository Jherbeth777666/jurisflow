-- =============================================================================
-- JurisFlow AI — Migration L7: avisos no app e alertas automáticos
-- =============================================================================
-- * public.notifications guarda os avisos de cada pessoa (poucos e úteis).
-- * O gerador diário (SECURITY DEFINER) calcula tudo das tabelas reais; não há
--   dado fictício nem nomes de clientes no texto (só contagens).
-- * A pessoa só lê as próprias notificações e marca leitura pelas RPCs; não
--   consegue inserir, alterar o texto nem chamar o gerador.
-- =============================================================================

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null,
  kind             text not null check (kind in (
                     'resumo_diario',
                     'tarefas_atrasadas',
                     'prazos_hoje',
                     'proximas_acoes_vencidas',
                     'demandas_paradas'
                   )),
  title            text not null check (char_length(title) <= 160),
  body             text check (char_length(body) <= 600),
  link             text check (char_length(link) <= 200 and link like '/%'),
  ref_date         date not null,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id, kind, ref_date),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index notifications_user_read_created_idx
  on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Gerador diário (cron / postgres). Revogado de authenticated: só o agendador.
-- -----------------------------------------------------------------------------
create or replace function public.generate_daily_notifications(
  p_day date default (now() at time zone 'America/Sao_Paulo')::date
)
returns void language plpgsql security definer
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
declare
  m             record;
  v_day         date := coalesce(p_day, (now() at time zone 'America/Sao_Paulo')::date);
  v_tasks_late  int;
  v_due_today   int;
  v_next_late   int;
  v_stalled     int;
  v_parts       text[];
  v_body        text;
begin
  -- Retenção: lidas há mais de 60 dias e não lidas há mais de 120 dias.
  delete from public.notifications
   where (read_at is not null and read_at < now() - interval '60 days')
      or (read_at is null and created_at < now() - interval '120 days');

  for m in
    select om.organization_id, om.user_id, om.role
      from public.organization_members om
     where om.active
  loop
    select count(*)::int into v_tasks_late
      from public.tasks t
     where t.organization_id = m.organization_id
       and t.assignee_id = m.user_id
       and t.status in ('pendente', 'em_andamento')
       and t.due_date < v_day;

    select count(*)::int into v_due_today
      from public.tasks t
     where t.organization_id = m.organization_id
       and t.assignee_id = m.user_id
       and t.status in ('pendente', 'em_andamento')
       and t.due_date = v_day;

    select count(*)::int into v_next_late
      from public.demands d
     where d.organization_id = m.organization_id
       and d.responsible_id = m.user_id
       and d.status not in ('concluida', 'cancelada')
       and d.next_action_date < v_day;

    v_stalled := 0;
    if m.role = 'admin' then
      select count(*)::int into v_stalled
        from public.demands d
       where d.organization_id = m.organization_id
         and d.status not in ('concluida', 'cancelada')
         and (d.stage_changed_at at time zone 'America/Sao_Paulo')::date <= v_day - 15;
    end if;

    if v_tasks_late > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'tarefas_atrasadas',
              v_tasks_late || case when v_tasks_late = 1 then ' tarefa atrasada' else ' tarefas atrasadas' end,
              '/tarefas', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_due_today > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'prazos_hoje',
              v_due_today || case when v_due_today = 1 then ' prazo hoje' else ' prazos hoje' end,
              '/agenda?v=hoje', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_next_late > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'proximas_acoes_vencidas',
              v_next_late || case
                when v_next_late = 1 then ' próxima ação vencida'
                else ' próximas ações vencidas'
              end,
              '/agenda?v=atrasados', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_stalled > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'demandas_paradas',
              v_stalled || case when v_stalled = 1 then ' demanda parada' else ' demandas paradas' end,
              '/relatorios', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_tasks_late > 0 or v_due_today > 0 or v_next_late > 0 or v_stalled > 0 then
      v_parts := array[]::text[];
      if v_due_today > 0 then
        v_parts := array_append(v_parts, v_due_today || case when v_due_today = 1 then ' prazo' else ' prazos' end);
      end if;
      if v_tasks_late > 0 then
        v_parts := array_append(v_parts,
          v_tasks_late || case when v_tasks_late = 1 then ' tarefa atrasada' else ' tarefas atrasadas' end);
      end if;
      if v_next_late > 0 then
        v_parts := array_append(v_parts,
          v_next_late || case
            when v_next_late = 1 then ' próxima ação vencida'
            else ' próximas ações vencidas'
          end);
      end if;
      if v_stalled > 0 then
        v_parts := array_append(v_parts,
          v_stalled || case when v_stalled = 1 then ' demanda parada' else ' demandas paradas' end);
      end if;
      v_body := 'Hoje: ' || array_to_string(v_parts, ', ') || '.';

      insert into public.notifications (organization_id, user_id, kind, title, body, link, ref_date)
      values (m.organization_id, m.user_id, 'resumo_diario', 'Resumo do dia', v_body, '/', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;
  end loop;
end $$;

revoke all on function public.generate_daily_notifications(date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Leitura: RPCs marcam só as notificações do próprio usuário.
-- -----------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications
       set read_at = now()
     where id = any(coalesce(p_ids, array[]::uuid[]))
       and user_id = auth.uid()
       and read_at is null
       and public.is_org_member(organization_id)
    returning 1
  )
  select count(*)::int into v_count from updated;

  return v_count;
end $$;

create or replace function public.mark_all_notifications_read(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications
       set read_at = now()
     where organization_id = p_org
       and user_id = auth.uid()
       and read_at is null
    returning 1
  )
  select count(*)::int into v_count from updated;

  return v_count;
end $$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Agendamento diário às 07:00 de São Paulo (10:00 UTC).
-- Tolerante a ambientes sem pg_cron (ex.: PostgreSQL simples dos testes).
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron indisponível (%); agendamento ignorado', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $sql$
        select cron.unschedule('jurisflow-notificacoes-diarias')
         where exists (select 1 from cron.job where jobname = 'jurisflow-notificacoes-diarias')
      $sql$;
    exception when others then
      raise notice 'não foi possível remover agendamento anterior: %', sqlerrm;
    end;

    begin
      execute $sql$
        select cron.schedule(
          'jurisflow-notificacoes-diarias',
          '0 10 * * *',
          'select public.generate_daily_notifications()'
        )
      $sql$;
    exception when others then
      raise notice 'não foi possível agendar as notificações diárias: %', sqlerrm;
    end;
  end if;
end $$;
