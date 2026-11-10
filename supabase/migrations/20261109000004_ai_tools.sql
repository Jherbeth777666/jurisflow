-- =============================================================================
-- JurisFlow AI — Migration 004: "ferramentas" do Assistente de IA
-- =============================================================================
-- O modelo de linguagem NUNCA executa SQL. A Edge Function `ai-assistant`
-- expõe ao modelo apenas uma whitelist de ferramentas, cada uma mapeada para
-- uma destas funções. Regras comuns:
--   * SECURITY INVOKER  → a RLS do usuário que fez a pergunta continua valendo
--                          (a Edge Function chama com o JWT do próprio usuário).
--   * STABLE, somente leitura.
--   * Verificam is_org_member(p_org) e lançam 42501 caso contrário.
--   * Parâmetros validados/limitados; listas com no máximo 50 itens
--     (o total real é informado em `total` para o modelo saber se truncou).
--   * Retornam jsonb SEM CPF, telefone, e-mail, endereço, nascimento ou
--     observações. Nomes de clientes/membros saem daqui, mas a Edge Function os
--     pseudonimiza antes de enviar ao provedor de IA.
--   * "Hoje" = data em America/Sao_Paulo (o servidor Supabase roda em UTC).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------
create or replace function public.ai_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Normaliza texto para busca: minúsculas, sem acentos, hífens/underscores → espaço.
create or replace function public.ai_norm(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
           translate(lower(coalesce(p, '')),
             'áàâãäéèêëíìîïóòôõöúùûüçñ-_',
             'aaaaaeeeeiiiiooooouuuucn  '),
           '\s+', ' ', 'g'));
$$;

create or replace function public.ai_assert_member(p_org uuid)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_org is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
end $$;

-- Nome exibível de um membro (nunca usa e-mail).
create or replace function public.ai_member_name(p_user uuid)
returns text language sql stable set search_path = public as $$
  select case when p_user is null then null
              else coalesce((select nullif(btrim(full_name), '') from public.profiles where id = p_user), 'Membro sem nome')
         end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Demandas paradas: abertas e sem mudança de etapa há ≥ N dias
-- -----------------------------------------------------------------------------
create or replace function public.ai_stalled_demands(p_org uuid, p_days int default 15)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 15), 1), 365);
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.id, d.title, d.priority, d.status, d.responsible_id, d.next_action_date,
           c.full_name as client, cat.name as category, s.name as stage,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_stalled
      from demands d
      join clients c            on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
      left join workflow_stages s on s.id = d.stage_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) >= v_days
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'client', b.client, 'category', b.category,
                    'stage', b.stage, 'status', b.status, 'priority', b.priority,
                    'days_stalled', b.days_stalled,
                    'responsible', public.ai_member_name(b.responsible_id)) order by b.days_stalled desc)
                   from (select * from base order by days_stalled desc limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('min_days', v_days, 'today', v_today, 'total', v_total,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Demandas aguardando documentação (etapa is_waiting_docs)
-- -----------------------------------------------------------------------------
create or replace function public.ai_waiting_documents(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today   date := public.ai_today();
  v_total   int;
  v_clients int;
  v_items   jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.id, d.title, d.client_id, d.responsible_id,
           c.full_name as client, cat.name as category, s.name as stage,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_in_stage
      from demands d
      join workflow_stages s     on s.id = d.stage_id and s.is_waiting_docs
      join clients c             on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
  )
  select (select count(*) from base),
         (select count(distinct client_id) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'client', b.client, 'category', b.category,
                    'stage', b.stage, 'days_in_stage', b.days_in_stage,
                    'responsible', public.ai_member_name(b.responsible_id)) order by b.days_in_stage desc)
                   from (select * from base order by days_in_stage desc limit 50) b), '[]'::jsonb)
    into v_total, v_clients, v_items;

  return jsonb_build_object('today', v_today, 'total_demands', v_total, 'distinct_clients', v_clients,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 3/4. Tarefas atrasadas e próximas
-- -----------------------------------------------------------------------------
create or replace function public.ai_overdue_tasks(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select t.id, t.title, t.due_date, t.priority, t.status, t.assignee_id,
           c.full_name as client, d.title as demand, (v_today - t.due_date) as days_overdue
      from tasks t
      left join clients c on c.id = t.client_id
      left join demands d on d.id = t.demand_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date < v_today
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'due_date', b.due_date, 'days_overdue', b.days_overdue,
                    'priority', b.priority, 'status', b.status, 'client', b.client, 'demand', b.demand,
                    'assignee', public.ai_member_name(b.assignee_id)) order by b.due_date)
                   from (select * from base order by due_date limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('today', v_today, 'total', v_total, 'truncated', v_total > 50, 'items', v_items);
end $$;

create or replace function public.ai_upcoming_tasks(p_org uuid, p_days int default 7)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 60);
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select t.id, t.title, t.due_date, t.priority, t.status, t.assignee_id,
           c.full_name as client, d.title as demand, (t.due_date - v_today) as days_left
      from tasks t
      left join clients c on c.id = t.client_id
      left join demands d on d.id = t.demand_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date between v_today and v_today + v_days
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'due_date', b.due_date, 'days_left', b.days_left,
                    'priority', b.priority, 'status', b.status, 'client', b.client, 'demand', b.demand,
                    'assignee', public.ai_member_name(b.assignee_id)) order by b.due_date)
                   from (select * from base order by due_date limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('today', v_today, 'days', v_days, 'total', v_total,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Resumo semanal (segunda a domingo). Valores financeiros só para
--    administrador/advogado; para assistente vêm nulos com financial_restricted.
-- -----------------------------------------------------------------------------
create or replace function public.ai_weekly_summary(p_org uuid, p_start date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today  date := public.ai_today();
  v_start  date;
  v_end    date;
  v_fin    boolean;
  v_result jsonb;
begin
  perform public.ai_assert_member(p_org);
  v_fin := public.has_org_role(p_org, array['admin', 'advogado']::public.member_role[]);

  v_start := coalesce(p_start, v_today);
  v_start := least(greatest(v_start, v_today - 366), v_today);  -- até 1 ano para trás, nunca futuro
  v_start := date_trunc('week', v_start)::date;                 -- segunda-feira
  v_end   := v_start + 6;

  select jsonb_build_object(
    'week_start', v_start,
    'week_end', v_end,
    'today', v_today,
    'demands_opened', (select count(*) from demands
                        where organization_id = p_org and opened_at between v_start and v_end),
    'demands_completed', (select count(*) from demands
                        where organization_id = p_org and status = 'concluida'
                          and (closed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'demands_open_now', (select count(*) from demands
                        where organization_id = p_org and status not in ('concluida', 'cancelada')),
    'stage_changes', (select count(*) from activity_logs
                        where organization_id = p_org and entity_type = 'demands' and action = 'stage_changed'
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_created', (select count(*) from tasks
                        where organization_id = p_org
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_completed', (select count(*) from tasks
                        where organization_id = p_org and status = 'concluida'
                          and (completed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_overdue_in_week', (select count(*) from tasks
                        where organization_id = p_org and status in ('pendente', 'em_andamento')
                          and due_date between v_start and least(v_end, v_today - 1)),
    'tasks_overdue_now', (select count(*) from tasks
                        where organization_id = p_org and status in ('pendente', 'em_andamento') and due_date < v_today),
    'new_clients', (select count(*) from clients
                        where organization_id = p_org
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'financial_restricted', not v_fin,
    'payments_count', case when v_fin then (select count(*) from payments
                        where organization_id = p_org and paid_at between v_start and v_end) end,
    'payments_received', case when v_fin then (select coalesce(sum(amount), 0) from payments
                        where organization_id = p_org and paid_at between v_start and v_end) end,
    'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', x.name, 'opened', x.opened, 'completed', x.completed)
                         order by x.opened desc, x.name)
          from (select cat.name,
                       count(*) filter (where d.opened_at between v_start and v_end) as opened,
                       count(*) filter (where d.status = 'concluida'
                         and (d.closed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end) as completed
                  from demand_categories cat
                  join demands d on d.category_id = cat.id
                 where cat.organization_id = p_org
                 group by cat.name) x
         where x.opened > 0 or x.completed > 0), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Contagem de demandas com filtros (categoria por nome, período, status)
-- -----------------------------------------------------------------------------
create or replace function public.ai_count_demands(
  p_org uuid,
  p_category_name text default null,
  p_from date default null,
  p_to date default null,
  p_status text default null
)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_term    text;
  v_pattern text;
  v_status  public.demand_status;
  v_cats    uuid[];
  v_total   int;
  v_by_cat  jsonb;
  v_by_st   jsonb;
  v_matched jsonb;
begin
  perform public.ai_assert_member(p_org);

  if p_status is not null and btrim(p_status) <> '' then
    if btrim(p_status) not in ('em_andamento', 'aguardando_cliente', 'suspensa', 'concluida', 'cancelada') then
      raise exception 'Status inválido: use em_andamento, aguardando_cliente, suspensa, concluida ou cancelada'
        using errcode = '22023';
    end if;
    v_status := btrim(p_status)::public.demand_status;
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Período inválido: data inicial maior que a final' using errcode = '22023';
  end if;

  v_term := left(public.ai_norm(p_category_name), 80);
  if v_term <> '' then
    -- curingas do LIKE escapados: o termo é tratado como texto literal
    v_pattern := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select coalesce(array_agg(id), '{}'),
           coalesce(jsonb_agg(name order by name), '[]'::jsonb)
      into v_cats, v_matched
      from demand_categories
     where organization_id = p_org and public.ai_norm(name) like v_pattern escape '\';
  end if;

  with base as (
    select d.status, cat.name as category
      from demands d
      join demand_categories cat on cat.id = d.category_id
     where d.organization_id = p_org
       and (v_term = '' or d.category_id = any(v_cats))
       and (p_from is null or d.opened_at >= p_from)
       and (p_to is null or d.opened_at <= p_to)
       and (v_status is null or d.status = v_status)
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc, category)
                     from (select category, count(*) n from base group by category) x), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc)
                     from (select status, count(*) n from base group by status) y), '[]'::jsonb)
    into v_total, v_by_cat, v_by_st;

  return jsonb_build_object(
    'filters', jsonb_build_object('category_name', nullif(v_term, ''), 'from', p_from, 'to', p_to,
                                  'status', v_status, 'date_field', 'opened_at'),
    'matched_categories', case when v_term = '' then null else v_matched end,
    'total', v_total,
    'by_category', v_by_cat,
    'by_status', v_by_st);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Clientes aguardando (cliente/documentação/1º atendimento)
-- -----------------------------------------------------------------------------
create or replace function public.ai_clients_awaiting(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today   date := public.ai_today();
  v_total   int;
  v_by_rsn  jsonb;
  v_items   jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.client_id, c.full_name as client, d.title, cat.name as category, s.name as stage,
           case when d.status = 'aguardando_cliente' then 'aguardando_cliente'
                when s.is_waiting_docs              then 'aguardando_documentacao'
                else 'primeiro_atendimento' end as reason,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_in_stage
      from demands d
      join clients c             on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
      left join workflow_stages s on s.id = d.stage_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and (d.status = 'aguardando_cliente'
            or s.is_waiting_docs
            or public.ai_norm(s.name) like '%primeiro atendimento%'
            or public.ai_norm(s.name) like '%1º atendimento%')
  ),
  per_client as (
    select client_id, client, max(days_in_stage) as max_days,
           jsonb_agg(jsonb_build_object('demand', title, 'category', category, 'stage', stage,
                                        'reason', reason, 'days_in_stage', days_in_stage)
                     order by days_in_stage desc) as demands
      from base group by client_id, client
  )
  select (select count(*) from per_client),
         coalesce((select jsonb_object_agg(reason, n)
                     from (select reason, count(distinct client_id) n from base group by reason) r), '{}'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('client', p.client, 'max_days_waiting', p.max_days,
                                                       'demands', p.demands) order by p.max_days desc)
                     from (select * from per_client order by max_days desc limit 50) p), '[]'::jsonb)
    into v_total, v_by_rsn, v_items;

  return jsonb_build_object('today', v_today, 'total_clients', v_total,
                            'clients_by_reason', v_by_rsn, 'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Visão financeira — somente administrador/advogado
-- -----------------------------------------------------------------------------
create or replace function public.ai_financial_overview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today    date := public.ai_today();
  v_expected numeric;
  v_received numeric;
  v_result   jsonb;
begin
  perform public.ai_assert_member(p_org);
  if not public.has_org_role(p_org, array['admin', 'advogado']::public.member_role[]) then
    raise exception 'Apenas administradores e advogados podem consultar dados financeiros.'
      using errcode = '42501';
  end if;

  select coalesce(sum(total_amount), 0) into v_expected
    from contracts where organization_id = p_org and status in ('ativo', 'quitado');
  select coalesce(sum(p.amount), 0) into v_received
    from payments p join contracts c on c.id = p.contract_id
   where p.organization_id = p_org and c.status in ('ativo', 'quitado');

  select jsonb_build_object(
    'today', v_today,
    'contracts_active', (select count(*) from contracts where organization_id = p_org and status = 'ativo'),
    'contracts_paid_off', (select count(*) from contracts where organization_id = p_org and status = 'quitado'),
    'fees_expected', v_expected,
    'fees_received', v_received,
    'balance', greatest(v_expected - v_received, 0),
    'overdue_installments_count', (select count(*) from installment_overview
                                    where organization_id = p_org and status = 'vencida'),
    'overdue_amount', (select coalesce(sum(remaining_amount), 0) from installment_overview
                        where organization_id = p_org and status = 'vencida'),
    'next_30_days_count', (select count(*) from installment_overview
                            where organization_id = p_org and status in ('a_vencer', 'parcial')
                              and due_date between v_today and v_today + 30),
    'next_30_days_amount', (select coalesce(sum(remaining_amount), 0) from installment_overview
                             where organization_id = p_org and status in ('a_vencer', 'parcial')
                               and due_date between v_today and v_today + 30),
    'received_this_month', (select coalesce(sum(amount), 0) from payments
                             where organization_id = p_org
                               and paid_at between date_trunc('month', v_today)::date and v_today)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Visão geral do escritório (resumo do dashboard, sem valores financeiros)
-- -----------------------------------------------------------------------------
create or replace function public.ai_office_overview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today  date := public.ai_today();
  v_result jsonb;
begin
  perform public.ai_assert_member(p_org);

  select jsonb_build_object(
    'today', v_today,
    'clients_active', (select count(*) from clients where organization_id = p_org and anonymized_at is null
                         and status in ('ativo', 'prospecto')),
    'demands_in_progress', (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida', 'cancelada')),
    'demands_waiting_client', (select count(*) from demands where organization_id = p_org
                                and status = 'aguardando_cliente'),
    'demands_waiting_docs', (select count(*) from demands d join workflow_stages s on s.id = d.stage_id
                              where d.organization_id = p_org and s.is_waiting_docs
                                and d.status not in ('concluida', 'cancelada')),
    'demands_stalled_15d', (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida', 'cancelada')
                             and (stage_changed_at at time zone 'America/Sao_Paulo')::date <= v_today - 15),
    'demands_completed_30d', (select count(*) from demands where organization_id = p_org and status = 'concluida'
                               and closed_at >= now() - interval '30 days'),
    'tasks_pending', (select count(*) from tasks where organization_id = p_org
                       and status in ('pendente', 'em_andamento')),
    'tasks_overdue', (select count(*) from tasks where organization_id = p_org
                       and status in ('pendente', 'em_andamento') and due_date < v_today),
    'tasks_due_next_7d', (select count(*) from tasks where organization_id = p_org
                           and status in ('pendente', 'em_andamento') and due_date between v_today and v_today + 7),
    'open_by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', x.name, 'count', x.n) order by x.n desc, x.name)
          from (select cat.name, count(*) n
                  from demands d join demand_categories cat on cat.id = d.category_id
                 where d.organization_id = p_org and d.status not in ('concluida', 'cancelada')
                 group by cat.name) x), '[]'::jsonb),
    'by_status', coalesce((
        select jsonb_object_agg(status, n)
          from (select status, count(*) n from demands where organization_id = p_org group by status) s), '{}'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- Permissões: somente usuários autenticados (a RLS e is_org_member fazem o resto)
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.ai_today()',
    'public.ai_norm(text)',
    'public.ai_assert_member(uuid)',
    'public.ai_member_name(uuid)',
    'public.ai_stalled_demands(uuid, int)',
    'public.ai_waiting_documents(uuid)',
    'public.ai_overdue_tasks(uuid)',
    'public.ai_upcoming_tasks(uuid, int)',
    'public.ai_weekly_summary(uuid, date)',
    'public.ai_count_demands(uuid, text, date, date, text)',
    'public.ai_clients_awaiting(uuid)',
    'public.ai_financial_overview(uuid)',
    'public.ai_office_overview(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
