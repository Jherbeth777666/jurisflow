-- =============================================================================
-- JurisFlow AI — Testes de aceite do lote L14: importação com lote, desfazer e mapeamento lembrado
-- =============================================================================
-- Cobre a migration 20261112000007_import_batches.sql descrita no plano L14:
--   * import_batches: membros leem; outro escritório não lê; insert com created_by
--     alheio falha; só o criador atualiza as colunas de contagem e só enquanto o
--     lote não foi desfeito; sem DELETE; anon não acessa.
--   * clients/demands.import_batch_id: FK composta (lote de outro escritório é
--     recusado; lote com registros ligados nunca é apagado).
--   * import_batch_updates: membros leem; insert só no próprio lote não desfeito;
--     chaves de "applied" restritas; sem UPDATE/DELETE.
--   * import_mappings: upsert por (organização, assinatura); limites de tamanho;
--     isolamento por escritório; sem DELETE.
--   * undo_import_batch: remove o que está sem uso, mantém (e conta) o que já foi
--     usado, restaura campo atualizado ainda igual e mantém o alterado depois;
--     segundo desfazer → 22023; lote de 31 dias → 22023; não admin e não criador
--     → 42501; admin pode; lote inexistente/de outro escritório → 42501; anon barrado.
-- Roda em transação desfeita no final. Qualquer falha → raise exception → psql para.
--
-- Contas do lote principal (b1), feitas à mão:
--   demandas: d_free (sem uso), d_task (tem tarefa), d_check (item marcado),
--             d_contract (tem contrato), d_moved (mudou de etapa: 2 registros)
--             → removed_demands = 1, skipped_demands = 4.
--   clientes: cl_free (só d_free) e cl_lonely (sem nada) são removidos;
--             cl_task, cl_check, cl_contract, cl_moved (demanda mantida) e
--             cl_task2 (tarefa direta) ficam → removed_clients = 2, skipped_clients = 5.
--   atualização: c_upd teve phone e email aplicados; depois o email foi alterado
--             → phone volta (restored_clients = 1), email fica (skipped_fields = 1).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;

create schema tsta;
create sequence tsta.passed;

create function tsta.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tsta.' || p, true), '')::uuid $$;

create function tsta.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tsta.' || p, v::text, false) $$;

create function tsta.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tsta.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tsta.passed');
end $$;

create function tsta.eq(got anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FALHOU: % — obtido %, esperado %', label, got, expected;
  end if;
  perform nextval('tsta.passed');
end $$;

create function tsta.expect_error_state(q text, state text, fragment text, label text) returns void language plpgsql as $$
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
  perform nextval('tsta.passed');
end $$;

-- Recusa por erro (qualquer SQLSTATE) OU por RLS silenciosa (0 linhas afetadas).
create function tsta.expect_blocked(q text, label text) returns void language plpgsql as $$
declare n int; failed boolean := false;
begin
  begin
    execute q;
    get diagnostics n = row_count;
  exception when others then
    failed := true;
  end;
  if not failed and coalesce(n, 0) > 0 then
    raise exception 'FALHOU: % — a operação afetou % linha(s), deveria ser bloqueada', label, n;
  end if;
  perform nextval('tsta.passed');
end $$;

-- Recusa por qualquer erro (a regra pode ser constraint ou gatilho).
create function tsta.expect_any_error(q text, label text) returns void language plpgsql as $$
declare failed boolean := false;
begin
  begin
    execute q;
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FALHOU: % — a operação deveria ser recusada, mas foi aceita', label;
  end if;
  perform nextval('tsta.passed');
end $$;

grant usage on schema tsta to authenticated, anon;
grant execute on all functions in schema tsta to authenticated, anon;
grant usage, select on sequence tsta.passed to authenticated, anon;

-- =============================================================================
-- Fixtures: escritório A (admin, criador advogado, colega advogado) e B (admin_b).
-- =============================================================================
do $$
begin
  perform tsta.set_id('u_admin',   '14000000-0000-4000-a000-000000000001');
  perform tsta.set_id('u_creator', '14000000-0000-4000-a000-000000000002');
  perform tsta.set_id('u_other',   '14000000-0000-4000-a000-000000000003');
  perform tsta.set_id('u_admin_b', '14000000-0000-4000-a000-000000000004');

  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'),   'l14.admin@teste.local',   '{"full_name":"Ana Admin L14"}'),
    (tsta.id('u_creator'), 'l14.criador@teste.local', '{"full_name":"Bruno Criador L14"}'),
    (tsta.id('u_other'),   'l14.colega@teste.local',  '{"full_name":"Carla Colega L14"}'),
    (tsta.id('u_admin_b'), 'l14.admin.b@teste.local', '{"full_name":"Diego Admin B L14"}');
end $$;

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  perform tsta.set_id('org_a', public.create_organization('Escritório L14 A'));

  insert into organization_members (organization_id, user_id, role) values
    (tsta.id('org_a'), tsta.id('u_creator'), 'advogado'),
    (tsta.id('org_a'), tsta.id('u_other'),   'advogado');

  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_b'))::text, true);
  perform tsta.set_id('org_b', public.create_organization('Escritório L14 B'));

  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- Lotes criados pelos próprios usuários (passa pela policy de INSERT).
do $$ begin perform tsta.login('u_creator'); end $$;

do $$
declare
  v_id uuid;
begin
  -- created_by omitido: o padrão é auth.uid().
  insert into public.import_batches (organization_id, file_name, created_clients, updated_clients, created_demands)
  values (tsta.id('org_a'), 'l14-principal.xlsx', 6, 1, 5)
  returning id into v_id;
  perform tsta.set_id('b1', v_id);
  perform tsta.eq((select created_by from public.import_batches where id = v_id),
                  tsta.id('u_creator'), 'created_by padrão é o usuário logado');
  perform tsta.ok((select created_at is not null and undone_at is null from public.import_batches where id = v_id),
                  'lote nasce com created_at e sem undone_at');

  insert into public.import_batches (organization_id, file_name, created_by)
  values (tsta.id('org_a'), 'l14-antigo.xlsx', tsta.id('u_creator'))
  returning id into v_id;
  perform tsta.set_id('b_old', v_id);

  insert into public.import_batches (organization_id, file_name, created_by)
  values (tsta.id('org_a'), 'l14-admin.xlsx', tsta.id('u_creator'))
  returning id into v_id;
  perform tsta.set_id('b_admin', v_id);

  -- Lote do próprio colega para provar "não criou → 42501".
  insert into public.import_batches (organization_id, file_name, created_by)
  values (tsta.id('org_a'), 'l14-colega.xlsx', tsta.id('u_creator'))
  returning id into v_id;
  perform tsta.set_id('b_second', v_id);
end $$;

reset role;

do $$ begin perform tsta.login('u_admin_b'); end $$;
do $$
declare
  v_id uuid;
begin
  insert into public.import_batches (organization_id, file_name, created_by)
  values (tsta.id('org_b'), 'l14-b.xlsx', tsta.id('u_admin_b'))
  returning id into v_id;
  perform tsta.set_id('b_b', v_id);

  insert into public.import_mappings (organization_id, signature, mapping)
  values (tsta.id('org_b'), 'b0b0b0b0b0b0b0b0', '{"full_name":0}'::jsonb);
end $$;
reset role;

-- O lote de 31 dias é antigo de verdade (created_at não é editável pelo usuário).
update public.import_batches set created_at = now() - interval '31 days' where id = tsta.id('b_old');

-- Dados do escritório A ligados ao lote b1 (inseridos como postgres).
do $$
declare
  o uuid := tsta.id('org_a');
  b uuid := tsta.id('b1');
  v_cat uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_id uuid;
  v_cl uuid;
  v_d uuid;
begin
  select id into v_cat from demand_categories where organization_id = o and name = 'Aposentadoria';
  select id into v_s1 from workflow_stages where category_id = v_cat order by position limit 1;
  select id into v_s2 from workflow_stages where category_id = v_cat order by position offset 1 limit 1;
  perform tsta.set_id('cat', v_cat);
  perform tsta.set_id('stage_1', v_s1);
  perform tsta.set_id('stage_2', v_s2);

  -- Cliente sem demanda e sem uso.
  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Solitário', b) returning id into v_id;
  perform tsta.set_id('cl_lonely', v_id);

  -- Cliente com tarefa direta (sem demanda).
  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Tarefa Direta', b) returning id into v_id;
  perform tsta.set_id('cl_task2', v_id);
  insert into tasks (organization_id, title, client_id) values (o, 'L14 tarefa direta', v_id);

  -- Um cliente por demanda: livre, com tarefa, com item marcado, com contrato, que mudou de etapa.
  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Livre', b) returning id into v_cl;
  perform tsta.set_id('cl_free', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda livre', b) returning id into v_d;
  perform tsta.set_id('d_free', v_d);

  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Com Tarefa', b) returning id into v_cl;
  perform tsta.set_id('cl_task', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda com tarefa', b) returning id into v_d;
  perform tsta.set_id('d_task', v_d);
  insert into tasks (organization_id, title, demand_id, client_id) values (o, 'L14 tarefa da demanda', v_d, v_cl);

  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Com Checklist', b) returning id into v_cl;
  perform tsta.set_id('cl_check', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda com checklist', b) returning id into v_d;
  perform tsta.set_id('d_check', v_d);
  insert into demand_checklist_items (organization_id, demand_id, label, done) values (o, v_d, 'L14 item', true);

  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Com Contrato', b) returning id into v_cl;
  perform tsta.set_id('cl_contract', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda com contrato', b) returning id into v_d;
  perform tsta.set_id('d_contract', v_d);
  insert into contracts (organization_id, client_id, demand_id, total_amount)
  values (o, v_cl, v_d, 1000);

  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Mudou Etapa', b) returning id into v_cl;
  perform tsta.set_id('cl_moved', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda que mudou de etapa', b) returning id into v_d;
  perform tsta.set_id('d_moved', v_d);
  update demands set stage_id = v_s2 where id = v_d;

  -- Cliente existente que recebeu dados na importação (não é do lote).
  insert into clients (organization_id, full_name, phone, email)
  values (o, 'Cliente L14 Atualizado', '11999990001', 'novo@l14.local') returning id into v_cl;
  perform tsta.set_id('c_upd', v_cl);

  -- Lote admin: um cliente + uma demanda sem uso.
  insert into clients (organization_id, full_name, import_batch_id)
  values (o, 'Cliente L14 Do Lote Admin', tsta.id('b_admin')) returning id into v_cl;
  perform tsta.set_id('cl_adm', v_cl);
  insert into demands (organization_id, client_id, category_id, stage_id, title, import_batch_id)
  values (o, v_cl, v_cat, v_s1, 'L14 demanda do lote admin', tsta.id('b_admin')) returning id into v_d;
  perform tsta.set_id('d_adm', v_d);
end $$;

do $$
begin
  -- Sanidade da fixture: a demanda que mudou de etapa tem 2 registros; as demais, 1.
  perform tsta.eq((select count(*)::int from demand_stage_history where demand_id = tsta.id('d_moved')), 2,
                  'fixture: d_moved tem 2 registros de etapa');
  perform tsta.eq((select count(*)::int from demand_stage_history where demand_id = tsta.id('d_free')), 1,
                  'fixture: d_free tem 1 registro de etapa');
end $$;

-- Registro das atualizações do lote b1 (passa pela policy de INSERT do criador).
do $$ begin perform tsta.login('u_creator'); end $$;
do $$
begin
  insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied)
  values (tsta.id('org_a'), tsta.id('b1'), tsta.id('c_upd'),
          '{"phone":null,"email":null}'::jsonb,
          '{"phone":"11999990001","email":"novo@l14.local"}'::jsonb);
  perform tsta.eq((select count(*)::int from public.import_batch_updates where batch_id = tsta.id('b1')), 1,
                  'criador registra a atualização do próprio lote');
end $$;
reset role;

-- Depois da importação, alguém mudou o email: ele não deve voltar no desfazer.
update clients set email = 'alterado-depois@l14.local' where id = tsta.id('c_upd');

-- =============================================================================
-- 1. RLS de import_batches
-- =============================================================================
do $$ begin perform tsta.login('u_other'); end $$;
do $$
begin
  -- Colega vê os 4 lotes do escritório A (b1, b_old, b_admin, b_second); nenhum do B.
  perform tsta.eq((select count(*)::int from public.import_batches), 4, 'membro vê os 4 lotes do próprio escritório');
  perform tsta.eq((select count(*)::int from public.import_batches where id = tsta.id('b_b')), 0,
                  'membro não vê lote de outro escritório');

  -- Insert em nome de outra pessoa é recusado.
  perform tsta.expect_error_state(
    format('insert into public.import_batches (organization_id, file_name, created_by) values (%L, %L, %L)',
           tsta.id('org_a'), 'em-nome-de-outro.xlsx', tsta.id('u_creator')),
    '42501', '', 'insert com created_by alheio falha');

  -- Insert em escritório onde não é membro é recusado.
  perform tsta.expect_error_state(
    format('insert into public.import_batches (organization_id, file_name, created_by) values (%L, %L, %L)',
           tsta.id('org_b'), 'invasao.xlsx', tsta.id('u_other')),
    '42501', '', 'insert em escritório alheio falha');

  -- file_name acima de 200 caracteres é recusado.
  perform tsta.expect_any_error(
    format('insert into public.import_batches (organization_id, file_name, created_by) values (%L, %L, %L)',
           tsta.id('org_a'), repeat('a', 201), tsta.id('u_other')),
    'file_name acima de 200 caracteres é recusado');

  -- Quem não criou não atualiza contagens (RLS silenciosa ou erro).
  perform tsta.expect_blocked(
    format('update public.import_batches set created_clients = 99 where id = %L', tsta.id('b1')),
    'colega não criador não atualiza contagens do lote');

  -- Ninguém apaga lote.
  perform tsta.expect_blocked(
    format('delete from public.import_batches where id = %L', tsta.id('b1')),
    'membro não apaga lote');
end $$;
reset role;

do $$ begin perform tsta.login('u_creator'); end $$;
do $$
declare
  n int;
begin
  -- Criador atualiza as colunas de contagem enquanto o lote não foi desfeito.
  update public.import_batches set created_clients = 6, updated_clients = 1, created_demands = 5
   where id = tsta.id('b_second');
  get diagnostics n = row_count;
  perform tsta.eq(n, 1, 'criador atualiza as contagens do próprio lote');
  perform tsta.eq((select created_demands from public.import_batches where id = tsta.id('b_second')), 5,
                  'contagem gravada');

  -- Mas não edita outras colunas (nome do arquivo, undone_at, created_by).
  perform tsta.expect_blocked(
    format('update public.import_batches set file_name = %L where id = %L', 'renomeado.xlsx', tsta.id('b_second')),
    'criador não troca o nome do arquivo');
  perform tsta.expect_blocked(
    format('update public.import_batches set undone_at = now() where id = %L', tsta.id('b_second')),
    'criador não marca o lote como desfeito direto');
  perform tsta.expect_blocked(
    format('update public.import_batches set created_by = %L where id = %L', tsta.id('u_other'), tsta.id('b_second')),
    'criador não troca o dono do lote');
  perform tsta.eq((select file_name from public.import_batches where id = tsta.id('b_second')), 'l14-colega.xlsx',
                  'nome do arquivo permanece');
  perform tsta.ok((select undone_at is null from public.import_batches where id = tsta.id('b_second')),
                  'lote continua não desfeito');
end $$;
reset role;

do $$ begin perform tsta.login('u_admin_b'); end $$;
do $$
begin
  perform tsta.eq((select count(*)::int from public.import_batches), 1, 'admin B vê só o lote do próprio escritório');
  perform tsta.eq((select count(*)::int from public.import_batch_updates), 0, 'admin B não vê atualizações do escritório A');
  perform tsta.eq((select count(*)::int from public.import_mappings), 1, 'admin B vê só o mapeamento do próprio escritório');
  perform tsta.expect_error_state(
    format('insert into public.import_batches (organization_id, file_name, created_by) values (%L, %L, %L)',
           tsta.id('org_a'), 'invasao.xlsx', tsta.id('u_admin_b')),
    '42501', '', 'admin B não cria lote no escritório A');
  perform tsta.expect_error_state(
    format('insert into public.import_mappings (organization_id, signature, mapping) values (%L, %L, %L)',
           tsta.id('org_a'), 'cafecafecafecafe', '{"full_name":0}'),
    '42501', '', 'admin B não grava mapeamento no escritório A');
  perform tsta.expect_error_state(
    format('insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied) values (%L, %L, %L, %L, %L)',
           tsta.id('org_a'), tsta.id('b1'), tsta.id('c_upd'), '{"phone":null}', '{"phone":"11999990002"}'),
    '42501', '', 'admin B não registra atualização no escritório A');
end $$;
reset role;

set role anon;
do $$ begin
  perform tsta.expect_error_state('select count(*) from public.import_batches', '42501', '', 'anon não lê import_batches');
  perform tsta.expect_error_state('select count(*) from public.import_mappings', '42501', '', 'anon não lê import_mappings');
  perform tsta.expect_error_state('select count(*) from public.import_batch_updates', '42501', '', 'anon não lê import_batch_updates');
  perform tsta.expect_error_state(format('select public.undo_import_batch(%L::uuid)', tsta.id('b1')),
                                  '42501', '', 'anon não executa undo_import_batch');
end $$;
reset role;

-- =============================================================================
-- 2. FKs compostas: clientes/demandas só apontam para lote do próprio escritório
-- =============================================================================
do $$
begin
  perform tsta.expect_error_state(
    format('insert into public.clients (organization_id, full_name, import_batch_id) values (%L, %L, %L)',
           tsta.id('org_b'), 'Cliente L14 FK', tsta.id('b1')),
    '23503', '', 'cliente não aponta para lote de outro escritório');

  -- O lote nunca é apagado enquanto há registros ligados a ele.
  perform tsta.expect_error_state(
    format('delete from public.import_batches where id = %L', tsta.id('b1')),
    '23503', '', 'lote com clientes ligados não pode ser apagado');
end $$;

-- =============================================================================
-- 3. import_batch_updates: regras de INSERT e imutabilidade
-- =============================================================================
do $$ begin perform tsta.login('u_other'); end $$;
do $$
begin
  perform tsta.eq((select count(*)::int from public.import_batch_updates), 1, 'membro lê as atualizações do escritório');
  perform tsta.expect_error_state(
    format('insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied) values (%L, %L, %L, %L, %L)',
           tsta.id('org_a'), tsta.id('b1'), tsta.id('c_upd'), '{"phone":null}', '{"phone":"11999990002"}'),
    '42501', '', 'colega não registra atualização em lote que não é dele');
end $$;
reset role;

do $$ begin perform tsta.login('u_creator'); end $$;
do $$
begin
  -- Só chaves permitidas em "applied".
  perform tsta.expect_any_error(
    format('insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied) values (%L, %L, %L, %L, %L)',
           tsta.id('org_a'), tsta.id('b_second'), tsta.id('c_upd'), '{"full_name":"x"}', '{"full_name":"y"}'),
    'applied só aceita cpf/phone/email/birth_date/address');

  -- Insert válido no próprio lote.
  insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied)
  values (tsta.id('org_a'), tsta.id('b_second'), tsta.id('c_upd'), '{"address":null}', '{"address":"Rua L14"}');
  perform tsta.eq((select count(*)::int from public.import_batch_updates where batch_id = tsta.id('b_second')), 1,
                  'criador registra atualização no próprio lote');

  -- Sem UPDATE nem DELETE.
  perform tsta.expect_blocked(
    format('update public.import_batch_updates set applied = %L where batch_id = %L', '{"address":"Outra"}', tsta.id('b_second')),
    'atualização registrada não pode ser editada');
  perform tsta.expect_blocked(
    format('delete from public.import_batch_updates where batch_id = %L', tsta.id('b_second')),
    'atualização registrada não pode ser apagada');
end $$;
reset role;

-- =============================================================================
-- 4. import_mappings: upsert por (organização, assinatura) e limites
-- =============================================================================
do $$ begin perform tsta.login('u_creator'); end $$;
do $$
declare
  o uuid := tsta.id('org_a');
  n int;
begin
  insert into public.import_mappings (organization_id, signature, mapping, category_map)
  values (o, 'a1b2c3d4e5f60718', '{"full_name":0,"cpf":1}'::jsonb, '{"Aposentadoria":"cat-1"}'::jsonb);
  perform tsta.eq((select count(*)::int from public.import_mappings where organization_id = o), 1, 'mapeamento criado');
  perform tsta.eq((select updated_by from public.import_mappings where signature = 'a1b2c3d4e5f60718'),
                  tsta.id('u_creator'), 'updated_by padrão é o usuário logado');

  -- Upsert da mesma assinatura atualiza em vez de duplicar.
  insert into public.import_mappings (organization_id, signature, mapping, category_map)
  values (o, 'a1b2c3d4e5f60718', '{"full_name":0,"cpf":2,"phone":1}'::jsonb, '{}'::jsonb)
  on conflict (organization_id, signature)
  do update set mapping = excluded.mapping, category_map = excluded.category_map, updated_at = now();
  perform tsta.eq((select count(*)::int from public.import_mappings where organization_id = o), 1,
                  'upsert não duplica a assinatura');
  perform tsta.eq((select (mapping->>'phone')::int from public.import_mappings where signature = 'a1b2c3d4e5f60718'), 1,
                  'upsert atualizou o mapeamento');
  perform tsta.eq((select category_map from public.import_mappings where signature = 'a1b2c3d4e5f60718'), '{}'::jsonb,
                  'upsert atualizou o mapa de categorias');

  -- Outra assinatura vira outra linha.
  insert into public.import_mappings (organization_id, signature, mapping)
  values (o, '1111222233334444', '{"full_name":0}'::jsonb);
  perform tsta.eq((select count(*)::int from public.import_mappings where organization_id = o), 2,
                  'outra assinatura cria outra linha');
  perform tsta.eq((select category_map from public.import_mappings where signature = '1111222233334444'), '{}'::jsonb,
                  'category_map tem padrão {}');

  -- Limites.
  perform tsta.expect_any_error(
    format('insert into public.import_mappings (organization_id, signature, mapping) values (%L, %L, %L)',
           o, 'abc', '{"full_name":0}'),
    'assinatura com menos de 8 caracteres é recusada');
  perform tsta.expect_any_error(
    format('insert into public.import_mappings (organization_id, signature, mapping) values (%L, %L, %L)',
           o, repeat('a', 65), '{"full_name":0}'),
    'assinatura com mais de 64 caracteres é recusada');
  perform tsta.expect_any_error(
    format('insert into public.import_mappings (organization_id, signature, mapping) values (%L, %L, %L::jsonb)',
           o, 'bbbbbbbbbbbbbbbb', jsonb_build_object('x', repeat('a', 5000))::text),
    'mapping acima de 4096 bytes é recusado');
  perform tsta.expect_any_error(
    format('insert into public.import_mappings (organization_id, signature, mapping, category_map) values (%L, %L, %L, %L::jsonb)',
           o, 'cccccccccccccccc', '{"full_name":0}', jsonb_build_object('x', repeat('a', 9000))::text),
    'category_map acima de 8192 bytes é recusado');

  -- Sem DELETE.
  perform tsta.expect_blocked('delete from public.import_mappings', 'mapeamento não pode ser apagado');
  perform tsta.eq((select count(*)::int from public.import_mappings where organization_id = o), 2,
                  'nenhum mapeamento foi apagado');
end $$;
reset role;

do $$ begin perform tsta.login('u_other'); end $$;
do $$
declare
  n int;
begin
  -- Membros que importam compartilham o mapeamento do escritório: leem e atualizam.
  perform tsta.eq((select count(*)::int from public.import_mappings), 2, 'colega lê os mapeamentos do escritório');
  update public.import_mappings set mapping = '{"full_name":3}'::jsonb where signature = '1111222233334444';
  get diagnostics n = row_count;
  perform tsta.eq(n, 1, 'colega atualiza mapeamento do escritório');
end $$;
reset role;

-- =============================================================================
-- 5. undo_import_batch — recusas (nada pode mudar)
-- =============================================================================
-- Colega que não criou e não é admin → 42501.
do $$ begin perform tsta.login('u_other'); end $$;
do $$
begin
  perform tsta.expect_error_state(
    format('select public.undo_import_batch(%L::uuid)', tsta.id('b1')),
    '42501', '', 'não admin que não criou o lote não desfaz');
end $$;
reset role;

-- Outro escritório → 42501 (lote invisível).
do $$ begin perform tsta.login('u_admin_b'); end $$;
do $$
begin
  perform tsta.expect_error_state(
    format('select public.undo_import_batch(%L::uuid)', tsta.id('b1')),
    '42501', '', 'admin de outro escritório não desfaz');
end $$;
reset role;

do $$ begin perform tsta.login('u_admin'); end $$;
do $$
begin
  -- Lote inexistente → 42501.
  perform tsta.expect_error_state(
    format('select public.undo_import_batch(%L::uuid)', gen_random_uuid()),
    '42501', '', 'lote inexistente é recusado');
  -- Lote criado há 31 dias → 22023 (mesmo para admin).
  perform tsta.expect_error_state(
    format('select public.undo_import_batch(%L::uuid)', tsta.id('b_old')),
    '22023', '', 'lote com mais de 30 dias não pode ser desfeito');
end $$;
reset role;

-- Nada foi removido pelas tentativas recusadas.
do $$
begin
  perform tsta.eq((select count(*)::int from public.clients where import_batch_id = tsta.id('b1')), 7,
                  'tentativas recusadas não removeram clientes do lote');
  perform tsta.eq((select count(*)::int from public.demands where import_batch_id = tsta.id('b1')), 5,
                  'tentativas recusadas não removeram demandas do lote');
  perform tsta.ok((select undone_at is null from public.import_batches where id = tsta.id('b1')),
                  'lote continua sem undone_at');
end $$;

-- =============================================================================
-- 6. undo_import_batch — o criador desfaz o lote principal
-- =============================================================================
do $$ begin perform tsta.login('u_creator'); end $$;
do $$
declare
  r jsonb;
begin
  r := public.undo_import_batch(tsta.id('b1'));
  perform tsta.eq((r->>'removed_clients')::int,  2, 'resultado: removed_clients');
  perform tsta.eq((r->>'removed_demands')::int,  1, 'resultado: removed_demands');
  perform tsta.eq((r->>'restored_clients')::int, 1, 'resultado: restored_clients');
  perform tsta.eq((r->>'skipped_clients')::int,  5, 'resultado: skipped_clients');
  perform tsta.eq((r->>'skipped_demands')::int,  4, 'resultado: skipped_demands');
  perform tsta.eq((r->>'skipped_fields')::int,   1, 'resultado: skipped_fields');
end $$;
reset role;

do $$
begin
  -- Removidos: demanda livre e os clientes sem uso.
  perform tsta.ok(not exists (select 1 from demands where id = tsta.id('d_free')), 'demanda sem uso foi removida');
  perform tsta.ok(not exists (select 1 from clients where id = tsta.id('cl_free')), 'cliente da demanda removida foi removido');
  perform tsta.ok(not exists (select 1 from clients where id = tsta.id('cl_lonely')), 'cliente sem demanda nem uso foi removido');

  -- Mantidos: demanda com tarefa, checklist marcado, contrato e etapa alterada — e seus clientes.
  perform tsta.ok(exists (select 1 from demands where id = tsta.id('d_task')), 'demanda com tarefa foi mantida');
  perform tsta.ok(exists (select 1 from demands where id = tsta.id('d_check')), 'demanda com item de checklist marcado foi mantida');
  perform tsta.ok(exists (select 1 from demands where id = tsta.id('d_contract')), 'demanda com contrato foi mantida');
  perform tsta.ok(exists (select 1 from demands where id = tsta.id('d_moved')), 'demanda que mudou de etapa foi mantida');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_task')), 'cliente da demanda com tarefa foi mantido');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_check')), 'cliente da demanda com checklist foi mantido');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_contract')), 'cliente com contrato foi mantido');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_moved')), 'cliente da demanda que mudou de etapa foi mantido');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_task2')), 'cliente com tarefa direta foi mantido');
  perform tsta.eq((select count(*)::int from tasks where demand_id = tsta.id('d_task')), 1, 'a tarefa da demanda mantida continua lá');
  perform tsta.eq((select count(*)::int from contracts where demand_id = tsta.id('d_contract')), 1, 'o contrato continua ligado à demanda');

  -- Campos atualizados: o ainda igual volta ao valor anterior; o alterado depois fica.
  perform tsta.ok((select phone is null from clients where id = tsta.id('c_upd')), 'telefone aplicado e não alterado voltou ao valor anterior');
  perform tsta.eq((select email::text from clients where id = tsta.id('c_upd')), 'alterado-depois@l14.local',
                  'email alterado depois foi mantido');

  -- Lote marcado como desfeito, com quem e o resultado.
  perform tsta.ok((select undone_at is not null from import_batches where id = tsta.id('b1')), 'undone_at gravado');
  perform tsta.eq((select undone_by from import_batches where id = tsta.id('b1')), tsta.id('u_creator'), 'undone_by gravado');
  perform tsta.eq((select (undo_result->>'removed_clients')::int from import_batches where id = tsta.id('b1')), 2,
                  'undo_result gravado com as contagens');
  perform tsta.eq((select (undo_result->>'skipped_fields')::int from import_batches where id = tsta.id('b1')), 1,
                  'undo_result guarda skipped_fields');

  -- Lote não é apagado e o outro lote não foi tocado.
  perform tsta.ok(exists (select 1 from import_batches where id = tsta.id('b1')), 'lote continua existindo');
  perform tsta.ok(exists (select 1 from clients where id = tsta.id('cl_adm')), 'cliente de outro lote não foi tocado');
end $$;

-- Segundo desfazer → 22023.
do $$ begin perform tsta.login('u_creator'); end $$;
do $$
begin
  perform tsta.expect_error_state(
    format('select public.undo_import_batch(%L::uuid)', tsta.id('b1')),
    '22023', 'já foi desfeita', 'segundo desfazer é recusado');
end $$;
reset role;

-- Depois de desfeito, o lote fica congelado: nem contagens nem novas atualizações.
do $$ begin perform tsta.login('u_creator'); end $$;
do $$
begin
  perform tsta.expect_blocked(
    format('update public.import_batches set created_clients = 1 where id = %L', tsta.id('b1')),
    'lote desfeito não aceita mudança de contagem');
  perform tsta.expect_error_state(
    format('insert into public.import_batch_updates (organization_id, batch_id, client_id, previous, applied) values (%L, %L, %L, %L, %L)',
           tsta.id('org_a'), tsta.id('b1'), tsta.id('c_upd'), '{"phone":null}', '{"phone":"11999990003"}'),
    '42501', '', 'lote desfeito não aceita novas atualizações');
end $$;
reset role;

-- =============================================================================
-- 7. undo_import_batch — admin desfaz lote de outra pessoa
-- =============================================================================
do $$ begin perform tsta.login('u_admin'); end $$;
do $$
declare
  r jsonb;
begin
  r := public.undo_import_batch(tsta.id('b_admin'));
  perform tsta.eq((r->>'removed_clients')::int, 1, 'admin desfaz: removed_clients');
  perform tsta.eq((r->>'removed_demands')::int, 1, 'admin desfaz: removed_demands');
  perform tsta.eq((r->>'skipped_clients')::int, 0, 'admin desfaz: skipped_clients');
  perform tsta.eq((r->>'skipped_demands')::int, 0, 'admin desfaz: skipped_demands');
  perform tsta.eq((r->>'restored_clients')::int, 0, 'admin desfaz: restored_clients');
  perform tsta.eq((r->>'skipped_fields')::int, 0, 'admin desfaz: skipped_fields');
end $$;
reset role;

do $$
begin
  perform tsta.ok(not exists (select 1 from clients where id = tsta.id('cl_adm')), 'cliente do lote do admin removido');
  perform tsta.ok(not exists (select 1 from demands where id = tsta.id('d_adm')), 'demanda do lote do admin removida');
  perform tsta.eq((select undone_by from import_batches where id = tsta.id('b_admin')), tsta.id('u_admin'),
                  'undone_by é o admin que desfez');
end $$;

reset role;
do $$
begin
  raise warning 'import_batches_test.sql: % verificações do lote L14 OK',
    (select last_value from tsta.passed);
end $$;
rollback;
