-- =============================================================================
-- JurisFlow AI — L3: agenda_items respeita o isolamento entre escritórios
-- =============================================================================
-- Um membro do escritório B chamando agenda_items com o escritório A deve
-- receber 42501 ('Sem acesso a este escritório'). Arquivo separado para não
-- alterar rls_test.sql (já commitado).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
set local timezone = 'America/Sao_Paulo';

create schema tstr;
create sequence tstr.passed;

create function tstr.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tstr.' || p, true), '')::uuid $$;

create function tstr.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tstr.' || p, v::text, false) $$;

create function tstr.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tstr.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tstr.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tstr.passed');
end $$;

create function tstr.expect_error_state(q text, state text, fragment text, label text) returns void language plpgsql as $$
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
  elsif position(fragment in msg) = 0 then
    raise exception 'FALHOU: % — mensagem inesperada: %', label, msg;
  end if;
  perform nextval('tstr.passed');
end $$;

grant usage on schema tstr to authenticated;
grant execute on all functions in schema tstr to authenticated;
grant usage, select on sequence tstr.passed to authenticated;

do $$
begin
  perform tstr.set_id('u_a', '00000000-0000-4000-9000-00000000b001');
  perform tstr.set_id('u_b', '00000000-0000-4000-9000-00000000b002');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tstr.id('u_a'), 'agenda.rls.a@teste.local', '{"full_name":"Admin A"}'),
    (tstr.id('u_b'), 'agenda.rls.b@teste.local', '{"full_name":"Admin B"}');

  perform set_config('request.jwt.claims', json_build_object('sub', tstr.id('u_a'))::text, true);
  perform tstr.set_id('org_a', public.create_organization('Escritório Agenda A'));
  perform set_config('request.jwt.claims', json_build_object('sub', tstr.id('u_b'))::text, true);
  perform tstr.set_id('org_b', public.create_organization('Escritório Agenda B'));
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Controle positivo: o membro de A acessa a própria agenda.
do $$
begin
  perform tstr.login('u_a');
  perform tstr.ok((select count(*) from public.agenda_items(tstr.id('org_a'), current_date, current_date)) >= 0,
                  'membro de A acessa a agenda de A');
  reset role;
end $$;

-- Membro de B com a organização A: recusado.
do $$
begin
  perform tstr.login('u_b');
  perform tstr.expect_error_state(
    format('select * from public.agenda_items(%L, current_date, current_date)', tstr.id('org_a')),
    '42501', 'Sem acesso a este escritório', 'membro de B lê agenda de A');
  reset role;
end $$;

-- Controle: B acessa a própria agenda.
do $$
begin
  perform tstr.login('u_b');
  perform tstr.ok((select count(*) from public.agenda_items(tstr.id('org_b'), current_date, current_date)) >= 0,
                  'membro de B acessa a agenda de B');
  reset role;
end $$;

reset role;
do $$ begin
  raise warning 'agenda_rls_test.sql: % verificações de isolamento OK', (select last_value from tstr.passed);
end $$;
rollback;
