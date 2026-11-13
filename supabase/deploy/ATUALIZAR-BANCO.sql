-- JurisFlow AI — atualização do banco (12 migrations novas, depois da 20261109000009).
-- Para quem JÁ rodou o BANCO-COMPLETO.sql antigo (migrations 001 a 009).
-- Cole TUDO no Supabase > SQL Editor > New query e clique em Run. Rodar uma única vez.
-- Gerado por scripts/gerar-sql-unico.py — não editar à mão.

-- Trava: para aqui se o banco não estiver na versão esperada (ou se esta atualização já rodou).
do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'Banco vazio: rode o BANCO-COMPLETO.sql em vez deste arquivo.';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000010') then
    raise exception 'Esta atualização já foi aplicada.';
  end if;
end $$;

-- >>>>>>>>>> 20261109000010_pre_launch_hardening.sql
-- -----------------------------------------------------------------------------
-- Endurecimento pré-lançamento: histórico de IA de ex-membros e consistência
-- de escritório nas mensagens.
-- -----------------------------------------------------------------------------

-- Excluir uma conversa exige continuar sendo membro ativo do escritório.
drop policy if exists ai_conv_delete on public.ai_conversations;
create policy ai_conv_delete on public.ai_conversations for delete to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

-- A conversa referenciada pela mensagem precisa ser do mesmo escritório,
-- do mesmo usuário e ele ainda precisa ser membro ativo.
drop policy if exists ai_msg_insert on public.ai_messages;
create policy ai_msg_insert on public.ai_messages for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_org_member(organization_id)
    and exists (select 1 from public.ai_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid()
                   and c.organization_id = ai_messages.organization_id)
  );

-- >>>>>>>>>> 20261111000001_today_panel.sql
-- =============================================================================
-- JurisFlow AI — Migration 011: painel "O que fazer hoje"
--  * dashboard_metrics ganha contadores de próximas ações vencidas e de hoje.
--  * Mesma assinatura/chaves anteriores de 20261109000007_integration_fixes.sql.
-- =============================================================================

create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'   -- "hoje" e meses no fuso do escritório (igual às ferramentas da IA)
as $$
declare
  v jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'clients_total',       (select count(*) from clients where organization_id = p_org and anonymized_at is null),
    'demands_in_progress', (select count(*) from demands where organization_id = p_org and status not in ('concluida','cancelada')),
    'demands_done',        (select count(*) from demands where organization_id = p_org and status = 'concluida'),
    'demands_waiting_docs',(select count(*) from demands d join workflow_stages s on s.id = d.stage_id
                             where d.organization_id = p_org and s.is_waiting_docs and d.status not in ('concluida','cancelada')),
    'tasks_pending',       (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento')),
    'tasks_overdue',       (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento') and due_date < current_date),
    'next_actions_overdue',(select count(*) from demands where organization_id = p_org
                             and status not in ('concluida','cancelada') and next_action_date < current_date),
    'next_actions_today',  (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida','cancelada') and next_action_date = current_date),
    'deadlines_upcoming',  (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento')
                             and due_date between current_date and current_date + 7),
    'fees_expected',       (select coalesce(sum(total_amount),0) from contracts where organization_id = p_org and status in ('ativo','quitado')),
    'fees_received',       (select coalesce(sum(p.amount),0) from payments p join contracts c on c.id = p.contract_id
                             where p.organization_id = p_org and c.status <> 'cancelado'),
    'installments_overdue',(select coalesce(sum(remaining_amount),0) from installment_overview
                             where organization_id = p_org and status = 'vencida'),
    'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('name', c.name, 'color', c.color, 'count', x.n) order by x.n desc)
          from demand_categories c
          join lateral (select count(*) n from demands d where d.category_id = c.id and d.status not in ('concluida','cancelada')) x on true
         where c.organization_id = p_org and x.n > 0), '[]'::jsonb),
    'by_status', coalesce((
        select jsonb_agg(jsonb_build_object('status', status, 'count', n))
          from (select status, count(*) n from demands where organization_id = p_org group by status) s), '[]'::jsonb),
    'monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'opened', (select count(*) from demands where organization_id = p_org and date_trunc('month', opened_at) = m),
                 'closed', (select count(*) from demands where organization_id = p_org and status = 'concluida' and date_trunc('month', closed_at) = m),
                 'new_clients', (select count(*) from clients where organization_id = p_org and date_trunc('month', created_at) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'revenue_monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'received', (select coalesce(sum(amount),0) from payments where organization_id = p_org and date_trunc('month', paid_at) = m),
                 'expected', (select coalesce(sum(amount),0) from installment_overview where organization_id = p_org and status not in ('cancelada','rascunho') and date_trunc('month', due_date) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'productivity', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'user_id', m.user_id,
                 'name', coalesce(nullif(p.full_name, ''), split_part(p.email::text, '@', 1)),
                 'tasks_done_30d', (select count(*) from tasks t where t.organization_id = p_org and t.assignee_id = m.user_id
                                     and t.status = 'concluida' and t.completed_at >= now() - interval '30 days'),
                 'demands_closed_30d', (select count(*) from demands d where d.organization_id = p_org and d.responsible_id = m.user_id
                                     and d.status = 'concluida' and d.closed_at >= now() - interval '30 days'),
                 'open_demands', (select count(*) from demands d where d.organization_id = p_org and d.responsible_id = m.user_id
                                     and d.status not in ('concluida','cancelada'))
               ))
          from organization_members m join profiles p on p.id = m.user_id
         where m.organization_id = p_org and m.active), '[]'::jsonb)
  ) into v;
  return v;
end $$;
grant execute on function public.dashboard_metrics(uuid) to authenticated;

-- >>>>>>>>>> 20261111000002_agenda.sql
-- =============================================================================
-- JurisFlow AI — Migration 012: agenda unificada
--  * Um lugar só para ver prazos: tarefas, próximas ações e parcelas.
--  * Somente leitura; não inventa eventos nem calcula prazo jurídico.
--  * Isolamento por escritório conferido explicitamente além da RLS.
-- =============================================================================

create or replace function public.agenda_items(
  p_org uuid,
  p_from date,
  p_to date,
  p_only_mine boolean default false
)
returns table (
  kind text,
  id uuid,
  title text,
  date date,
  overdue boolean,
  status text,
  client_id uuid,
  demand_id uuid,
  assignee_id uuid,
  amount numeric,
  contract_id uuid
)
language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'   -- "hoje" no fuso do escritório
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  if (p_to - p_from) > 62 then
    raise exception 'Intervalo máximo de 62 dias' using errcode = '22023';
  end if;

  return query
  with items as (
    -- Tarefas abertas com prazo no intervalo (ou vencidas, quando o intervalo
    -- começa em hoje ou antes — assim "Hoje" e "Atrasados" as mostram).
    select 'task'::text as kind,
           t.id,
           t.title,
           t.due_date as date,
           (t.due_date < current_date) as overdue,
           t.status::text as status,
           coalesce(t.client_id, d.client_id) as client_id,
           t.demand_id,
           t.assignee_id,
           null::numeric as amount,
           null::uuid as contract_id
      from public.tasks t
      left join public.demands d
        on d.id = t.demand_id and d.organization_id = t.organization_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date is not null
       and ((t.due_date between p_from and p_to)
            or (t.due_date < current_date and p_from <= current_date))
       and (not p_only_mine or t.assignee_id = auth.uid())

    union all

    -- Próximas ações de demandas não concluídas/canceladas.
    select 'next_action'::text as kind,
           d.id,
           coalesce(nullif(btrim(d.next_action), ''), 'Próxima ação') as title,
           d.next_action_date as date,
           (d.next_action_date < current_date) as overdue,
           d.status::text as status,
           d.client_id,
           d.id as demand_id,
           d.responsible_id as assignee_id,
           null::numeric as amount,
           null::uuid as contract_id
      from public.demands d
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and d.next_action_date is not null
       and ((d.next_action_date between p_from and p_to)
            or (d.next_action_date < current_date and p_from <= current_date))
       and (not p_only_mine or d.responsible_id = auth.uid())

    union all

    -- Parcelas em aberto (parcelas não pertencem a um responsável).
    select 'installment'::text as kind,
           io.id,
           'Parcela ' || io.number::text as title,
           io.due_date as date,
           (io.due_date < current_date) as overdue,
           io.status::text as status,
           io.client_id,
           null::uuid as demand_id,
           null::uuid as assignee_id,
           io.remaining_amount as amount,
           io.contract_id
      from public.installment_overview io
     where io.organization_id = p_org
       and io.status in ('a_vencer', 'parcial', 'vencida')
       and ((io.due_date between p_from and p_to)
            or (io.due_date < current_date and p_from <= current_date))
       and not p_only_mine
  )
  select i.kind, i.id, i.title, i.date, i.overdue, i.status, i.client_id,
         i.demand_id, i.assignee_id, i.amount, i.contract_id
    from items i
   order by i.date, i.kind, i.title, i.id;
end $$;

revoke all on function public.agenda_items(uuid, date, date, boolean) from public;
grant execute on function public.agenda_items(uuid, date, date, boolean) to authenticated;

-- >>>>>>>>>> 20261111000003_ai_proposals.sql
-- =============================================================================
-- JurisFlow AI — Migration 013: propostas da IA e confirmação pelo usuário
--  * A IA só PROPÕE ações; nada é gravado por ela.
--  * ai_messages.proposals guarda as propostas pendentes (jsonb, nulo sem propostas).
--  * ai_proposal_done() registra a decisão do DONO da conversa (confirmar/descartar),
--    valida vínculo com o escritório e grava auditoria só na confirmação,
--    com metadados (kind/proposal_id) — nunca os textos da proposta.
-- =============================================================================

alter table public.ai_messages add column proposals jsonb;

create or replace function public.ai_proposal_done(
  p_message uuid,
  p_proposal text,
  p_status text,
  p_entity uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_role    public.ai_role;
  v_props   jsonb;
  v_elem    jsonb;
  v_updated jsonb;
begin
  if p_status is null or p_status not in ('confirmada', 'descartada') then
    raise exception 'Status inválido: use confirmada ou descartada' using errcode = '22023';
  end if;

  -- Mensagem + conversa (dono = ai_conversations.user_id) + escritório.
  select m.organization_id, c.user_id, m.role, coalesce(m.proposals, '[]'::jsonb)
    into v_org, v_owner, v_role, v_props
    from public.ai_messages m
    join public.ai_conversations c
      on c.id = m.conversation_id
     and c.organization_id = m.organization_id
   where m.id = p_message;

  if v_org is null
     or v_role <> 'assistant'
     or v_owner <> auth.uid()
     or not public.is_org_member(v_org) then
    raise exception 'Sem permissão para confirmar esta proposta' using errcode = '42501';
  end if;

  select elem into v_elem
    from jsonb_array_elements(v_props) elem
   where elem->>'id' = p_proposal
   limit 1;

  if v_elem is null then
    raise exception 'Proposta não encontrada' using errcode = '22023';
  end if;

  if coalesce(v_elem->>'status', 'pendente') <> 'pendente' then
    raise exception 'Proposta já resolvida' using errcode = '22023';
  end if;

  select jsonb_agg(
           case
             when elem->>'id' = p_proposal then jsonb_set(elem, '{status}', to_jsonb(p_status))
             else elem
           end
           order by ord
         )
    into v_updated
    from jsonb_array_elements(v_props) with ordinality as t(elem, ord);

  update public.ai_messages set proposals = v_updated where id = p_message;

  if p_status = 'confirmada' then
    insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
    values (
      v_org,
      auth.uid(),
      'ai_proposals',
      coalesce(p_entity, p_message),
      'ai_confirmed',
      jsonb_build_object('kind', v_elem->>'kind', 'proposal_id', p_proposal)
    );
  end if;
end $$;
revoke all on function public.ai_proposal_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.ai_proposal_done(uuid, text, text, uuid) to authenticated;

-- >>>>>>>>>> 20261111000004_client_overview.sql
-- =============================================================================
-- JurisFlow AI — Migration 014: ficha 360° do cliente
--  * Um único retorno jsonb com o que está pendente para um cliente.
--  * Somente leitura, com dados reais e sem GED; RLS continua valendo
--    (security invoker) e o escritório é conferido pela visibilidade do cliente.
--  * "Hoje" no fuso do escritório, igual ao painel e à agenda.
-- =============================================================================

create or replace function public.client_overview(p_client uuid)
returns jsonb
language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'
as $$
declare
  v_org uuid;
  v_last_activity_at timestamptz;
begin
  -- A RLS de clients garante que só membros do escritório enxergam o cliente.
  select c.organization_id into v_org
    from public.clients c
   where c.id = p_client;

  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  -- Última movimentação: cliente, demandas e tarefas dele.
  select max(al.created_at) into v_last_activity_at
    from public.activity_logs al
   where al.organization_id = v_org
     and (
       (al.entity_type = 'clients' and al.entity_id = p_client)
       or (al.entity_type = 'demands' and al.entity_id in (
             select d.id from public.demands d
              where d.organization_id = v_org and d.client_id = p_client))
       or (al.entity_type = 'tasks' and al.entity_id in (
             select t.id from public.tasks t
              where t.organization_id = v_org
                and (t.client_id = p_client
                     or t.demand_id in (select d.id from public.demands d
                                         where d.organization_id = v_org and d.client_id = p_client))))
     );

  return jsonb_build_object(
    'open_demands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id,
               'title', x.title,
               'status', x.status,
               'stage_name', x.stage_name,
               'category_name', x.category_name,
               'next_action', x.next_action,
               'next_action_date', x.next_action_date,
               'next_action_overdue', x.next_action_overdue,
               'checklist_pending', x.checklist_pending,
               'checklist_total', x.checklist_total,
               'days_in_stage', x.days_in_stage
             ) order by x.created_at desc, x.id)
        from (
          select d.id,
                 d.title,
                 d.status::text as status,
                 coalesce(s.name, '') as stage_name,
                 coalesce(cat.name, '') as category_name,
                 d.next_action,
                 d.next_action_date,
                 coalesce(d.next_action_date < current_date, false) as next_action_overdue,
                 (select count(*) from public.demand_checklist_items i
                   where i.demand_id = d.id and not i.done)::int as checklist_pending,
                 (select count(*) from public.demand_checklist_items i
                   where i.demand_id = d.id)::int as checklist_total,
                 (current_date
                    - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date)::int as days_in_stage,
                 d.created_at
            from public.demands d
            left join public.workflow_stages s on s.id = d.stage_id
            left join public.demand_categories cat on cat.id = d.category_id
           where d.organization_id = v_org
             and d.client_id = p_client
             and d.status not in ('concluida', 'cancelada')
           order by d.created_at desc, d.id
           limit 20
        ) x
    ), '[]'::jsonb),

    'checklist_pending_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'demand_id', x.demand_id,
               'demand_title', x.demand_title,
               'label', x.label
             ) order by x.created_at, x.demand_id, x.position, x.item_id)
        from (
          select d.id as demand_id,
                 d.title as demand_title,
                 i.label,
                 i.position,
                 i.id as item_id,
                 d.created_at
            from public.demand_checklist_items i
            join public.demands d
              on d.id = i.demand_id and d.organization_id = i.organization_id
           where d.organization_id = v_org
             and d.client_id = p_client
             and d.status not in ('concluida', 'cancelada')
             and not i.done
           order by d.created_at, d.id, i.position, i.id
           limit 15
        ) x
    ), '[]'::jsonb),

    'tasks', (
      select jsonb_build_object(
               'open', count(*) filter (where t.status in ('pendente', 'em_andamento')),
               'overdue', count(*) filter (
                 where t.status in ('pendente', 'em_andamento') and t.due_date < current_date),
               'next_due_date', min(t.due_date) filter (
                 where t.status in ('pendente', 'em_andamento'))
             )
        from public.tasks t
       where t.organization_id = v_org
         and t.client_id = p_client
    ),

    'finance', (
      select jsonb_build_object(
               'open_amount', coalesce(sum(io.remaining_amount) filter (
                 where io.status in ('a_vencer', 'parcial', 'vencida')), 0),
               'overdue_amount', coalesce(sum(io.remaining_amount) filter (
                 where io.status = 'vencida'), 0),
               'overdue_count', count(*) filter (where io.status = 'vencida'),
               'next_due_date', min(io.due_date) filter (
                 where io.status in ('a_vencer', 'parcial', 'vencida'))
             )
        from public.installment_overview io
       where io.organization_id = v_org
         and io.client_id = p_client
    ),

    'last_activity_at', v_last_activity_at
  );
end $$;

revoke all on function public.client_overview(uuid) from public;
grant execute on function public.client_overview(uuid) to authenticated;

-- >>>>>>>>>> 20261112000001_stage_history.sql
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

-- >>>>>>>>>> 20261112000002_notifications.sql
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

-- >>>>>>>>>> 20261112000003_invite_link.sql
-- =============================================================================
-- L8 — Convite com link copiável
--   * organization_invitations ganha token (uuid, único, default) e expires_at
--     (14 dias);
--   * accept_pending_invitations() passa a ignorar convites expirados;
--   * invitation_preview(token) permite ao visitante ver o convite antes do
--     cadastro, sem expor ids nem a tabela;
--   * renew_invitation(id) renova o link (somente admin do escritório).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colunas token/expires_at + backfill dos convites existentes
-- ---------------------------------------------------------------------------
alter table public.organization_invitations
  add column if not exists token uuid,
  add column if not exists expires_at timestamptz;

update public.organization_invitations
   set token = gen_random_uuid()
 where token is null;

update public.organization_invitations
   set expires_at = created_at + interval '14 days'
 where expires_at is null;

alter table public.organization_invitations
  alter column token set default gen_random_uuid(),
  alter column token set not null,
  alter column expires_at set default now() + interval '14 days',
  alter column expires_at set not null;

create unique index if not exists organization_invitations_token_uidx
  on public.organization_invitations(token);

-- ---------------------------------------------------------------------------
-- 2. Aceite ignora convite expirado (mesma lógica da versão vigente + prazo)
-- ---------------------------------------------------------------------------
create or replace function public.accept_pending_invitations()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_email  citext;
  v_count  int := 0;
  inv      record;
begin
  if auth.uid() is null then return 0; end if;
  select email into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  for inv in
    select * from public.organization_invitations
     where email = v_email and accepted_at is null and expires_at > now()
     for update
  loop
    insert into public.organization_members as m (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), inv.role)
    on conflict (organization_id, user_id) do update
      set active = true,
          role = case when m.active then m.role else excluded.role end;
    update public.organization_invitations set accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.accept_pending_invitations() from public;
grant execute on function public.accept_pending_invitations() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prévia pública do convite (usada na tela de cadastro)
--    Devolve apenas o necessário; token inexistente → só {status: invalido}.
-- ---------------------------------------------------------------------------
create or replace function public.invitation_preview(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  inv      record;
  v_status text;
begin
  select i.email, i.role, i.accepted_at, i.expires_at, o.name as organization_name
    into inv
    from public.organization_invitations i
    join public.organizations o on o.id = i.organization_id
   where i.token = p_token;

  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;

  v_status := case
    when inv.accepted_at is not null then 'aceito'
    when inv.expires_at <= now() then 'expirado'
    else 'pendente'
  end;

  return jsonb_build_object(
    'organization_name', inv.organization_name,
    'email', inv.email::text,
    'role', inv.role,
    'status', v_status
  );
end $$;
revoke all on function public.invitation_preview(uuid) from public;
grant execute on function public.invitation_preview(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Renovação do convite (somente administrador do escritório)
-- ---------------------------------------------------------------------------
create or replace function public.renew_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  select organization_id into v_org
    from public.organization_invitations
   where id = p_invitation;

  if v_org is null then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;

  if not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Apenas administradores podem renovar convites.' using errcode = '42501';
  end if;

  update public.organization_invitations
     set token = gen_random_uuid(),
         expires_at = now() + interval '14 days',
         updated_at = now()
   where id = p_invitation;
end $$;
revoke all on function public.renew_invitation(uuid) from public;
grant execute on function public.renew_invitation(uuid) to authenticated;

-- >>>>>>>>>> 20261112000004_task_templates.sql
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

-- >>>>>>>>>> 20261112000005_stage_task_rules.sql
-- L11: regras por etapa. Um modelo de tarefa pode ser sugerido ao ENTRAR numa etapa do Kanban.
-- stage_id nulo = modelo de criação (comportamento do L9, inalterado). Nada é criado sem confirmação.
-- RLS, reorder_task_templates e kickoff_demand não mudam.

alter table public.task_templates add column stage_id uuid null;

-- A etapa precisa ser do mesmo escritório e da mesma categoria do modelo.
alter table public.task_templates
  add constraint task_templates_stage_org_fk
  foreign key (organization_id, stage_id) references public.workflow_stages (organization_id, id) on delete cascade;

alter table public.task_templates
  add constraint task_templates_stage_category_fk
  foreign key (category_id, stage_id) references public.workflow_stages (category_id, id) on delete cascade;

create index task_templates_stage_idx on public.task_templates (organization_id, stage_id);

-- >>>>>>>>>> 20261112000006_saved_views_bulk.sql
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

-- >>>>>>>>>> 20261112000007_import_batches.sql
-- =============================================================================
-- JurisFlow AI — Migration L14: importação com lote, desfazer e mapeamento lembrado
-- =============================================================================
-- * import_batches: um registro por importação (quem, quando, arquivo, contagens).
--   Nunca é apagado; "desfeito" é marcado por undo_import_batch().
-- * clients/demands.import_batch_id: ligam o que foi criado ao lote (FK composta).
-- * import_batch_updates: valor anterior/aplicado dos campos complementados.
-- * import_mappings: mapeamento de colunas lembrado por assinatura de cabeçalhos.
-- * undo_import_batch(): SECURITY DEFINER; remove só o que ainda não foi usado.
-- =============================================================================

create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  file_name        text check (file_name is null or char_length(file_name) <= 200),
  created_clients  int not null default 0 check (created_clients >= 0),
  updated_clients  int not null default 0 check (updated_clients >= 0),
  created_demands  int not null default 0 check (created_demands >= 0),
  undone_at        timestamptz,
  undone_by        uuid,
  undo_result      jsonb,
  unique (organization_id, id)
);

create index import_batches_org_created_idx on public.import_batches(organization_id, created_at desc);

alter table public.import_batches enable row level security;

create policy import_batches_select on public.import_batches for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_batches_insert on public.import_batches for insert to authenticated
  with check (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id));

create policy import_batches_update on public.import_batches for update to authenticated
  using (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id))
  with check (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id));

revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
grant insert (organization_id, created_by, file_name, created_clients, updated_clients, created_demands)
  on public.import_batches to authenticated;
grant update (created_clients, updated_clients, created_demands) on public.import_batches to authenticated;

-- -----------------------------------------------------------------------------
-- Ligação do que foi criado ao lote (sem cascade: o lote nunca é apagado)
-- -----------------------------------------------------------------------------
alter table public.clients add column import_batch_id uuid;
alter table public.clients add constraint clients_import_batch_fk
  foreign key (organization_id, import_batch_id) references public.import_batches(organization_id, id);
create index clients_import_batch_idx on public.clients(import_batch_id) where import_batch_id is not null;

alter table public.demands add column import_batch_id uuid;
alter table public.demands add constraint demands_import_batch_fk
  foreign key (organization_id, import_batch_id) references public.import_batches(organization_id, id);
create index demands_import_batch_idx on public.demands(import_batch_id) where import_batch_id is not null;

-- -----------------------------------------------------------------------------
-- Campos complementados em clientes existentes
-- -----------------------------------------------------------------------------
create table public.import_batch_updates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  batch_id         uuid not null,
  client_id        uuid not null,
  previous         jsonb not null check (
    jsonb_typeof(previous) = 'object' and (previous - array['cpf','phone','email','birth_date','address']) = '{}'::jsonb),
  applied          jsonb not null check (
    jsonb_typeof(applied) = 'object' and (applied - array['cpf','phone','email','birth_date','address']) = '{}'::jsonb),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, batch_id) references public.import_batches(organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create index import_batch_updates_batch_idx on public.import_batch_updates(batch_id);
create index import_batch_updates_client_idx on public.import_batch_updates(client_id);

alter table public.import_batch_updates enable row level security;

create policy import_batch_updates_select on public.import_batch_updates for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_batch_updates_insert on public.import_batch_updates for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.import_batches b
       where b.organization_id = import_batch_updates.organization_id
         and b.id = import_batch_updates.batch_id
         and b.created_by = auth.uid()
         and b.undone_at is null
    )
  );

revoke all on public.import_batch_updates from anon, authenticated;
grant select, insert on public.import_batch_updates to authenticated;

-- -----------------------------------------------------------------------------
-- Mapeamento lembrado por assinatura dos cabeçalhos
-- -----------------------------------------------------------------------------
create table public.import_mappings (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  signature        text not null check (char_length(signature) between 8 and 64),
  mapping          jsonb not null check (pg_column_size(mapping) <= 4096),
  category_map     jsonb not null default '{}'::jsonb check (pg_column_size(category_map) <= 8192),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, signature)
);

alter table public.import_mappings enable row level security;

create policy import_mappings_select on public.import_mappings for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_mappings_insert on public.import_mappings for insert to authenticated
  with check (public.is_org_member(organization_id));

create policy import_mappings_update on public.import_mappings for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on public.import_mappings from anon, authenticated;
grant select, insert on public.import_mappings to authenticated;
grant update (mapping, category_map, updated_by, updated_at) on public.import_mappings to authenticated;

-- -----------------------------------------------------------------------------
-- Desfazer importação
-- -----------------------------------------------------------------------------
create or replace function public.undo_import_batch(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch     public.import_batches%rowtype;
  v_removed_d int := 0;
  v_skipped_d int := 0;
  v_removed_c int := 0;
  v_skipped_c int := 0;
  v_restored  int := 0;
  v_skipped_f int := 0;
  v_result    jsonb;
  u           record;
  cur         jsonb;
  k           text;
  v_restore   jsonb;
  v_n         int;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a esta importação.' using errcode = '42501';
  end if;

  select * into v_batch from public.import_batches where id = p_batch for update;
  -- inexistente ou de outro escritório: mesma resposta
  if not found or not public.is_org_member(v_batch.organization_id) then
    raise exception 'Sem acesso a esta importação.' using errcode = '42501';
  end if;
  if v_batch.created_by <> auth.uid() and not public.has_org_role(v_batch.organization_id, array['admin']::public.member_role[]) then
    raise exception 'Só o administrador ou quem fez a importação pode desfazê-la.' using errcode = '42501';
  end if;
  if v_batch.undone_at is not null then
    raise exception 'Esta importação já foi desfeita.' using errcode = '22023';
  end if;
  if v_batch.created_at < now() - interval '30 days' then
    raise exception 'Importações com mais de 30 dias não podem ser desfeitas.' using errcode = '22023';
  end if;

  -- 1) Demandas sem uso: sem tarefas, contrato, item marcado e sem mudança de etapa.
  with del as (
    delete from public.demands d
     where d.organization_id = v_batch.organization_id
       and d.import_batch_id = v_batch.id
       and not exists (select 1 from public.tasks t where t.demand_id = d.id)
       and not exists (select 1 from public.contracts c where c.demand_id = d.id)
       and not exists (select 1 from public.demand_checklist_items i where i.demand_id = d.id and i.done)
       and (select count(*) from public.demand_stage_history h where h.demand_id = d.id) <= 1
    returning 1
  )
  select count(*)::int into v_removed_d from del;

  select count(*)::int into v_skipped_d
    from public.demands where organization_id = v_batch.organization_id and import_batch_id = v_batch.id;

  -- 2) Clientes sem demandas, contratos nem tarefas.
  with del as (
    delete from public.clients c
     where c.organization_id = v_batch.organization_id
       and c.import_batch_id = v_batch.id
       and not exists (select 1 from public.demands d where d.client_id = c.id)
       and not exists (select 1 from public.contracts ct where ct.client_id = c.id)
       and not exists (select 1 from public.tasks t where t.client_id = c.id)
    returning 1
  )
  select count(*)::int into v_removed_c from del;

  select count(*)::int into v_skipped_c
    from public.clients where organization_id = v_batch.organization_id and import_batch_id = v_batch.id;

  -- 3) Campos complementados: volta ao valor anterior só se ainda for o aplicado.
  for u in
    select client_id, previous, applied
      from public.import_batch_updates
     where organization_id = v_batch.organization_id and batch_id = v_batch.id
     order by created_at, id
  loop
    select to_jsonb(c) into cur from public.clients c
     where c.organization_id = v_batch.organization_id and c.id = u.client_id;
    if cur is null then continue; end if;

    v_restore := '{}'::jsonb;
    for k in select jsonb_object_keys(u.applied) loop
      if (cur ->> k) is not distinct from (u.applied ->> k) then
        v_restore := v_restore || jsonb_build_object(k, u.previous -> k);
      else
        v_skipped_f := v_skipped_f + 1;
      end if;
    end loop;

    if v_restore <> '{}'::jsonb then
      update public.clients c set
        cpf        = case when v_restore ? 'cpf'        then (jsonb_populate_record(null::public.clients, v_restore)).cpf        else c.cpf end,
        phone      = case when v_restore ? 'phone'      then (jsonb_populate_record(null::public.clients, v_restore)).phone      else c.phone end,
        email      = case when v_restore ? 'email'      then (jsonb_populate_record(null::public.clients, v_restore)).email      else c.email end,
        birth_date = case when v_restore ? 'birth_date' then (jsonb_populate_record(null::public.clients, v_restore)).birth_date else c.birth_date end,
        address    = case when v_restore ? 'address'    then (jsonb_populate_record(null::public.clients, v_restore)).address    else c.address end
       where c.organization_id = v_batch.organization_id and c.id = u.client_id;
      get diagnostics v_n = row_count;
      v_restored := v_restored + v_n;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'removed_clients',  v_removed_c,
    'removed_demands',  v_removed_d,
    'restored_clients', v_restored,
    'skipped_clients',  v_skipped_c,
    'skipped_demands',  v_skipped_d,
    'skipped_fields',   v_skipped_f
  );

  update public.import_batches
     set undone_at = now(), undone_by = auth.uid(), undo_result = v_result
   where id = v_batch.id;

  return v_result;
end;
$$;

revoke all on function public.undo_import_batch(uuid) from public, anon;
grant execute on function public.undo_import_batch(uuid) to authenticated;

-- >>>>>>>>>> registro das migrations (para a CLI do Supabase reconhecer)
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261109000010', 'pre_launch_hardening'),
  ('20261111000001', 'today_panel'),
  ('20261111000002', 'agenda'),
  ('20261111000003', 'ai_proposals'),
  ('20261111000004', 'client_overview'),
  ('20261112000001', 'stage_history'),
  ('20261112000002', 'notifications'),
  ('20261112000003', 'invite_link'),
  ('20261112000004', 'task_templates'),
  ('20261112000005', 'stage_task_rules'),
  ('20261112000006', 'saved_views_bulk'),
  ('20261112000007', 'import_batches')
on conflict do nothing;

