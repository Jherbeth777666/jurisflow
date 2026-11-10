-- =============================================================================
-- JurisFlow AI — Migration 005: correções de segurança encontradas nos testes
-- (supabase/tests/rls_test.sql). Não altera as migrations anteriores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles: o usuário só pode alterar o próprio NOME.
--    Antes, `grant update on profiles` permitia trocar profiles.email, que é o
--    e-mail exibido na lista de equipe/produtividade → um membro podia se passar
--    por outro (ex.: exibir o e-mail do sócio). O e-mail passa a ser sincronizado
--    apenas a partir de auth.users (fonte verificada pelo Supabase Auth).
-- -----------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;
revoke all on function public.handle_user_email_change() from public;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- 2. organizations: admin altera apenas nome e configurações.
--    Antes era possível alterar is_demo, created_at etc. pela API.
-- -----------------------------------------------------------------------------
revoke update on public.organizations from authenticated;
grant update (name, settings) on public.organizations to authenticated;

-- -----------------------------------------------------------------------------
-- 3. organization_invitations: invited_by = usuário autenticado (não forjável)
--    e imutável depois de criado.
-- -----------------------------------------------------------------------------
create or replace function public.set_invited_by()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.invited_by := old.invited_by;
  elsif auth.uid() is not null then
    new.invited_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists organization_invitations_invited_by on public.organization_invitations;
create trigger organization_invitations_invited_by
  before insert or update on public.organization_invitations
  for each row execute function public.set_invited_by();

-- -----------------------------------------------------------------------------
-- 4. accept_pending_invitations: ao reativar um membro DESATIVADO, aplica o papel
--    do novo convite. Antes, um ex-administrador desativado e reconvidado como
--    "assistente" voltava como administrador (escalonamento de privilégio).
--    Para membros já ativos o papel atual é mantido.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 5. protect_last_admin: serializa alterações de administradores por escritório.
--    Sem o lock, dois admins rebaixando um ao outro em transações concorrentes
--    (READ COMMITTED) podiam deixar o escritório sem nenhum administrador.
-- -----------------------------------------------------------------------------
create or replace function public.protect_last_admin()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (
       tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform pg_advisory_xact_lock(hashtextextended('jurisflow.admins:' || old.organization_id::text, 0));
    if not exists (
      select 1 from public.organization_members
       where organization_id = old.organization_id and role = 'admin' and active and id <> old.id
    ) then
      raise exception 'O escritório precisa de pelo menos um administrador ativo.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
