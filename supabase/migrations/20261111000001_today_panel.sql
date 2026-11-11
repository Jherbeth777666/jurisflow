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
