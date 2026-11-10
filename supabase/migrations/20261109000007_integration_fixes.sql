-- =============================================================================
-- JurisFlow AI — Migration 007: ajustes de integração
--  * Parcelas de contratos em RASCUNHO não contam como vencidas nem como receita
--    prevista (status próprio 'rascunho' em installment_overview).
--  * "Hoje" calculado no fuso America/Sao_Paulo (o servidor do Supabase roda em UTC).
-- =============================================================================

create or replace view public.installment_overview with (security_invoker = true) as
select
  i.id, i.organization_id, i.contract_id, i.number, i.due_date, i.amount,
  coalesce(p.paid, 0)::numeric(12,2)                         as paid_amount,
  greatest(i.amount - coalesce(p.paid, 0), 0)::numeric(12,2) as remaining_amount,
  case
    when coalesce(p.paid, 0) >= i.amount then 'paga'
    when c.status = 'cancelado'           then 'cancelada'
    when c.status = 'rascunho'            then 'rascunho'
    when i.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencida'
    when coalesce(p.paid, 0) > 0          then 'parcial'
    else 'a_vencer'
  end as status,
  c.client_id
from public.installments i
join public.contracts c on c.id = i.contract_id
left join lateral (
  select sum(amount) as paid from public.payments where installment_id = i.id
) p on true;

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

-- -----------------------------------------------------------------------------
-- LGPD: anonimização também remove o nome do cliente dos textos livres de
-- demandas e tarefas vinculadas (títulos, descrições, observações).
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_name  text;
  v_first text;
  v_cpf   text;
  v_re    text;
begin
  select organization_id, full_name, cpf into v_org, v_name, v_cpf from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  -- Nome completo (e CPF, se houver) → marcador neutro, sem diferenciar maiúsculas.
  v_re := regexp_replace(btrim(v_name), '([.^$*+?()[\]{}|\\-])', '\\\1', 'g');
  update public.demands
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi'),
         notes       = regexp_replace(notes, v_re, 'Cliente anonimizado', 'gi'),
         next_action = regexp_replace(next_action, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  update public.tasks
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  if v_cpf is not null then
    update public.demands set description = replace(description, v_cpf, '[CPF removido]'),
                              notes = replace(notes, v_cpf, '[CPF removido]')
     where client_id = p_client;
    update public.tasks set description = replace(description, v_cpf, '[CPF removido]') where client_id = p_client;
  end if;
  -- Primeiro nome isolado também sai dos títulos (ex.: "SM Maria")
  v_first := split_part(btrim(v_name), ' ', 1);
  if char_length(v_first) >= 3 then
    v_re := '\m' || regexp_replace(v_first, '([.^$*+?()[\]{}|\\-])', '\\\1', 'g') || '\M';
    update public.demands set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
    update public.tasks   set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
  end if;

  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;
end $$;
revoke all on function public.anonymize_client(uuid) from public;
grant execute on function public.anonymize_client(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria de exportações (CSV/JSON). activity_logs continua sem INSERT direto;
-- esta função registra apenas metadados (o quê, quantos, se incluiu dados pessoais).
-- -----------------------------------------------------------------------------
create or replace function public.log_export(
  p_org uuid, p_resource text, p_row_count int, p_sensitive boolean default false, p_entity uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_resource !~ '^[a-z_]{2,40}$' then
    raise exception 'Recurso inválido' using errcode = 'P0001';
  end if;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values (p_org, auth.uid(), 'exports', coalesce(p_entity, p_org), 'exported',
          jsonb_build_object('resource', p_resource,
                             'rows', greatest(coalesce(p_row_count, 0), 0),
                             'sensitive', coalesce(p_sensitive, false)));
end $$;
revoke all on function public.log_export(uuid, text, int, boolean, uuid) from public;
grant execute on function public.log_export(uuid, text, int, boolean, uuid) to authenticated;
