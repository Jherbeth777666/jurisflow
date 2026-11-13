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
