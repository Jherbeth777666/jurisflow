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
