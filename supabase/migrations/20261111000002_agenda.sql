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
