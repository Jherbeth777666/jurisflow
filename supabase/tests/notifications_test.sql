-- =============================================================================
-- JurisFlow AI — Testes de aceite do lote L7: notificações no app
-- =============================================================================
-- Cobre a migration 20261112000002_notifications.sql descrita no plano L7:
--   * generate_daily_notifications(p_day) cria as notificações certas;
--   * idempotência (rodar duas vezes no mesmo dia não duplica);
--   * quem não tem pendência não recebe;
--   * demandas paradas só para admin e respeitando o limite de 15 dias;
--   * isolamento por usuário e por escritório (RLS);
--   * authenticated não insere, não altera título e não chama o gerador;
--   * mark_notifications_read / mark_all_notifications_read só mexem nas
--     notificações do próprio usuário;
--   * o texto não contém nome de cliente (só contagens);
--   * retenção de lidas > 60 dias e não lidas > 120 dias.
-- Roda em transação desfeita no final (não deixa lixo).
-- Qualquer falha → raise exception 'FALHOU: ...' → psql para (ON_ERROR_STOP).
-- =============================================================================

\set ON_ERROR_STOP 1
set client_min_messages = warning;

begin;
-- "Hoje" do escritório = data em São Paulo (a função usa esse fuso).
set local timezone = 'America/Sao_Paulo';

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

grant usage on schema tsta to authenticated;
grant execute on all functions in schema tsta to authenticated;
grant usage, select on sequence tsta.passed to authenticated;

-- -----------------------------------------------------------------------------
-- Fixtures: 3 escritórios e membros ativos/inativo.
--
-- Contas feitas à mão (dia de referência = current_date):
--   Org A
--     Admin A: 3 tarefas atrasadas (D-1, D-5, D-10)
--              2 prazos hoje (D)
--              1 próxima ação vencida (D-2)
--              3 demandas paradas abertas (D-20, D-16, D-15)
--              1 demanda parada recente (D-10) NÃO conta
--              1 demanda parada concluída (D-40) NÃO conta
--              → 5 notificações: 3 categorias + demandas_paradas + resumo
--     Adv A:   1 tarefa atrasada (D-2)
--              0 prazos hoje
--              2 próximas ações vencidas (D-1, D-3)
--              1 com D (hoje) não vencida; 1 concluída vencida NÃO conta
--              → 3 notificações: tarefas + próximas ações + resumo
--     Sem A:   0 pendências → 0 notificações
--     Inativo A: 1 tarefa atrasada, mas membro inativo → 0 notificações
--   Org B
--     Admin B: 1 tarefa atrasada (D-1)
--              1 demanda parada com 14 dias → NÃO conta (limite é ≥ 15)
--              → 2 notificações: tarefas + resumo
--   Org C
--     Admin C: 1 demanda parada com exatamente 15 dias → conta
--              → 2 notificações: demandas_paradas + resumo
-- -----------------------------------------------------------------------------
do $$
begin
  perform tsta.set_id('u_admin',    '00000000-0000-4000-a000-00000000e001');
  perform tsta.set_id('u_adv',      '00000000-0000-4000-a000-00000000e002');
  perform tsta.set_id('u_sem',      '00000000-0000-4000-a000-00000000e003');
  perform tsta.set_id('u_inactive', '00000000-0000-4000-a000-00000000e004');
  perform tsta.set_id('u_admin_b',  '00000000-0000-4000-a000-00000000e005');
  perform tsta.set_id('u_admin_c',  '00000000-0000-4000-a000-00000000e006');
  insert into auth.users (id, email, raw_user_meta_data) values
    (tsta.id('u_admin'),    'l7.admin@teste.local',    '{"full_name":"Admin L7"}'),
    (tsta.id('u_adv'),      'l7.adv@teste.local',      '{"full_name":"Adv L7"}'),
    (tsta.id('u_sem'),      'l7.sem@teste.local',      '{"full_name":"Sem Pendencia L7"}'),
    (tsta.id('u_inactive'), 'l7.inactive@teste.local', '{"full_name":"Inativo L7"}'),
    (tsta.id('u_admin_b'),  'l7.admin.b@teste.local',  '{"full_name":"Admin B L7"}'),
    (tsta.id('u_admin_c'),  'l7.admin.c@teste.local',  '{"full_name":"Admin C L7"}');

  -- Org A: admin cria; demais membros entram direto na tabela.
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin'))::text, true);
  perform tsta.set_id('org_a', public.create_organization('Escritório L7 A'));
  insert into organization_members (organization_id, user_id, role) values
    (tsta.id('org_a'), tsta.id('u_adv'), 'advogado'),
    (tsta.id('org_a'), tsta.id('u_sem'), 'advogado');
  insert into organization_members (organization_id, user_id, role, active) values
    (tsta.id('org_a'), tsta.id('u_inactive'), 'assistente', false);

  -- Org B: admin B cria.
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_b'))::text, true);
  perform tsta.set_id('org_b', public.create_organization('Escritório L7 B'));

  -- Org C: admin C cria.
  perform set_config('request.jwt.claims', json_build_object('sub', tsta.id('u_admin_c'))::text, true);
  perform tsta.set_id('org_c', public.create_organization('Escritório L7 C'));

  perform set_config('request.jwt.claims', '{}', true);
end $$;

do $$
declare
  o_a uuid := tsta.id('org_a');
  o_b uuid := tsta.id('org_b');
  o_c uuid := tsta.id('org_c');
  cat uuid;
  stage uuid;
  cli uuid;
  d uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Org A — categoria/etapa, cliente e tarefas
  -- ---------------------------------------------------------------------------
  select ws.category_id, ws.id into cat, stage
    from workflow_stages ws where ws.organization_id = o_a
   order by ws.position limit 1;

  insert into clients (organization_id, full_name)
  values (o_a, 'Cliente Secreto L7') returning id into cli;

  insert into tasks (organization_id, assignee_id, title, due_date, status) values
    (o_a, tsta.id('u_admin'), 'L7 admin atrasada D-1',  current_date - 1,  'pendente'),
    (o_a, tsta.id('u_admin'), 'L7 admin atrasada D-5',  current_date - 5,  'em_andamento'),
    (o_a, tsta.id('u_admin'), 'L7 admin atrasada D-10', current_date - 10, 'pendente'),
    (o_a, tsta.id('u_admin'), 'L7 admin hoje 1',        current_date,      'pendente'),
    (o_a, tsta.id('u_admin'), 'L7 admin hoje 2',        current_date,      'em_andamento'),
    (o_a, tsta.id('u_admin'), 'L7 admin futura',        current_date + 1,  'pendente'),
    (o_a, tsta.id('u_admin'), 'L7 admin concluida',     current_date - 2,  'concluida'),
    (o_a, tsta.id('u_adv'),   'L7 adv atrasada D-2',    current_date - 2,  'pendente'),
    (o_a, tsta.id('u_adv'),   'L7 adv concluida hoje',  current_date,      'concluida'),
    (o_a, tsta.id('u_inactive'), 'L7 inativo atrasada', current_date - 1,  'pendente');

  -- Próximas ações vencidas (strictly < D).
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o_a, cli, cat, stage, 'L7 adv proxima D-1', 'em_andamento',
          tsta.id('u_adv'), current_date - 1)
  returning id into d;
  perform tsta.set_id('d_adv_na_1', d);

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o_a, cli, cat, stage, 'L7 adv proxima D-3', 'em_andamento',
          tsta.id('u_adv'), current_date - 3)
  returning id into d;
  perform tsta.set_id('d_adv_na_2', d);

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o_a, cli, cat, stage, 'L7 adv proxima hoje', 'em_andamento',
          tsta.id('u_adv'), current_date)
  returning id into d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o_a, cli, cat, stage, 'L7 adv proxima concluida', 'concluida',
          tsta.id('u_adv'), current_date - 5)
  returning id into d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id, next_action_date)
  values (o_a, cli, cat, stage, 'L7 admin proxima D-2', 'em_andamento',
          tsta.id('u_admin'), current_date - 2)
  returning id into d;

  -- Demandas paradas da Org A (limite: stage_changed_at há ≥ 15 dias).
  -- Responsável = Adv A de propósito: o alerta de demandas paradas é do
  -- escritório (admin), não de quem é responsável.
  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_a, cli, cat, stage, 'L7 parada D-20', 'em_andamento', tsta.id('u_adv'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 20)::timestamptz where id = d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_a, cli, cat, stage, 'L7 parada D-16', 'em_andamento', tsta.id('u_adv'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 16)::timestamptz where id = d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_a, cli, cat, stage, 'L7 parada D-15', 'em_andamento', tsta.id('u_adv'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 15)::timestamptz where id = d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_a, cli, cat, stage, 'L7 parada recente D-10', 'em_andamento', tsta.id('u_adv'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 10)::timestamptz where id = d;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_a, cli, cat, stage, 'L7 parada concluida D-40', 'concluida', tsta.id('u_adv'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 40)::timestamptz where id = d;

  -- ---------------------------------------------------------------------------
  -- Org B — 1 tarefa atrasada; demanda parada com 14 dias (não conta).
  -- ---------------------------------------------------------------------------
  select ws.category_id, ws.id into cat, stage
    from workflow_stages ws where ws.organization_id = o_b
   order by ws.position limit 1;

  insert into clients (organization_id, full_name)
  values (o_b, 'Cliente B L7') returning id into cli;

  insert into tasks (organization_id, assignee_id, title, due_date, status) values
    (o_b, tsta.id('u_admin_b'), 'L7 B atrasada D-1', current_date - 1, 'pendente');

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_b, cli, cat, stage, 'L7 B parada D-14', 'em_andamento', tsta.id('u_admin_b'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 14)::timestamptz where id = d;

  -- ---------------------------------------------------------------------------
  -- Org C — demanda parada com exatamente 15 dias (deve contar).
  -- ---------------------------------------------------------------------------
  select ws.category_id, ws.id into cat, stage
    from workflow_stages ws where ws.organization_id = o_c
   order by ws.position limit 1;

  insert into clients (organization_id, full_name)
  values (o_c, 'Cliente C L7') returning id into cli;

  insert into demands (organization_id, client_id, category_id, stage_id, title, status,
                       responsible_id)
  values (o_c, cli, cat, stage, 'L7 C parada D-15', 'em_andamento', tsta.id('u_admin_c'))
  returning id into d;
  update demands set stage_changed_at = (current_date - 15)::timestamptz where id = d;
end $$;

-- Gera uma vez, como postgres (função é revogada de authenticated).
do $$ begin
  perform public.generate_daily_notifications(current_date);
end $$;

-- =============================================================================
-- 1. Conteúdo e contagens das notificações (valores calculados à mão acima)
-- =============================================================================
do $$
declare
  v_title text;
  v_body text;
  v_link text;
begin
  perform tsta.login('u_admin');

  -- Admin A: 3 atrasadas + 2 hoje + 1 próxima ação + 1 paradas + 1 resumo = 5.
  perform tsta.eq((select count(*)::int from public.notifications), 5,
                  'Admin A recebe exatamente 5 notificações');

  perform tsta.eq((select count(*)::int from public.notifications where kind = 'tarefas_atrasadas'),
                  1, 'Admin A recebe uma notificação de tarefas atrasadas');
  select title, link into v_title, v_link from public.notifications
   where kind = 'tarefas_atrasadas';
  perform tsta.eq(v_title, '3 tarefas atrasadas', 'título das tarefas atrasadas usa a contagem');
  perform tsta.eq(v_link, '/tarefas', 'link das tarefas atrasadas é /tarefas');

  perform tsta.eq((select count(*)::int from public.notifications where kind = 'prazos_hoje'),
                  1, 'Admin A recebe uma notificação de prazos de hoje');
  select title, link into v_title, v_link from public.notifications
   where kind = 'prazos_hoje';
  perform tsta.eq(v_title, '2 prazos hoje', 'título dos prazos de hoje usa a contagem');
  perform tsta.eq(v_link, '/agenda?v=hoje', 'link dos prazos de hoje');

  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'proximas_acoes_vencidas'),
                  1, 'Admin A recebe uma notificação de próximas ações vencidas');
  perform tsta.eq((select link from public.notifications
                    where kind = 'proximas_acoes_vencidas'),
                  '/agenda?v=atrasados', 'link das próximas ações vencidas');

  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'demandas_paradas'),
                  1, 'Admin A recebe uma notificação de demandas paradas');
  perform tsta.eq((select link from public.notifications
                    where kind = 'demandas_paradas'),
                  '/relatorios', 'link das demandas paradas');

  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'resumo_diario'),
                  1, 'Admin A recebe um resumo diário');
  perform tsta.eq((select link from public.notifications where kind = 'resumo_diario'),
                  '/', 'link do resumo diário');
  select body into v_body from public.notifications where kind = 'resumo_diario';
  perform tsta.ok(v_body like '%2 prazos%', 'resumo traz a contagem de prazos (2)');
  perform tsta.ok(v_body like '%3 tarefas atrasadas%', 'resumo traz a contagem de tarefas atrasadas (3)');
  perform tsta.ok(v_body like '%1 próxim%', 'resumo traz a contagem de próximas ações vencidas (1)');

  -- Só as próprias: nenhuma linha de outro usuário aparece sob RLS.
  perform tsta.ok(
    not exists (select 1 from public.notifications where user_id <> tsta.id('u_admin')),
    'Admin A não enxerga notificações de outros usuários');

  reset role;

  -- Adv A: 1 atrasada + 2 próximas ações + 1 resumo = 3.
  perform tsta.login('u_adv');
  perform tsta.eq((select count(*)::int from public.notifications), 3,
                  'Adv A recebe exatamente 3 notificações');
  perform tsta.eq((select count(*)::int from public.notifications where kind = 'tarefas_atrasadas'),
                  1, 'Adv A recebe notificação de tarefas atrasadas');
  perform tsta.eq((select count(*)::int from public.notifications where kind = 'prazos_hoje'),
                  0, 'Adv A não tem prazos hoje');
  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'proximas_acoes_vencidas'),
                  1, 'Adv A recebe notificação de próximas ações vencidas');
  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'demandas_paradas'),
                  0, 'Adv A (não admin) não recebe demandas paradas');
  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'resumo_diario'),
                  1, 'Adv A recebe resumo diário');
  select body into v_body from public.notifications where kind = 'resumo_diario';
  perform tsta.ok(v_body like '%1 tarefa%', 'resumo do Adv A traz 1 tarefa atrasada');
  perform tsta.ok(v_body like '%2 próxim%', 'resumo do Adv A traz 2 próximas ações vencidas');
  perform tsta.ok(
    not exists (select 1 from public.notifications where user_id <> tsta.id('u_adv')),
    'Adv A só enxerga as próprias notificações');
  reset role;

  -- Sem pendência: nenhuma notificação foi sequer criada.
  perform tsta.eq(
    (select count(*)::int from public.notifications where user_id = tsta.id('u_sem')),
    0, 'membro sem pendência não recebe notificação');

  -- Membro inativo: nenhuma notificação é criada.
  perform tsta.eq(
    (select count(*)::int from public.notifications where user_id = tsta.id('u_inactive')),
    0, 'membro inativo não recebe notificação');

  -- Nome de cliente não aparece no texto.
  perform tsta.ok(
    not exists (select 1 from public.notifications
                 where title ilike '%Cliente Secreto%'
                    or coalesce(body, '') ilike '%Cliente Secreto%'),
    'texto das notificações não contém nome de cliente');

  -- Isolamento entre escritórios.
  perform tsta.login('u_admin_b');
  perform tsta.eq((select count(*)::int from public.notifications), 2,
                  'Admin B recebe 2 notificações (tarefas + resumo)');
  perform tsta.ok(
    not exists (select 1 from public.notifications where organization_id <> tsta.id('org_b')),
    'Admin B não enxerga notificações de outro escritório');
  perform tsta.eq((select count(*)::int from public.notifications
                    where kind = 'demandas_paradas'),
                  0, 'Admin B: demanda parada com 14 dias não conta');
  reset role;

  -- Limite de 15 dias: Org C recebe demandas_paradas.
  perform tsta.eq(
    (select count(*)::int from public.notifications
      where user_id = tsta.id('u_admin_c') and kind = 'demandas_paradas'),
    1, 'demanda parada com exatamente 15 dias conta');
  perform tsta.eq(
    (select count(*)::int from public.notifications where user_id = tsta.id('u_admin_c')),
    2, 'Admin C recebe demandas paradas + resumo');
end $$;

-- =============================================================================
-- 2. Idempotência: rodar o gerador de novo no mesmo dia não duplica
-- =============================================================================
do $$
declare
  v_before int;
  v_after int;
begin
  select count(*)::int into v_before from public.notifications;
  perform public.generate_daily_notifications(current_date);
  select count(*)::int into v_after from public.notifications;
  perform tsta.eq(v_after, v_before, 'rodar o gerador duas vezes no mesmo dia não duplica');
end $$;

-- =============================================================================
-- 3. Retenção: lidas > 60 dias e não lidas > 120 dias são apagadas
-- =============================================================================
savepoint retencao;
do $$
declare
  o uuid := tsta.id('org_a');
  u uuid := tsta.id('u_admin');
begin
  insert into public.notifications
    (organization_id, user_id, kind, title, body, link, ref_date, read_at, created_at)
  values
    (o, u, 'resumo_diario', 'L7 lida antiga 61d',  '', '/', current_date - 10,
     now() - interval '61 days', now() - interval '61 days'),
    (o, u, 'resumo_diario', 'L7 nao lida antiga 121d', '', '/', current_date - 11,
     null, now() - interval '121 days'),
    (o, u, 'resumo_diario', 'L7 lida recente 59d', '', '/', current_date - 12,
     now() - interval '59 days', now() - interval '59 days'),
    (o, u, 'resumo_diario', 'L7 nao lida recente 119d', '', '/', current_date - 13,
     null, now() - interval '119 days');

  perform public.generate_daily_notifications(current_date);

  perform tsta.eq(
    (select count(*)::int from public.notifications
      where title = 'L7 lida antiga 61d'), 0,
    'notificação lida há mais de 60 dias é apagada');
  perform tsta.eq(
    (select count(*)::int from public.notifications
      where title = 'L7 nao lida antiga 121d'), 0,
    'notificação não lida há mais de 120 dias é apagada');
  perform tsta.eq(
    (select count(*)::int from public.notifications
      where title = 'L7 lida recente 59d'), 1,
    'notificação lida há 59 dias é mantida');
  perform tsta.eq(
    (select count(*)::int from public.notifications
      where title = 'L7 nao lida recente 119d'), 1,
    'notificação não lida há 119 dias é mantida');
end $$;
rollback to savepoint retencao;

-- =============================================================================
-- 4. Segurança: authenticated não insere, não altera título nem chama o gerador
-- =============================================================================
do $$
declare
  v_state text;
  v_id uuid;
  v_title text;
begin
  perform tsta.login('u_admin');

  perform tsta.expect_error_state(
    'select public.generate_daily_notifications(current_date)',
    '42501', '', 'authenticated não pode chamar o gerador');

  perform tsta.expect_error_state(
    format('insert into public.notifications (organization_id, user_id, kind, title, link, ref_date) values (%L, %L, %L, %L, %L, current_date)',
           tsta.id('org_a'), tsta.id('u_admin'), 'tarefas_atrasadas', 'inserida à mão', '/tarefas'),
    '42501', '', 'authenticated não pode inserir notificação');

  select id, title into v_id, v_title from public.notifications
   where user_id = tsta.id('u_admin') and kind = 'tarefas_atrasadas';
  begin
    update public.notifications set title = 'TÍTULO ADULTERADO' where id = v_id;
    v_state := null;
  exception when others then
    v_state := sqlstate;
  end;
  perform tsta.ok(
    (select title from public.notifications where id = v_id) = v_title,
    'authenticated não altera o título da notificação (com ou sem erro)');

  reset role;
end $$;

-- =============================================================================
-- 5. Leitura: RPCs marcam só as notificações do próprio usuário
-- =============================================================================
savepoint leitura;
do $$
declare
  v_admin_id uuid;
  v_adv_id uuid;
  v_b_id uuid;
begin
  -- IDs coletados como postgres (RLS não atrapalha).
  select id into v_admin_id from public.notifications
   where user_id = tsta.id('u_admin') and kind = 'tarefas_atrasadas';
  select id into v_adv_id from public.notifications
   where user_id = tsta.id('u_adv') and kind = 'tarefas_atrasadas';
  select id into v_b_id from public.notifications
   where user_id = tsta.id('u_admin_b') and kind = 'tarefas_atrasadas';

  perform tsta.ok(v_admin_id is not null, 'notificação do admin existe para marcar');
  perform tsta.ok(v_adv_id is not null, 'notificação do advogado existe para conferir');

  -- Admin tenta marcar uma própria e uma do advogado.
  perform tsta.login('u_admin');
  perform public.mark_notifications_read(array[v_admin_id, v_adv_id]);
  reset role;

  perform tsta.ok(
    (select read_at is not null from public.notifications where id = v_admin_id),
    'mark_notifications_read marca a notificação do próprio usuário');
  perform tsta.ok(
    (select read_at is null from public.notifications where id = v_adv_id),
    'mark_notifications_read não marca a notificação de outro usuário');

  -- Marcar todas: só as do admin; as do advogado continuam não lidas.
  perform tsta.login('u_admin');
  perform public.mark_all_notifications_read(tsta.id('org_a'));
  reset role;

  perform tsta.ok(
    not exists (select 1 from public.notifications
                 where user_id = tsta.id('u_admin') and read_at is null),
    'mark_all_notifications_read marca todas as do próprio usuário');
  perform tsta.ok(
    (select read_at is null from public.notifications where id = v_adv_id),
    'mark_all_notifications_read não marca notificações de outro usuário');

  -- Admin A não consegue marcar as notificações de outro escritório.
  perform tsta.login('u_admin');
  begin
    perform public.mark_all_notifications_read(tsta.id('org_b'));
  exception when others then
    null;
  end;
  reset role;
  perform tsta.ok(
    (select read_at is null from public.notifications where id = v_b_id),
    'mark_all_notifications_read não alcança outro escritório');
end $$;
rollback to savepoint leitura;

reset role;
do $$ begin
  raise warning 'notifications_test.sql: % verificações do lote L7 OK', (select last_value from tsta.passed);
end $$;
rollback;
