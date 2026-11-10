-- =============================================================================
-- JurisFlow AI — Migration 002: regras de negócio, auditoria, RPCs e views
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfil automático ao criar usuário no Supabase Auth
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Auditoria (activity_logs). Para clientes registramos apenas NOMES de campos
-- alterados, nunca os valores (CPF, telefone etc.) — LGPD, minimização.
-- -----------------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row        jsonb;
  v_old        jsonb;
  v_changes    jsonb := '{}'::jsonb;
  v_action     text;
  v_key        text;
  v_safe_keys  text[] := coalesce(tg_argv, '{}');   -- campos cujos valores podem ir para o log
  v_ignore     text[] := array['updated_at','created_at','stage_changed_at','closed_at','completed_at'];
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old); v_action := 'deleted';
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new); v_action := 'created';
  else
    v_row := to_jsonb(new); v_old := to_jsonb(old); v_action := 'updated';
    for v_key in select jsonb_object_keys(v_row) loop
      continue when v_key = any(v_ignore);
      if v_row->v_key is distinct from v_old->v_key then
        if v_key = any(v_safe_keys) then
          v_changes := v_changes || jsonb_build_object(v_key,
            jsonb_build_object('from', v_old->v_key, 'to', v_row->v_key));
        else
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('changed', true));
        end if;
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    if v_changes ? 'stage_id' then v_action := 'stage_changed';
    elsif v_changes ? 'status' then v_action := 'status_changed';
    end if;
  end if;

  if tg_op = 'INSERT' and tg_table_name = 'payments' then
    v_changes := jsonb_build_object('amount', v_row->'amount');
  end if;

  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values ((v_row->>'organization_id')::uuid, auth.uid(), tg_table_name, (v_row->>'id')::uuid, v_action, v_changes);

  return coalesce(new, old);
end $$;

create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.log_activity('status');
create trigger demands_audit after insert or update or delete on public.demands
  for each row execute function public.log_activity('stage_id','status','priority','responsible_id','category_id','title');
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.log_activity('status','priority','assignee_id','due_date','title');
create trigger contracts_audit after insert or update or delete on public.contracts
  for each row execute function public.log_activity('status','total_amount','installments_count');
create trigger payments_audit after insert or delete on public.payments
  for each row execute function public.log_activity('amount');
create trigger members_audit after insert or update or delete on public.organization_members
  for each row execute function public.log_activity('role','active');

-- -----------------------------------------------------------------------------
-- Demandas: etapa padrão, data de mudança de etapa, conclusão automática
-- -----------------------------------------------------------------------------
create or replace function public.demands_before_write()
returns trigger language plpgsql as $$
declare
  v_final boolean;
begin
  -- Mudou de categoria sem informar etapa nova → volta para a 1ª etapa da nova categoria
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id
     and new.stage_id is not distinct from old.stage_id then
    new.stage_id := null;
  end if;

  if new.stage_id is null then
    select id into new.stage_id from public.workflow_stages
     where category_id = new.category_id order by position limit 1;
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
    select is_final into v_final from public.workflow_stages where id = new.stage_id;
    if coalesce(v_final, false) then
      new.status := 'concluida';
    elsif tg_op = 'UPDATE' and old.status = 'concluida' and new.status = 'concluida' then
      new.status := 'em_andamento';  -- saiu da etapa final → reabre
    end if;
  end if;

  if new.status in ('concluida', 'cancelada') then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
  end if;
  return new;
end $$;

create trigger demands_before_write before insert or update on public.demands
  for each row execute function public.demands_before_write();

-- -----------------------------------------------------------------------------
-- Tarefas: completed_at e herança do cliente pela demanda
-- -----------------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql as $$
begin
  if new.demand_id is not null and new.client_id is null then
    select client_id into new.client_id from public.demands where id = new.demand_id;
  end if;
  if new.status = 'concluida' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- -----------------------------------------------------------------------------
-- Contratos: geração automática de parcelas
-- -----------------------------------------------------------------------------
create or replace function public.generate_installments(p_contract uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c        public.contracts%rowtype;
  v_base   numeric(12,2);
  v_last   numeric(12,2);
  i        int;
begin
  select * into c from public.contracts where id = p_contract;
  delete from public.installments where contract_id = p_contract;
  v_base := trunc(c.total_amount / c.installments_count, 2);
  v_last := c.total_amount - v_base * (c.installments_count - 1);
  for i in 1..c.installments_count loop
    insert into public.installments (organization_id, contract_id, number, due_date, amount)
    values (c.organization_id, c.id, i,
            (c.first_due_date + make_interval(months => i - 1))::date,
            case when i = c.installments_count then v_last else v_base end);
  end loop;
end $$;
revoke all on function public.generate_installments(uuid) from public, authenticated;

create or replace function public.contracts_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.generate_installments(new.id);
  elsif new.total_amount is distinct from old.total_amount
     or new.installments_count is distinct from old.installments_count
     or new.first_due_date is distinct from old.first_due_date then
    if exists (select 1 from public.payments where contract_id = new.id) then
      raise exception 'Não é possível alterar valor, parcelas ou vencimento de um contrato que já possui pagamentos.'
        using errcode = 'P0001';
    end if;
    perform public.generate_installments(new.id);
  end if;
  return new;
end $$;

create trigger contracts_after_write after insert or update on public.contracts
  for each row execute function public.contracts_after_write();

-- -----------------------------------------------------------------------------
-- Pagamentos: valida parcela × contrato e atualiza status (quitado/ativo)
-- -----------------------------------------------------------------------------
create or replace function public.payments_before_write()
returns trigger language plpgsql as $$
begin
  if new.installment_id is not null and not exists (
    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  ) then
    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contracts where id = new.contract_id and status = 'cancelado') then
    raise exception 'Não é possível registrar pagamento em contrato cancelado.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.refresh_contract_status(p_contract uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total    numeric;
  v_paid     numeric;
  v_status   public.contract_status;
begin
  select total_amount, status into v_total, v_status from public.contracts where id = p_contract;
  if v_status in ('cancelado', 'rascunho') or v_status is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where contract_id = p_contract;
  update public.contracts
     set status = case when v_paid >= v_total then 'quitado'::public.contract_status else 'ativo' end
   where id = p_contract
     and status is distinct from (case when v_paid >= v_total then 'quitado'::public.contract_status else 'ativo' end);
end $$;
revoke all on function public.refresh_contract_status(uuid) from public, authenticated;

create or replace function public.payments_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_contract_status(coalesce(new.contract_id, old.contract_id));
  return coalesce(new, old);
end $$;

create trigger payments_after_write after insert or update or delete on public.payments
  for each row execute function public.payments_after_write();

-- -----------------------------------------------------------------------------
-- Membros: nunca deixar um escritório sem administrador ativo
-- -----------------------------------------------------------------------------
create or replace function public.protect_last_admin()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (
       tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.organization_members
       where organization_id = old.organization_id and role = 'admin' and active and id <> old.id
    ) then
      raise exception 'O escritório precisa de pelo menos um administrador ativo.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger members_protect_last_admin before update or delete on public.organization_members
  for each row execute function public.protect_last_admin();

-- -----------------------------------------------------------------------------
-- Categorias/etapas padrão (controles administrativos — personalizáveis)
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_workflows(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cat   uuid;
  v_def   jsonb := $json$[
    {"name":"Salário-maternidade","color":"#db2777","stages":["Primeiro atendimento","Cadastro da cliente","Solicitação de documentos","Aguardando documentação*","Conferência documental externa","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Aposentadoria","color":"#2563eb","stages":["Primeiro atendimento","Levantamento de informações","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Benefícios por incapacidade","color":"#d97706","stages":["Primeiro atendimento","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Perícia agendada","Acompanhamento","Concluído!"]},
    {"name":"Benefícios relacionados à pesca","color":"#0891b2","stages":["Primeiro atendimento","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Demandas trabalhistas","color":"#7c3aed","stages":["Primeiro atendimento","Coleta de informações","Aguardando documentação*","Elaboração","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Contratos","color":"#059669","stages":["Solicitação","Elaboração","Revisão","Assinatura","Concluído!"]},
    {"name":"Outros","color":"#64748b","stages":["A fazer","Em andamento","Aguardando documentação*","Concluído!"]}
  ]$json$::jsonb;
  v_item  jsonb;
  v_stage text;
  v_pos   int;
  v_ord   int := 0;
begin
  for v_item in select * from jsonb_array_elements(v_def) loop
    insert into public.demand_categories (organization_id, name, color, sort_order)
    values (p_org, v_item->>'name', v_item->>'color', v_ord)
    on conflict (organization_id, name) do nothing
    returning id into v_cat;
    v_ord := v_ord + 1;
    continue when v_cat is null;
    v_pos := 0;
    for v_stage in select * from jsonb_array_elements_text(v_item->'stages') loop
      insert into public.workflow_stages (organization_id, category_id, name, position, is_final, is_waiting_docs)
      values (p_org, v_cat, rtrim(v_stage, '*!'), v_pos, v_stage like '%!', v_stage like '%*');
      v_pos := v_pos + 1;
    end loop;
  end loop;
end $$;
revoke all on function public.seed_default_workflows(uuid) from public, authenticated;

-- -----------------------------------------------------------------------------
-- RPCs de onboarding
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if (select count(*) from public.organization_members where user_id = auth.uid() and role = 'admin') >= 3 then
    raise exception 'Limite de escritórios por usuário atingido.' using errcode = 'P0001';
  end if;
  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, auth.uid(), 'admin');
  perform public.seed_default_workflows(v_org);
  return v_org;
end $$;
revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- Aceita convites pendentes cujo e-mail coincide com o e-mail verificado do usuário.
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
     where email = v_email and accepted_at is null
     for update
  loop
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), inv.role)
    on conflict (organization_id, user_id) do update set active = true;
    update public.organization_invitations set accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.accept_pending_invitations() from public;
grant execute on function public.accept_pending_invitations() to authenticated;

-- -----------------------------------------------------------------------------
-- LGPD: anonimização de cliente (mantém histórico operacional/financeiro,
-- remove dados pessoais). Apenas administradores.
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
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
-- Reordenação atômica de etapas (Kanban/configuração de fluxos)
-- -----------------------------------------------------------------------------
create or replace function public.reorder_workflow_stages(p_category uuid, p_stage_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.workflow_stages where category_id = p_category)
     <> coalesce(array_length(p_stage_ids, 1), 0) then
    raise exception 'A lista de etapas está incompleta ou desatualizada.' using errcode = 'P0001';
  end if;
  for i in 1..array_length(p_stage_ids, 1) loop
    update public.workflow_stages set position = i - 1
     where id = p_stage_ids[i] and category_id = p_category;
    if not found then
      raise exception 'Etapa inválida ou sem permissão.' using errcode = '42501';
    end if;
  end loop;
end $$;
grant execute on function public.reorder_workflow_stages(uuid, uuid[]) to authenticated;

-- Exclui etapa movendo as demandas para outra etapa da mesma categoria.
create or replace function public.delete_workflow_stage(p_stage uuid, p_move_to uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_cat uuid;
begin
  select category_id into v_cat from public.workflow_stages where id = p_stage;
  if v_cat is null then raise exception 'Etapa não encontrada' using errcode = 'P0002'; end if;
  if p_move_to is not null then
    if not exists (select 1 from public.workflow_stages where id = p_move_to and category_id = v_cat and id <> p_stage) then
      raise exception 'Etapa de destino inválida' using errcode = 'P0001';
    end if;
    update public.demands set stage_id = p_move_to where stage_id = p_stage;
  elsif exists (select 1 from public.demands where stage_id = p_stage) then
    raise exception 'Há demandas nesta etapa. Escolha uma etapa de destino.' using errcode = 'P0001';
  end if;
  delete from public.workflow_stages where id = p_stage;
  if not found then raise exception 'Sem permissão para excluir a etapa' using errcode = '42501'; end if;
end $$;
grant execute on function public.delete_workflow_stage(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Views financeiras (security_invoker → respeitam a RLS de quem consulta)
-- -----------------------------------------------------------------------------
create view public.installment_overview with (security_invoker = true) as
select
  i.id, i.organization_id, i.contract_id, i.number, i.due_date, i.amount,
  coalesce(p.paid, 0)::numeric(12,2)                         as paid_amount,
  greatest(i.amount - coalesce(p.paid, 0), 0)::numeric(12,2) as remaining_amount,
  case
    when coalesce(p.paid, 0) >= i.amount then 'paga'
    when c.status = 'cancelado'           then 'cancelada'
    when i.due_date < current_date        then 'vencida'
    when coalesce(p.paid, 0) > 0          then 'parcial'
    else 'a_vencer'
  end as status,
  c.client_id
from public.installments i
join public.contracts c on c.id = i.contract_id
left join lateral (
  select sum(amount) as paid from public.payments where installment_id = i.id
) p on true;

create view public.contract_overview with (security_invoker = true) as
select
  c.*,
  coalesce(p.received, 0)::numeric(12,2)                                as received_amount,
  greatest(c.total_amount - coalesce(p.received, 0), 0)::numeric(12,2)  as balance_amount,
  coalesce(io.overdue_count, 0)                                         as overdue_count,
  io.next_due_date
from public.contracts c
left join lateral (select sum(amount) as received from public.payments where contract_id = c.id) p on true
left join lateral (
  select count(*) filter (where status = 'vencida')                       as overdue_count,
         min(due_date) filter (where status in ('a_vencer', 'parcial', 'vencida')) as next_due_date
    from public.installment_overview where contract_id = c.id
) io on true;

-- -----------------------------------------------------------------------------
-- Dashboard: todos os indicadores calculados no banco com dados reais.
-- SECURITY INVOKER → RLS continua valendo.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
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
                 'expected', (select coalesce(sum(amount),0) from installment_overview where organization_id = p_org and status <> 'cancelada' and date_trunc('month', due_date) = m)
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
