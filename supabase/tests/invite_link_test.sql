-- =============================================================================
-- JurisFlow AI — Testes de aceite do lote L8: convite com link copiável
-- =============================================================================
-- Cobre a migration 20261112000003_invite_link.sql descrita no plano L8:
--   * organization_invitations ganha token (uuid, default, único) e expires_at
--     (default now() + 14 dias);
--   * invitation_preview(token) devolve { organization_name, email, role, status }
--     e só { status: 'invalido' } para token inexistente;
--   * anon consegue chamar invitation_preview, mas não lê a tabela;
--   * accept_pending_invitations() ignora convite expirado;
--   * renew_invitation() só admin (senão 42501) e troca token/validade;
--   * o link antigo vira 'invalido' depois de renovar.
-- Roda em transação desfeita no final (não deixa lixo).
-- Qualquer falha → raise exception 'FALHOU: ...' → psql para (ON_ERROR_STOP).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
set local timezone = 'America/Sao_Paulo';

create schema tstl8;
create sequence tstl8.passed;

create function tstl8.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tstl8.' || p, true), '')::uuid $$;

create function tstl8.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tstl8.' || p, v::text, false) $$;

create function tstl8.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tstl8.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tstl8.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $$;

create function tstl8.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tstl8.passed');
end $$;

create function tstl8.eq(got anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FALHOU: % — obtido %, esperado %', label, got, expected;
  end if;
  perform nextval('tstl8.passed');
end $$;

create function tstl8.expect_error_state(q text, state text, label text) returns void language plpgsql as $$
declare st text; msg text;
begin
  begin
    execute q;
  exception when others then
    st := sqlstate; msg := sqlerrm;
  end;
  if st is null then
    raise exception 'FALHOU: % — a operação deveria ser recusada, mas foi aceita', label;
  elsif st <> state then
    raise exception 'FALHOU: % — esperava SQLSTATE % e veio % (%)', label, state, st, msg;
  end if;
  perform nextval('tstl8.passed');
end $$;

-- Quantidade de linhas visíveis (permissão negada conta como 0).
create function tstl8.visible(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

grant usage on schema tstl8 to authenticated, anon;
grant execute on all functions in schema tstl8 to authenticated, anon;
grant usage, select on sequence tstl8.passed to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Fixtures: um escritório, admin, advogado e convites em todos os estados.
--
-- Datas (14 dias = 336 horas):
--   válido        → expira em now() + 14 dias
--   aceito        → aceito agora; também expira em now() + 14 dias
--   expirado      → expirou há 1 dia       (usuário l8.expired@teste.local;
--                   usado no aceite recusado e depois renovado pelo admin)
--   aceite válido → expira em now() + 14 dias (usuário l8.accept@teste.local)
-- -----------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_id uuid;
begin
  perform tstl8.set_id('u_admin',   '00000000-0000-4000-9000-0000000000a1');
  perform tstl8.set_id('u_adv',     '00000000-0000-4000-9000-0000000000a2');
  perform tstl8.set_id('u_accept',  '00000000-0000-4000-9000-0000000000a3');
  perform tstl8.set_id('u_expired', '00000000-0000-4000-9000-0000000000a4');

  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
    (tstl8.id('u_admin'),   'l8.admin@teste.local',   '{"full_name":"Admin L8"}',   now()),
    (tstl8.id('u_adv'),     'l8.adv@teste.local',     '{"full_name":"Adv L8"}',     now()),
    (tstl8.id('u_accept'),  'l8.accept@teste.local',  '{"full_name":"Aceite L8"}',  now()),
    (tstl8.id('u_expired'), 'l8.expired@teste.local', '{"full_name":"Expirado L8"}', now());

  perform set_config('request.jwt.claims', json_build_object('sub', tstl8.id('u_admin'))::text, true);
  v_org := public.create_organization('Escritório L8');
  perform tstl8.set_id('org_a', v_org);

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, tstl8.id('u_adv'), 'advogado');

  perform tstl8.set_id('tok_valid',    '11111111-1111-4111-8111-111111111111');
  perform tstl8.set_id('tok_accepted', '22222222-2222-4222-8222-222222222222');
  perform tstl8.set_id('tok_expired',  '33333333-3333-4333-8333-333333333333');
  perform tstl8.set_id('tok_accept',   '44444444-4444-4444-8444-444444444444');

  insert into public.organization_invitations (organization_id, email, role, token, expires_at)
  values (v_org, 'l8.valid@teste.local', 'advogado', tstl8.id('tok_valid'), now() + interval '14 days')
  returning id into v_id;
  perform tstl8.set_id('inv_valid', v_id);

  insert into public.organization_invitations (organization_id, email, role, token, expires_at, accepted_at)
  values (v_org, 'l8.accepted@teste.local', 'assistente', tstl8.id('tok_accepted'), now() + interval '14 days', now())
  returning id into v_id;
  perform tstl8.set_id('inv_accepted', v_id);

  insert into public.organization_invitations (organization_id, email, role, token, expires_at)
  values (v_org, 'l8.expired@teste.local', 'advogado', tstl8.id('tok_expired'), now() - interval '1 day')
  returning id into v_id;
  perform tstl8.set_id('inv_expired', v_id);

  insert into public.organization_invitations (organization_id, email, role, token, expires_at)
  values (v_org, 'l8.accept@teste.local', 'assistente', tstl8.id('tok_accept'), now() + interval '14 days')
  returning id into v_id;
  perform tstl8.set_id('inv_accept', v_id);

  -- Convite criado sem token/expires_at: confere os defaults da migration.
  insert into public.organization_invitations (organization_id, email, role)
  values (v_org, 'l8.default@teste.local', 'assistente')
  returning id into v_id;
  perform tstl8.set_id('inv_default', v_id);

  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- -----------------------------------------------------------------------------
-- 1. Defaults e unicidade do token
-- -----------------------------------------------------------------------------
do $$
declare v_token uuid; v_exp timestamptz; v_created timestamptz;
begin
  select token, expires_at, created_at into v_token, v_exp, v_created
    from public.organization_invitations where id = tstl8.id('inv_default');

  perform tstl8.ok(v_token is not null, 'token é gerado por padrão');
  -- created_at e expires_at usam now() (mesmo instante na transação):
  -- 14 dias = 14 * 24h = 336h.
  perform tstl8.eq(v_exp, v_created + interval '336 hours', 'validade padrão é created_at + 14 dias');
end $$;

do $$
begin
  perform tstl8.expect_error_state(
    format($q$insert into public.organization_invitations (organization_id, email, role, token)
              values (%L, 'l8.dup@teste.local', 'advogado', %L)$q$,
           tstl8.id('org_a'), tstl8.id('tok_valid')),
    '23505', 'token repetido é recusado pelo índice único');
end $$;

-- -----------------------------------------------------------------------------
-- 2. invitation_preview como anon
-- -----------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform tstl8.login_anon();

  v := public.invitation_preview(tstl8.id('tok_valid'));
  perform tstl8.eq(v->>'status', 'pendente', 'preview de token válido é pendente');
  perform tstl8.eq(v->>'organization_name', 'Escritório L8', 'preview válido devolve o nome do escritório');
  perform tstl8.eq(v->>'email', 'l8.valid@teste.local', 'preview válido devolve o e-mail convidado');
  perform tstl8.eq(v->>'role', 'advogado', 'preview válido devolve o papel');
  perform tstl8.ok(
    not (v ? 'id') and not (v ? 'organization_id') and not (v ? 'token')
      and not (v ? 'invited_by') and not (v ? 'accepted_at'),
    'preview não devolve ids, token nem dados de outros convites');

  v := public.invitation_preview(tstl8.id('tok_accepted'));
  perform tstl8.eq(v->>'status', 'aceito', 'preview de token aceito é aceito');

  v := public.invitation_preview(tstl8.id('tok_expired'));
  perform tstl8.eq(v->>'status', 'expirado', 'preview de token expirado é expirado');

  v := public.invitation_preview('99999999-9999-4999-8999-999999999999'::uuid);
  perform tstl8.eq(v, jsonb_build_object('status', 'invalido'),
                   'token inexistente devolve somente {status: invalido}');

  perform tstl8.eq(
    tstl8.visible('select 1 from public.organization_invitations'),
    0::bigint,
    'anon chama preview mas não lê organization_invitations');
end $$;
reset role;

-- -----------------------------------------------------------------------------
-- 3. accept_pending_invitations ignora convite expirado
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstl8.login('u_expired');
  perform tstl8.eq(public.accept_pending_invitations(), 0, 'convite expirado não é aceito');
end $$;
reset role;

do $$
begin
  perform tstl8.ok(
    (select accepted_at is null from public.organization_invitations where id = tstl8.id('inv_expired')),
    'convite expirado continua pendente após a tentativa');
  perform tstl8.ok(
    not exists (select 1 from public.organization_members
                 where organization_id = tstl8.id('org_a') and user_id = tstl8.id('u_expired')),
    'usuário com convite expirado não vira membro');
end $$;

-- Controle: convite dentro do prazo continua sendo aceito normalmente.
do $$
begin
  perform tstl8.login('u_accept');
  perform tstl8.eq(public.accept_pending_invitations(), 1, 'convite dentro do prazo é aceito');
end $$;
reset role;

do $$
begin
  perform tstl8.ok(
    (select accepted_at is not null from public.organization_invitations where id = tstl8.id('inv_accept')),
    'convite aceito é marcado com accepted_at');
  perform tstl8.eq(
    (select role from public.organization_members
      where organization_id = tstl8.id('org_a') and user_id = tstl8.id('u_accept')),
    'assistente'::public.member_role,
    'convidado entra com o papel do convite');
end $$;

-- -----------------------------------------------------------------------------
-- 4. renew_invitation: só admin
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstl8.login('u_adv');
  perform tstl8.expect_error_state(
    format('select public.renew_invitation(%L)', tstl8.id('inv_expired')),
    '42501', 'advogado não pode renovar convite');
end $$;
reset role;

do $$
begin
  perform tstl8.ok(
    exists (select 1 from public.organization_invitations where id = tstl8.id('inv_expired')),
    'convite expirado continua existindo após tentativa sem permissão');
end $$;

-- -----------------------------------------------------------------------------
-- 5. renew_invitation: admin troca o token e revalida por 14 dias
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstl8.login('u_admin');
  perform public.renew_invitation(tstl8.id('inv_expired'));
end $$;
reset role;

do $$
declare
  v_old uuid := tstl8.id('tok_expired');
  v_new uuid;
  v_exp timestamptz;
  v_prev jsonb;
begin
  select token, expires_at into v_new, v_exp
    from public.organization_invitations where id = tstl8.id('inv_expired');

  perform tstl8.ok(v_new is not null and v_new <> v_old, 'renovar troca o token');
  -- now() é o instante da transação; a RPC define now() + 14 dias = +336h.
  perform tstl8.eq(v_exp, now() + interval '336 hours', 'renovar define validade de 14 dias');
  perform tstl8.ok(
    not exists (select 1 from public.organization_invitations where token = v_old),
    'token antigo deixa de existir no banco');

  perform tstl8.login_anon();
  v_prev := public.invitation_preview(v_old);
  perform tstl8.eq(v_prev->>'status', 'invalido', 'link antigo vira invalido após renovar');
  v_prev := public.invitation_preview(v_new);
  perform tstl8.eq(v_prev->>'status', 'pendente', 'link novo fica pendente');
  perform tstl8.eq(v_prev->>'email', 'l8.expired@teste.local', 'link novo mantém o e-mail convidado');
end $$;
reset role;

do $$ begin
  raise warning 'invite_link_test.sql: % verificações do lote L8 OK', (select last_value from tstl8.passed);
end $$;
rollback;
