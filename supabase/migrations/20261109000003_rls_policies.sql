-- =============================================================================
-- JurisFlow AI — Migration 003: Row Level Security
-- =============================================================================
-- Matriz de permissões
--   Recurso                  | admin | advogado | assistente
--   -------------------------+-------+----------+-----------
--   Clientes (ler/criar/edit)|  ✔    |    ✔     |    ✔
--   Clientes (excluir)       |  ✔    |          |
--   Demandas/tarefas (CRUD)  |  ✔    |    ✔     |  sem excluir
--   Fluxos/categorias (edit) |  ✔    |    ✔     |  só leitura
--   Contratos (criar/editar) |  ✔    |    ✔     |  só leitura
--   Pagamentos (registrar)   |  ✔    |    ✔     |    ✔
--   Pagamentos (estornar)    |  ✔    |    ✔     |
--   Membros/convites/config. |  ✔    |          |
--   Conversas de IA          |  somente o próprio usuário
-- =============================================================================

alter table public.organizations            enable row level security;
alter table public.profiles                 enable row level security;
alter table public.organization_members     enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.clients                  enable row level security;
alter table public.demand_categories        enable row level security;
alter table public.workflow_stages          enable row level security;
alter table public.demands                  enable row level security;
alter table public.tasks                    enable row level security;
alter table public.contracts                enable row level security;
alter table public.installments             enable row level security;
alter table public.payments                 enable row level security;
alter table public.activity_logs            enable row level security;
alter table public.ai_conversations         enable row level security;
alter table public.ai_messages              enable row level security;

-- Nenhum acesso anônimo a dados.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['admin']::public.member_role[]))
  with check (public.has_org_role(id, array['admin']::public.member_role[]));
-- INSERT apenas via create_organization(); DELETE não exposto.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organization_members / invitations
-- ---------------------------------------------------------------------------
create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy members_update on public.organization_members for update to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.member_role[]));
create policy members_delete on public.organization_members for delete to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.member_role[]));
-- INSERT apenas via create_organization() / accept_pending_invitations().

create policy invitations_admin_all on public.organization_invitations for all to authenticated
  using (public.has_org_role(organization_id, array['admin']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['admin']::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Macro para tabelas operacionais
-- ---------------------------------------------------------------------------
create or replace function pg_temp.org_policies(
  p_table text, p_write_roles text, p_delete_roles text, p_insert_roles text default null
) returns void language plpgsql as $$
declare
  v_ins text := coalesce(p_insert_roles, p_write_roles);
  fn    text;
begin
  execute format('create policy %1$s_select on public.%1$s for select to authenticated
                  using (public.is_org_member(organization_id))', p_table);

  fn := case when v_ins = 'all' then 'public.is_org_member(organization_id)'
             else format('public.has_org_role(organization_id, %L::public.member_role[])', v_ins) end;
  execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (%2$s)', p_table, fn);

  fn := case when p_write_roles = 'all' then 'public.is_org_member(organization_id)'
             else format('public.has_org_role(organization_id, %L::public.member_role[])', p_write_roles) end;
  execute format('create policy %1$s_update on public.%1$s for update to authenticated using (%2$s) with check (%2$s)', p_table, fn);

  fn := format('public.has_org_role(organization_id, %L::public.member_role[])', p_delete_roles);
  execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (%2$s)', p_table, fn);
end $$;

do $$ begin perform pg_temp.org_policies('clients',           'all',                 '{admin}'); end $$;
do $$ begin perform pg_temp.org_policies('demands',           'all',                 '{admin,advogado}'); end $$;
do $$ begin perform pg_temp.org_policies('tasks',             'all',                 '{admin,advogado}'); end $$;
do $$ begin perform pg_temp.org_policies('demand_categories', '{admin,advogado}',    '{admin}'); end $$;
do $$ begin perform pg_temp.org_policies('workflow_stages',   '{admin,advogado}',    '{admin,advogado}'); end $$;
do $$ begin perform pg_temp.org_policies('contracts',         '{admin,advogado}',    '{admin}'); end $$;
do $$ begin perform pg_temp.org_policies('installments',      '{admin,advogado}',    '{admin,advogado}'); end $$;
do $$ begin perform pg_temp.org_policies('payments',          '{admin,advogado}',    '{admin,advogado}', 'all'); end $$;

-- ---------------------------------------------------------------------------
-- activity_logs: somente leitura (escrita pelos triggers SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- IA: cada usuário vê apenas as próprias conversas, e só enquanto for membro
-- ---------------------------------------------------------------------------
create policy ai_conv_select on public.ai_conversations for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy ai_conv_insert on public.ai_conversations for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy ai_conv_update on public.ai_conversations for update to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy ai_conv_delete on public.ai_conversations for delete to authenticated
  using (user_id = auth.uid());

create policy ai_msg_select on public.ai_messages for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
-- Mensagens são gravadas pela Edge Function com o JWT do usuário:
create policy ai_msg_insert on public.ai_messages for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_org_member(organization_id)
    and exists (select 1 from public.ai_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Grants para o papel authenticated (a RLS faz o filtro real)
-- ---------------------------------------------------------------------------
grant select, update on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, delete on public.organization_members to authenticated;
grant update (role, active) on public.organization_members to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant select, insert, update, delete on
  public.clients, public.demands, public.tasks, public.demand_categories, public.workflow_stages,
  public.contracts, public.installments, public.payments, public.ai_conversations
  to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.installment_overview, public.contract_overview to authenticated;

-- created_by sempre = usuário autenticado e imutável depois
create or replace function public.set_created_by()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients','demands','tasks','contracts','payments'] loop
    execute format('create trigger %I_created_by before insert or update on public.%I
                    for each row execute function public.set_created_by()', t, t);
  end loop;
end $$;
