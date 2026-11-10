-- =============================================================================
-- JurisFlow AI — Ambiente LOCAL de demonstração (gerado; não usar em produção)
-- Cria o usuário demo@jurisflow.local / Demo@2026, o escritório
-- "Escritório Demonstração" e carrega os dados fictícios. Idempotente.
-- =============================================================================
\set ON_ERROR_STOP on

do $demo$
declare
  v_uid uuid;
  v_org uuid;
begin
  select id into v_uid from auth.users where email = 'demo@jurisflow.local';
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'demo@jurisflow.local', extensions.crypt('Demo@2026', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Dra. Demonstração"}'::jsonb, now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', 'demo@jurisflow.local', 'email_verified', true),
            'email', now(), now(), now());
  end if;

  select id into v_org from public.organizations where name = 'Escritório Demonstração' limit 1;
  if v_org is null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    v_org := public.create_organization('Escritório Demonstração');
    perform set_config('request.jwt.claims', '{}', true);
  end if;
end $demo$;

select set_config('request.jwt.claims', '{}', false) \g /dev/null

-- Carrega os dados fictícios só uma vez
select not exists (
  select 1 from public.clients c join public.organizations o on o.id = c.organization_id
   where o.name = 'Escritório Demonstração'
) as precisa_seed \gset
\if :precisa_seed
-- =============================================================================
-- JurisFlow AI — Dados FICTÍCIOS para AMBIENTE DE DEMONSTRAÇÃO
-- =============================================================================
-- NUNCA execute em um escritório real. Todos os dados abaixo são inventados e
-- identificados como demonstração ("Cliente Demonstração 01", e-mails
-- @exemplo.invalid, telefones (11) 90000-00NN, CPFs gerados por algoritmo).
--
-- Como usar (SQL Editor do Supabase ou psql, como superusuário/service role):
--   1. Crie uma conta e um escritório pela própria aplicação (o usuário vira admin).
--      Opcional: convide outros membros, para que as demandas/tarefas sejam
--      distribuídas entre responsáveis diferentes.
--   2. Copie o id do escritório:  select id, name from public.organizations;
--   3. Troque o valor de v_org no bloco abaixo e execute o script inteiro.
--
-- O script:
--   * marca organizations.is_demo = true (a interface exibe o selo "Demonstração");
--   * cria ~25 clientes, ~40 demandas (categorias/etapas variadas, últimos 6 meses,
--     algumas paradas há mais de 15 dias), ~60 tarefas (vencidas, hoje, futuras,
--     concluídas) e 12 contratos com parcelas e pagamentos;
--   * recusa rodar se o escritório já tiver clientes reais (proteção), a menos que
--     v_force = true;
--   * com v_reset = true, apaga antes os dados de demonstração criados por ele.
-- =============================================================================

do $$
declare
  -- >>>>>>>>>>>>>>>>>>>>>>>> CONFIGURE AQUI <<<<<<<<<<<<<<<<<<<<<<<<
  v_org    uuid    := (select id from public.organizations where name = 'Escritório Demonstração' order by created_at limit 1);
  v_reset  boolean := false;  -- true: remove dados de demonstração anteriores antes de recriar
  v_force  boolean := false;  -- true: permite rodar mesmo havendo clientes não fictícios
  -- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  c_prefix  constant text := 'Cliente Demonstração ';
  v_members uuid[];
  v_admin   uuid;
  v_cats    uuid[];
  v_clients uuid[] := '{}';
  v_demands uuid[] := '{}';
  v_stages  uuid[];
  v_final   boolean;
  v_id      uuid;
  v_cat     uuid;
  v_cat_name text;
  v_stage   uuid;
  v_opened  date;
  v_changed timestamptz;
  v_status  public.demand_status;
  v_due     date;
  v_task_status public.task_status;
  v_con     uuid;
  v_total   numeric;
  v_n       int;
  inst      record;
  i int; j int; k int;
  -- CPF
  v_base    text;
  v_sum     int;
  v_d1      int;
  v_d2      int;
  v_cpf     text;

  v_first_names text[] := array['Ana','Bruno','Carla','Diego','Elaine','Fábio','Gabriela','Henrique','Isabela','João',
                                'Karina','Lucas','Mariana','Nelson','Olívia','Paulo','Quésia','Rafael','Sabrina','Tiago',
                                'Úrsula','Vanessa','Wagner','Ximena','Yara'];
  v_task_titles text[] := array['Solicitar documentos pessoais','Conferir CNIS do cliente','Agendar atendimento de retorno',
                                'Protocolar requerimento no INSS','Ligar para o cliente (atualização)','Revisar petição inicial',
                                'Conferir certidão de nascimento','Preparar procuração e contrato','Acompanhar andamento do processo',
                                'Enviar lembrete de documentos pendentes','Organizar documentos recebidos','Verificar agendamento de perícia'];
  v_priorities public.priority_level[] := array['media','alta','baixa','urgente','media','alta']::public.priority_level[];
  v_methods public.payment_method[] := array['pix','boleto','transferencia','pix','dinheiro','cartao']::public.payment_method[];
begin
  -- datas relativas ("hoje", vencidas) calculadas no fuso do escritório
  perform set_config('timezone', 'America/Sao_Paulo', true);
  if v_org = '00000000-0000-0000-0000-000000000000' then
    raise exception 'Configure v_org com o id do escritório de demonstração antes de executar.';
  end if;
  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'Escritório % não encontrado.', v_org;
  end if;

  select array_agg(user_id order by (role = 'admin') desc, created_at) into v_members
    from public.organization_members where organization_id = v_org and active;
  if v_members is null then
    raise exception 'O escritório não tem membros ativos. Crie-o pela aplicação antes de rodar o seed.';
  end if;
  select user_id into v_admin from public.organization_members
   where organization_id = v_org and active and role = 'admin' order by created_at limit 1;
  v_admin := coalesce(v_admin, v_members[1]);

  -- Proteção: não misturar dados fictícios com dados reais
  if not v_force and exists (
      select 1 from public.clients
       where organization_id = v_org and anonymized_at is null and full_name not like c_prefix || '%') then
    raise exception 'O escritório possui clientes que não são de demonstração. Use um escritório exclusivo para demonstração (ou v_force = true).';
  end if;

  if v_reset then
    delete from public.contracts where organization_id = v_org
       and client_id in (select id from public.clients where organization_id = v_org and full_name like c_prefix || '%');
    delete from public.tasks where organization_id = v_org
       and (client_id in (select id from public.clients where organization_id = v_org and full_name like c_prefix || '%')
            or description like '[Demonstração]%');
    delete from public.demands where organization_id = v_org
       and client_id in (select id from public.clients where organization_id = v_org and full_name like c_prefix || '%');
    delete from public.clients where organization_id = v_org and full_name like c_prefix || '%';
  elsif exists (select 1 from public.clients where organization_id = v_org and full_name like c_prefix || '%') then
    raise exception 'Já existem dados de demonstração neste escritório. Use v_reset = true para recriá-los.';
  end if;

  update public.organizations set is_demo = true where id = v_org;

  -- Fluxos padrão (caso o escritório não os tenha)
  if not exists (select 1 from public.demand_categories where organization_id = v_org) then
    perform public.seed_default_workflows(v_org);
  end if;
  select array_agg(c.id order by c.sort_order, c.name) into v_cats
    from public.demand_categories c
   where c.organization_id = v_org and c.active
     and exists (select 1 from public.workflow_stages s where s.category_id = c.id);

  -- ---------------------------------------------------------------------------
  -- 25 clientes
  -- ---------------------------------------------------------------------------
  for i in 1..25 loop
    -- CPF válido gerado a partir de uma base fictícia de 9 dígitos
    v_base := lpad(((123456789 + i * 7654321) % 1000000000)::text, 9, '0');
    v_sum := 0;
    for j in 1..9 loop v_sum := v_sum + substr(v_base, j, 1)::int * (11 - j); end loop;
    v_d1 := (v_sum * 10) % 11; if v_d1 = 10 then v_d1 := 0; end if;
    v_sum := 0;
    for j in 1..9 loop v_sum := v_sum + substr(v_base, j, 1)::int * (12 - j); end loop;
    v_sum := v_sum + v_d1 * 2;
    v_d2 := (v_sum * 10) % 11; if v_d2 = 10 then v_d2 := 0; end if;
    v_cpf := v_base || v_d1 || v_d2;

    insert into public.clients (organization_id, full_name, cpf, phone, email, birth_date, address, notes, status, created_by, created_at)
    values (
      v_org,
      c_prefix || lpad(i::text, 2, '0') || ' (' || v_first_names[i] || ')',
      v_cpf,
      '119000000' || lpad(i::text, 2, '0'),
      'demo' || lpad(i::text, 2, '0') || '@exemplo.invalid',
      date '1970-01-15' + (i * 397),
      'Endereço fictício, ' || (100 + i) || ' — Cidade Demonstração',
      'Cadastro fictício para demonstração do sistema.',
      (case when i % 11 = 0 then 'prospecto' when i % 9 = 0 then 'inativo' else 'ativo' end)::public.client_status,
      v_admin,
      now() - make_interval(days => (i * 7) % 180)
    )
    returning id into v_id;
    v_clients := v_clients || v_id;
  end loop;

  -- ---------------------------------------------------------------------------
  -- 40 demandas em categorias/etapas variadas
  -- ---------------------------------------------------------------------------
  for i in 1..40 loop
    v_cat := v_cats[((i - 1) % array_length(v_cats, 1)) + 1];
    select name into v_cat_name from public.demand_categories where id = v_cat;
    select array_agg(id order by position) into v_stages from public.workflow_stages where category_id = v_cat;
    v_stage := case when i % 8 = 0 then v_stages[array_length(v_stages, 1)]           -- algumas concluídas
                    else v_stages[((i * 3) % array_length(v_stages, 1)) + 1] end;
    select is_final into v_final from public.workflow_stages where id = v_stage;

    v_opened := current_date - ((i * 4) % 175 + 3);
    -- 1 a cada 5 está parada há mais de 15 dias; demais mudaram de etapa recentemente
    if i % 5 = 0 then
      v_changed := greatest(v_opened::timestamptz, now() - make_interval(days => 16 + (i % 30)));
      if v_changed > now() - interval '16 days' then v_changed := now() - interval '16 days'; end if;
    else
      v_changed := greatest(v_opened::timestamptz, now() - make_interval(days => 1 + (i % 12)));
    end if;
    v_status := case
      when v_final then 'concluida'
      when i % 17 = 0 then 'cancelada'
      when i % 7 = 0 then 'aguardando_cliente'
      when i % 19 = 0 then 'suspensa'
      else 'em_andamento' end;

    insert into public.demands (organization_id, client_id, category_id, stage_id, title, description, responsible_id,
                                opened_at, priority, status, next_action, next_action_date, closed_at, created_by, created_at)
    values (
      v_org,
      v_clients[((i - 1) % 25) + 1],
      v_cat,
      v_stage,
      v_cat_name || ' — Demonstração ' || lpad(i::text, 2, '0'),
      'Demanda fictícia criada para demonstração.',
      v_members[((i - 1) % array_length(v_members, 1)) + 1],
      v_opened,
      v_priorities[(i % 6) + 1],
      v_status,
      case when v_status in ('concluida', 'cancelada') then null else 'Contatar cliente sobre próximos passos' end,
      case when v_status in ('concluida', 'cancelada') then null else current_date + ((i % 15) - 4) end,
      case when v_status in ('concluida', 'cancelada') then v_changed end,
      v_admin,
      v_opened::timestamptz + interval '9 hours'
    )
    returning id into v_id;
    -- o trigger define stage_changed_at = now() no insert; ajusta para a data fictícia
    update public.demands set stage_changed_at = v_changed where id = v_id;
    v_demands := v_demands || v_id;
  end loop;

  -- ---------------------------------------------------------------------------
  -- 60 tarefas: vencidas, hoje, próximos dias, futuras, concluídas e sem prazo
  -- ---------------------------------------------------------------------------
  for j in 1..60 loop
    v_task_status := 'pendente';
    case j % 6
      when 0 then v_due := current_date - (1 + j % 10);            -- vencida
      when 1 then v_due := current_date;                           -- hoje
      when 2 then v_due := current_date + (1 + j % 7);             -- próximos 7 dias
      when 3 then v_due := current_date + (8 + j % 25);            -- futura
      when 4 then v_due := current_date - (j % 20); v_task_status := 'concluida';
      else        v_due := case when j % 4 = 0 then null else current_date + (j % 40) end;
                  v_task_status := case when j % 3 = 0 then 'em_andamento' else 'pendente' end;
    end case;

    insert into public.tasks (organization_id, title, description, demand_id, assignee_id, due_date, priority, status,
                              completed_at, created_by, created_at)
    values (
      v_org,
      v_task_titles[(j % array_length(v_task_titles, 1)) + 1],
      '[Demonstração] Tarefa fictícia.',
      case when j % 10 = 0 then null else v_demands[((j - 1) % 40) + 1] end,
      v_members[((j - 1) % array_length(v_members, 1)) + 1],
      v_due,
      v_priorities[(j % 6) + 1],
      v_task_status,
      case when v_task_status = 'concluida' then coalesce(v_due, current_date)::timestamptz + interval '15 hours' end,
      v_admin,
      now() - make_interval(days => 3 + j % 40)
    );
  end loop;

  -- ---------------------------------------------------------------------------
  -- 12 contratos com parcelas (geradas pelo banco) e pagamentos
  -- ---------------------------------------------------------------------------
  for k in 1..12 loop
    v_total := 1200 + k * 350;
    v_n := 1 + (k % 6);
    insert into public.contracts (organization_id, client_id, demand_id, contract_type, description, total_amount,
                                  payment_method, installments_count, first_due_date, signed_at, status, created_by)
    values (
      v_org,
      v_clients[k],
      v_demands[k],
      (array['honorarios_fixos','exito','misto','consultoria','honorarios_fixos','outro'])[(k % 6) + 1]::public.contract_type,
      'Contrato fictício de demonstração',
      v_total,
      v_methods[(k % 6) + 1],
      v_n,
      current_date - (k * 14),
      current_date - (k * 14) - 5,
      (case when k = 12 then 'cancelado' else 'ativo' end)::public.contract_status,
      v_admin
    )
    returning id into v_con;

    continue when k = 12;  -- cancelado: sem pagamentos
    for inst in select * from public.installments where contract_id = v_con and due_date <= current_date order by number loop
      if k % 4 = 0 and inst.number = (select max(number) from public.installments where contract_id = v_con and due_date <= current_date) then
        continue;  -- deixa a parcela vencida mais recente em aberto (inadimplência)
      elsif k % 5 = 0 and inst.number = 1 then
        insert into public.payments (organization_id, contract_id, installment_id, amount, paid_at, method, notes, created_by)
        values (v_org, v_con, inst.id, round(inst.amount / 2, 2), least(inst.due_date + 2, current_date),
                v_methods[(k % 6) + 1], 'Pagamento parcial (demonstração)', v_admin);
      else
        insert into public.payments (organization_id, contract_id, installment_id, amount, paid_at, method, notes, created_by)
        values (v_org, v_con, inst.id, inst.amount, least(inst.due_date + (k % 4), current_date),
                v_methods[(k % 6) + 1], 'Pagamento de demonstração', v_admin);
      end if;
    end loop;
  end loop;

  raise notice 'Demonstração criada: % clientes, % demandas, % tarefas, % contratos.',
    (select count(*) from public.clients where organization_id = v_org and full_name like c_prefix || '%'),
    (select count(*) from public.demands where organization_id = v_org and title like '%Demonstração%'),
    (select count(*) from public.tasks where organization_id = v_org and description like '[Demonstração]%'),
    (select count(*) from public.contracts where organization_id = v_org and description = 'Contrato fictício de demonstração');
end $$;

\endif
\echo 'Demonstração pronta: demo@jurisflow.local / Demo@2026'
