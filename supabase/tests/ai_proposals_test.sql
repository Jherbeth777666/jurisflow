-- =============================================================================
-- JurisFlow AI — Testes do lote L4a: confirmação de propostas da IA
-- =============================================================================
-- Cobre a migration 20261111000003_ai_proposals.sql:
--   * ai_messages.proposals (jsonb, nulo quando não há)
--   * public.ai_proposal_done(...) com checagens de dono, membro, status e
--     proposta pendente; log em activity_logs só na confirmação.
-- Roda em transação desfeita no final. Qualquer falha → 'FALHOU: ...'.
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;

-- Antes de qualquer helper que leia o jsonb: a migration precisa existir.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_messages' and column_name = 'proposals'
  ) then
    raise exception 'FALHOU: coluna ai_messages.proposals não existe';
  end if;
  if to_regprocedure('public.ai_proposal_done(uuid,text,text,uuid)') is null then
    raise exception 'FALHOU: função public.ai_proposal_done(uuid,text,text,uuid) não existe';
  end if;
end $$;

create schema tstp;
create sequence tstp.passed;

create function tstp.id(p text) returns uuid language sql stable as
$$ select nullif(current_setting('tstp.' || p, true), '')::uuid $$;

create function tstp.set_id(p text, v uuid) returns void language sql as
$$ select set_config('tstp.' || p, v::text, false) $$;

create function tstp.login(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tstp.id(p_user))::text, true);
  if current_user <> 'authenticated' then
    perform set_config('role', 'authenticated', true);
  end if;
end $$;

create function tstp.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FALHOU: %', label; end if;
  perform nextval('tstp.passed');
end $$;

create function tstp.expect_error_state(q text, state text, fragment text, label text) returns void language plpgsql as $$
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
  elsif fragment is not null and position(fragment in msg) = 0 then
    raise exception 'FALHOU: % — mensagem inesperada: %', label, msg;
  end if;
  perform nextval('tstp.passed');
end $$;

-- Status atual de uma proposta dentro do jsonb da mensagem.
create function tstp.proposal_status(p_message uuid, p_proposal text) returns text language sql stable as $$
  select elem->>'status'
  from public.ai_messages m
  cross join lateral jsonb_array_elements(coalesce(m.proposals, '[]'::jsonb)) elem
  where m.id = p_message and elem->>'id' = p_proposal
$$;

grant usage on schema tstp to authenticated;
grant execute on all functions in schema tstp to authenticated;
grant usage, select on sequence tstp.passed to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures: dois escritórios. A tem dono e outro membro ativo; B tem outro dono.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.set_id('u_owner', '00000000-0000-4000-9000-00000000b001');
  perform tstp.set_id('u_same',  '00000000-0000-4000-9000-00000000b002');
  perform tstp.set_id('u_b',     '00000000-0000-4000-9000-00000000b003');
  perform tstp.set_id('u_out',   '00000000-0000-4000-9000-00000000b004');

  insert into auth.users (id, email, raw_user_meta_data) values
    (tstp.id('u_owner'), 'propostas.dono@teste.local',  '{"full_name":"Dono A"}'),
    (tstp.id('u_same'),  'propostas.membro@teste.local', '{"full_name":"Membro A"}'),
    (tstp.id('u_b'),     'propostas.b@teste.local',      '{"full_name":"Dono B"}'),
    (tstp.id('u_out'),   'propostas.fora@teste.local',   '{"full_name":"Fora"}');

  perform set_config('request.jwt.claims', json_build_object('sub', tstp.id('u_owner'))::text, true);
  perform tstp.set_id('org_a', public.create_organization('Escritório A'));
  insert into organization_members (organization_id, user_id, role, active)
  values (tstp.id('org_a'), tstp.id('u_same'), 'advogado', true);

  perform set_config('request.jwt.claims', json_build_object('sub', tstp.id('u_b'))::text, true);
  perform tstp.set_id('org_b', public.create_organization('Escritório B'));

  perform set_config('request.jwt.claims', json_build_object('sub', tstp.id('u_out'))::text, true);
  perform tstp.set_id('org_out', public.create_organization('Escritório Fora'));

  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  v_conv uuid;
  v_msg uuid;
  v_msg_user uuid;
  v_msg_null uuid;
begin
  insert into ai_conversations (organization_id, user_id, title)
  values (tstp.id('org_a'), tstp.id('u_owner'), 'Propostas')
  returning id into v_conv;
  perform tstp.set_id('conv', v_conv);

  insert into ai_messages (organization_id, conversation_id, user_id, role, content, proposals)
  values (
    tstp.id('org_a'), v_conv, tstp.id('u_owner'), 'assistant', 'Sugestões',
    $prop$[
      {"id":"p1","kind":"criar_tarefa","fields":{"title":"Ligar para Cliente C1","client":"Cliente C1"},"status":"pendente"},
      {"id":"p2","kind":"definir_proxima_acao","fields":{"demand_title":"Aposentadoria","next_action":"Protocolar"},"status":"pendente"},
      {"id":"p3","kind":"mover_etapa","fields":{"demand_title":"Aposentadoria","stage_name":"Aguardando perícia"},"status":"pendente"}
    ]$prop$::jsonb
  )
  returning id into v_msg;
  perform tstp.set_id('msg', v_msg);

  insert into ai_messages (organization_id, conversation_id, user_id, role, content, proposals)
  values (tstp.id('org_a'), v_conv, tstp.id('u_owner'), 'user', 'Crie as ações', null)
  returning id into v_msg_user;
  perform tstp.set_id('msg_user', v_msg_user);

  insert into ai_messages (organization_id, conversation_id, user_id, role, content, proposals)
  values (tstp.id('org_a'), v_conv, tstp.id('u_owner'), 'assistant', 'Sem propostas', null)
  returning id into v_msg_null;
  perform tstp.set_id('msg_null', v_msg_null);
end $$;

-- -----------------------------------------------------------------------------
-- 1) Coluna é nula quando a mensagem não tem propostas.
-- -----------------------------------------------------------------------------
do $$
declare
  v_null uuid := tstp.id('msg_null');
begin
  perform tstp.login('u_owner');
  perform tstp.ok(
    (select proposals is null from public.ai_messages where id = v_null),
    'proposals deve ser NULL quando não há propostas'
  );
  perform tstp.ok(
    (select jsonb_array_length(proposals) from public.ai_messages where id = tstp.id('msg')) = 3,
    'mensagem com propostas deve ter 3 elementos'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 2) Dono confirma → status muda e log ai_confirmed é criado (só metadados).
-- -----------------------------------------------------------------------------
do $$
declare
  v_msg   uuid := tstp.id('msg');
  v_org   uuid := tstp.id('org_a');
  v_owner uuid := tstp.id('u_owner');
begin
  perform tstp.login('u_owner');
  perform public.ai_proposal_done(v_msg, 'p1', 'confirmada');

  perform tstp.ok(tstp.proposal_status(v_msg, 'p1') = 'confirmada', 'p1 deve ficar confirmada');

  perform tstp.ok(
    exists (
      select 1 from public.activity_logs
      where organization_id = v_org
        and actor_id = v_owner
        and entity_type = 'ai_proposals'
        and entity_id = v_msg
        and action = 'ai_confirmed'
        and changes = jsonb_build_object('kind', 'criar_tarefa', 'proposal_id', 'p1')
    ),
    'log ai_confirmed de p1 com metadados exatos'
  );

  perform tstp.ok(
    not exists (select 1 from public.activity_logs where changes::text like '%Ligar para%'),
    'log não deve conter textos da proposta'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 3) Repetir a confirmação → 22023 (proposta já resolvida).
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_owner');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg'), 'p1', 'confirmada'),
    '22023', 'resolvida', 'repetir confirmação da mesma proposta'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 4) Outro usuário do MESMO escritório → 42501.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_same');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg'), 'p2', 'confirmada'),
    '42501', null, 'membro do mesmo escritório não pode confirmar proposta alheia'
  );

  perform tstp.login('u_owner');
  perform tstp.ok(tstp.proposal_status(tstp.id('msg'), 'p2') = 'pendente', 'p2 continua pendente após tentativa alheia');
end $$;

-- -----------------------------------------------------------------------------
-- 5) Usuário de OUTRO escritório → 42501.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_b');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg'), 'p2', 'confirmada'),
    '42501', null, 'usuário de outro escritório não pode confirmar'
  );

  perform tstp.login('u_owner');
  perform tstp.ok(tstp.proposal_status(tstp.id('msg'), 'p2') = 'pendente', 'p2 continua pendente após usuário de fora');
end $$;

-- -----------------------------------------------------------------------------
-- 6) Status inválido → 22023 (só 'confirmada' ou 'descartada').
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_owner');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg'), 'p3', 'cancelada'),
    '22023', null, 'status fora de confirmada/descartada'
  );
  perform tstp.ok(tstp.proposal_status(tstp.id('msg'), 'p3') = 'pendente', 'p3 continua pendente após status inválido');
end $$;

-- -----------------------------------------------------------------------------
-- 7) Proposta inexistente → 22023.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_owner');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg'), 'nao_existe', 'confirmada'),
    '22023', null, 'proposta inexistente deve ser recusada'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 8) Mensagem que não é do assistente → 42501.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_owner');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', tstp.id('msg_user'), 'p3', 'confirmada'),
    '42501', null, 'só mensagem role=assistant pode ser confirmada'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 9) Mensagem inexistente → 42501.
-- -----------------------------------------------------------------------------
do $$
begin
  perform tstp.login('u_owner');
  perform tstp.expect_error_state(
    format('select public.ai_proposal_done(%L, %L, %L)', gen_random_uuid(), 'p1', 'confirmada'),
    '42501', null, 'mensagem inexistente deve ser recusada'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 10) Descartar → status descartada e NÃO cria log.
-- -----------------------------------------------------------------------------
do $$
declare
  v_msg uuid := tstp.id('msg');
begin
  perform tstp.login('u_owner');
  perform public.ai_proposal_done(v_msg, 'p2', 'descartada');

  perform tstp.ok(tstp.proposal_status(v_msg, 'p2') = 'descartada', 'p2 deve ficar descartada');
  perform tstp.ok(
    not exists (
      select 1 from public.activity_logs
      where entity_id = v_msg and action = 'ai_confirmed' and changes->>'proposal_id' = 'p2'
    ),
    'descartar não cria log ai_confirmed'
  );
end $$;

-- -----------------------------------------------------------------------------
-- 11) p_entity opcional: quando informado, vira entity_id do log.
-- -----------------------------------------------------------------------------
do $$
declare
  v_msg    uuid := tstp.id('msg');
  v_entity uuid := '00000000-0000-4000-9000-00000000beef';
  v_org    uuid := tstp.id('org_a');
begin
  perform tstp.login('u_owner');
  perform public.ai_proposal_done(v_msg, 'p3', 'confirmada', v_entity);

  perform tstp.ok(tstp.proposal_status(v_msg, 'p3') = 'confirmada', 'p3 deve ficar confirmada');

  perform tstp.ok(
    exists (
      select 1 from public.activity_logs
      where organization_id = v_org
        and actor_id = tstp.id('u_owner')
        and entity_type = 'ai_proposals'
        and entity_id = v_entity
        and action = 'ai_confirmed'
        and changes = jsonb_build_object('kind', 'mover_etapa', 'proposal_id', 'p3')
    ),
    'p_entity informado deve ser o entity_id do log'
  );

  -- Ao final: p1 e p3 confirmadas geraram 2 logs; p2 descartada não gerou nenhum.
  perform tstp.ok(
    (select count(*) from public.activity_logs
      where entity_id in (v_msg, v_entity) and action = 'ai_confirmed') = 2,
    'exatamente 2 logs ai_confirmed (p1 e p3)'
  );
end $$;

rollback;
\echo '✔ ai_proposals_test: ok'
