-- =============================================================================
-- JurisFlow AI — Migration 010: endurecimento de segurança (auditoria red team)
-- Não altera as migrations anteriores. Itens:
--   1/2. Grants explícitos (o Supabase dá ALL a anon/authenticated por default
--        privileges — as migrations antigas só revogavam de PUBLIC).
--   3.   anonymize_client: limites de palavra, sem acento, CPF em qualquer
--        formato, mais tabelas, IA só nas conversas que citam o cliente.
--   4.   Convites com consentimento (RPCs explícitas, expiração, recusa) e
--        saída voluntária do escritório.
--   5.   payments_audit também em UPDATE.
--   6.   log_export: clamp, rate limit e entity_id validado.
--   7.   created_at imutável; stage_changed_at/closed_at/completed_at só pelo banco.
--   8.   Pagamento não excede saldo do contrato/parcela; nada em contrato rascunho.
--   9.   ai_consume_quota: teto fixo no servidor, teto mensal por escritório,
--        retenção de 35 dias.
--  10.   create_organization: lock por usuário antes de contar.
--   B.   Coerência status × etapa final em demandas.
--   D.   dashboard_metrics com intervalos e installment_overview calculada 1x.
-- =============================================================================

-- =============================================================================
-- Helpers internos de anonimização (sem EXECUTE para authenticated)
-- =============================================================================

-- Regex de um nome: insensível a maiúsculas/acentos, espaços flexíveis e com
-- limites de palavra (equivalente a \m...\M, mas que também trata letras
-- acentuadas como parte da palavra — \m/\M no locale C só conhecem ASCII).
create or replace function public.anon_name_regex(p_name text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v        text;
  r        text := '';
  ch       text;
  i        int;
  in_space boolean := false;
  w        constant text := '[0-9A-Za-z_À-ÖØ-öø-ÿ]';
begin
  v := translate(lower(btrim(coalesce(p_name, ''))),
                 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn');
  if v = '' then return null; end if;
  for i in 1..char_length(v) loop
    ch := substr(v, i, 1);
    if ch ~ '\s' then
      if not in_space then r := r || '\s+'; end if;
      in_space := true;
      continue;
    end if;
    in_space := false;
    r := r || case ch
      when 'a' then '[aáàâãäAÁÀÂÃÄ]'
      when 'e' then '[eéèêëEÉÈÊË]'
      when 'i' then '[iíìîïIÍÌÎÏ]'
      when 'o' then '[oóòôõöOÓÒÔÕÖ]'
      when 'u' then '[uúùûüUÚÙÛÜ]'
      when 'c' then '[cçCÇ]'
      when 'n' then '[nñNÑ]'
      else case
        when ch ~ '^[a-z]$' then '[' || ch || upper(ch) || ']'
        when ch ~ '^[0-9]$' then ch
        when ascii(ch) between 33 and 126 then '\' || ch      -- pontuação ASCII escapada
        else '[' || ch || ']'                                 -- outro caractere: literal
      end
    end;
  end loop;
  return '(?<!' || w || ')' || r || '(?!' || w || ')';
end $$;

-- Regex do CPF (11 dígitos) com pontuação opcional: 12345678909, 123.456.789-09 ...
create or replace function public.anon_cpf_regex(p_cpf text)
returns text language sql immutable set search_path = public as $$
  select case when p_cpf ~ '^[0-9]{11}$' then
    '(?<![0-9])' || substr(p_cpf, 1, 3) || '[-. ]?' || substr(p_cpf, 4, 3) || '[-. ]?'
                 || substr(p_cpf, 7, 3) || '[-. /]?' || substr(p_cpf, 10, 2) || '(?![0-9])'
  end;
$$;

create or replace function public.anon_scrub(p_text text, p_full text, p_cpf text, p_first text)
returns text language plpgsql immutable set search_path = public as $$
begin
  if p_text is null then return null; end if;
  if p_full is not null then p_text := regexp_replace(p_text, p_full, 'Cliente anonimizado', 'g'); end if;
  if p_cpf is not null then p_text := regexp_replace(p_text, p_cpf, '[CPF removido]', 'g'); end if;
  if p_first is not null then p_text := regexp_replace(p_text, p_first, 'Cliente', 'g'); end if;
  return p_text;
end $$;

-- =============================================================================
-- 3. anonymize_client
-- =============================================================================
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_name   text;
  v_cpf    text;
  v_first  text;
  re_full  text;
  re_cpf   text;
  re_first text;
  v_convs  uuid[];
  it       record;
  v_label  text;
begin
  select organization_id, full_name, cpf into v_org, v_name, v_cpf from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  re_full := public.anon_name_regex(v_name);
  re_cpf  := public.anon_cpf_regex(v_cpf);
  v_first := split_part(regexp_replace(btrim(v_name), '\s+', ' ', 'g'), ' ', 1);
  -- primeiro nome só se tiver ≥ 3 letras e for diferente do nome completo
  if char_length(regexp_replace(v_first, '[^A-Za-zÀ-ÖØ-öø-ÿ]', '', 'g')) >= 3
     and v_first <> regexp_replace(btrim(v_name), '\s+', ' ', 'g') then
    re_first := public.anon_name_regex(v_first);
  end if;

  -- Demandas do cliente
  update public.demands d
     set title       = left(public.anon_scrub(d.title, re_full, re_cpf, re_first), 160),
         description = left(public.anon_scrub(d.description, re_full, re_cpf, re_first), 4000),
         notes       = left(public.anon_scrub(d.notes, re_full, re_cpf, re_first), 4000),
         next_action = left(public.anon_scrub(d.next_action, re_full, re_cpf, re_first), 300)
   where d.client_id = p_client
     and (d.title, d.description, d.notes, d.next_action) is distinct from
         (left(public.anon_scrub(d.title, re_full, re_cpf, re_first), 160),
          left(public.anon_scrub(d.description, re_full, re_cpf, re_first), 4000),
          left(public.anon_scrub(d.notes, re_full, re_cpf, re_first), 4000),
          left(public.anon_scrub(d.next_action, re_full, re_cpf, re_first), 300));

  -- Tarefas do cliente ou das demandas dele
  update public.tasks t
     set title       = left(public.anon_scrub(t.title, re_full, re_cpf, re_first), 160),
         description = left(public.anon_scrub(t.description, re_full, re_cpf, re_first), 4000)
   where (t.client_id = p_client
          or t.demand_id in (select d.id from public.demands d where d.client_id = p_client))
     and (t.title, t.description) is distinct from
         (left(public.anon_scrub(t.title, re_full, re_cpf, re_first), 160),
          left(public.anon_scrub(t.description, re_full, re_cpf, re_first), 4000));

  -- Contratos e pagamentos
  update public.contracts c
     set description = left(public.anon_scrub(c.description, re_full, re_cpf, re_first), 1000),
         notes       = left(public.anon_scrub(c.notes, re_full, re_cpf, re_first), 2000)
   where c.client_id = p_client
     and (c.description, c.notes) is distinct from
         (left(public.anon_scrub(c.description, re_full, re_cpf, re_first), 1000),
          left(public.anon_scrub(c.notes, re_full, re_cpf, re_first), 2000));

  update public.payments p
     set notes = left(public.anon_scrub(p.notes, re_full, re_cpf, re_first), 500)
   where p.contract_id in (select c.id from public.contracts c where c.client_id = p_client)
     and p.notes is distinct from left(public.anon_scrub(p.notes, re_full, re_cpf, re_first), 500);

  -- Checklist (rótulo é único por demanda: em colisão, sufixo neutro)
  for it in
    select i.id, i.label from public.demand_checklist_items i
     where i.demand_id in (select d.id from public.demands d where d.client_id = p_client)
  loop
    v_label := left(public.anon_scrub(it.label, re_full, re_cpf, re_first), 160);
    continue when v_label = it.label;
    begin
      update public.demand_checklist_items set label = v_label where id = it.id;
    exception when unique_violation then
      update public.demand_checklist_items
         set label = left(v_label, 150) || ' #' || left(it.id::text, 6) where id = it.id;
    end;
  end loop;

  -- Assistente de IA: SOMENTE conversas do escritório que citam o cliente
  -- (nome completo ou CPF) — não varre o histórico do escritório inteiro.
  select coalesce(array_agg(c.id), '{}') into v_convs
    from public.ai_conversations c
   where c.organization_id = v_org
     and (c.title ~ re_full
          or (re_cpf is not null and c.title ~ re_cpf)
          or exists (select 1 from public.ai_messages m
                      where m.conversation_id = c.id
                        and (m.content ~ re_full or (re_cpf is not null and m.content ~ re_cpf))));
  if cardinality(v_convs) > 0 then
    update public.ai_conversations c
       set title = left(public.anon_scrub(c.title, re_full, re_cpf, re_first), 120)
     where c.id = any(v_convs)
       and c.title is distinct from left(public.anon_scrub(c.title, re_full, re_cpf, re_first), 120);
    update public.ai_messages m
       set content = left(public.anon_scrub(m.content, re_full, re_cpf, re_first), 20000)
     where m.conversation_id = any(v_convs)
       and m.content is distinct from left(public.anon_scrub(m.content, re_full, re_cpf, re_first), 20000);
  end if;

  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;

  -- Histórico: valores de título (from/to) das demandas/tarefas do cliente e de
  -- QUALQUER log do escritório que contenha o nome (cobre entidades excluídas).
  update public.activity_logs l
     set changes = l.changes || jsonb_build_object('title', jsonb_build_object('changed', true))
   where l.organization_id = v_org
     and l.changes ? 'title'
     and l.changes->'title' <> '{"changed": true}'::jsonb
     and (
       l.changes::text ~ re_full
       or (l.entity_type = 'demands' and l.entity_id in (select d.id from public.demands d where d.client_id = p_client))
       or (l.entity_type = 'tasks' and l.entity_id in (
             select t.id from public.tasks t
              where t.client_id = p_client
                 or t.demand_id in (select d.id from public.demands d where d.client_id = p_client)))
     );
end $$;

-- =============================================================================
-- 4. Convites com consentimento
-- =============================================================================
alter table public.organization_invitations
  add column if not exists expires_at  timestamptz not null default (now() + interval '14 days'),
  add column if not exists declined_at timestamptz;

drop index if exists public.organization_invitations_pending_uidx;
create unique index organization_invitations_pending_uidx
  on public.organization_invitations(organization_id, email)
  where accepted_at is null and declined_at is null;

-- accepted_at/declined_at só pelas RPCs; validade entre agora e 30 dias.
create or replace function public.invitations_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.accepted_at := null;
      new.declined_at := null;
    end if;
    new.expires_at := coalesce(new.expires_at, now() + interval '14 days');
  elsif current_user in ('authenticated', 'anon') then
    new.accepted_at := old.accepted_at;
    new.declined_at := old.declined_at;
  end if;
  if new.expires_at > now() + interval '30 days' then
    new.expires_at := now() + interval '30 days';
  end if;
  return new;
end $$;

drop trigger if exists organization_invitations_before_write on public.organization_invitations;
create trigger organization_invitations_before_write
  before insert or update on public.organization_invitations
  for each row execute function public.invitations_before_write();

-- Convites pendentes do e-mail CONFIRMADO do usuário.
create or replace function public.my_pending_invitations()
returns table (
  id                uuid,
  organization_id   uuid,
  organization_name text,
  role              public.member_role,
  invited_by_name   text,
  created_at        timestamptz,
  expires_at        timestamptz
)
language sql stable security definer set search_path = public as $$
  select i.id, i.organization_id, o.name, i.role,
         coalesce(nullif(btrim(p.full_name), ''), 'Administrador do escritório'),
         i.created_at, i.expires_at
    from auth.users u
    join public.organization_invitations i on i.email = u.email::citext
    join public.organizations o on o.id = i.organization_id
    left join public.profiles p on p.id = i.invited_by
   where u.id = auth.uid()
     and u.email_confirmed_at is not null
     and i.accepted_at is null
     and i.declined_at is null
     and i.expires_at > now()
     and not exists (select 1 from public.organization_members m
                      where m.organization_id = i.organization_id and m.user_id = u.id and m.active)
   order by i.created_at desc;
$$;

create or replace function public.accept_invitation(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email citext;
  inv     public.organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  select * into inv from public.organization_invitations where id = p_id for update;
  if v_email is null or inv.id is null or inv.email <> v_email
     or inv.accepted_at is not null or inv.declined_at is not null or inv.expires_at <= now() then
    raise exception 'Convite não encontrado, expirado ou já respondido.' using errcode = 'P0002';
  end if;
  -- membro ativo mantém o papel; membro desativado recebe o papel do convite (005)
  insert into public.organization_members as m (organization_id, user_id, role)
  values (inv.organization_id, auth.uid(), inv.role)
  on conflict (organization_id, user_id) do update
    set active = true,
        role = case when m.active then m.role else excluded.role end;
  update public.organization_invitations set accepted_at = now() where id = inv.id;
  return inv.organization_id;
end $$;

create or replace function public.decline_invitation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email citext;
  inv     public.organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  select * into inv from public.organization_invitations where id = p_id for update;
  if v_email is null or inv.id is null or inv.email <> v_email
     or inv.accepted_at is not null or inv.declined_at is not null then
    raise exception 'Convite não encontrado ou já respondido.' using errcode = 'P0002';
  end if;
  update public.organization_invitations set declined_at = now() where id = inv.id;
end $$;

-- Não aceita mais nada automaticamente (mantida para não quebrar o app antigo).
create or replace function public.accept_pending_invitations()
returns int language sql stable security definer set search_path = public as $$
  select 0;
$$;

-- Saída voluntária do escritório (o trigger protect_last_admin continua valendo).
create or replace function public.leave_organization(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  delete from public.organization_members where organization_id = p_org and user_id = auth.uid();
  if not found then
    raise exception 'Você não é membro deste escritório.' using errcode = '42501';
  end if;
end $$;

-- =============================================================================
-- 5. payments_audit também em UPDATE
-- =============================================================================
drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.log_activity('amount', 'paid_at', 'installment_id', 'method');

-- =============================================================================
-- 6. log_export
-- =============================================================================
create index if not exists activity_logs_exports_actor_idx
  on public.activity_logs(actor_id, created_at desc) where entity_type = 'exports';

create or replace function public.log_export(
  p_org uuid, p_resource text, p_row_count int, p_sensitive boolean default false, p_entity uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_entity uuid := p_org;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_resource is null or p_resource !~ '^[a-z_]{2,40}$' then
    raise exception 'Recurso inválido' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jurisflow.export:' || auth.uid()::text, 0));
  if (select count(*) from public.activity_logs
       where actor_id = auth.uid() and entity_type = 'exports'
         and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Limite de exportações por hora atingido. Tente novamente mais tarde.' using errcode = 'P0001';
  end if;
  -- entity_id só é aceito se pertencer ao escritório; senão, registra o escritório
  if p_entity is not null and (
       exists (select 1 from public.clients   where id = p_entity and organization_id = p_org)
    or exists (select 1 from public.demands   where id = p_entity and organization_id = p_org)
    or exists (select 1 from public.tasks     where id = p_entity and organization_id = p_org)
    or exists (select 1 from public.contracts where id = p_entity and organization_id = p_org)
    or exists (select 1 from public.demand_categories where id = p_entity and organization_id = p_org)) then
    v_entity := p_entity;
  end if;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values (p_org, auth.uid(), 'exports', v_entity, 'exported',
          jsonb_build_object('resource', p_resource,
                             'rows', least(greatest(coalesce(p_row_count, 0), 0), 1000000),
                             'sensitive', coalesce(p_sensitive, false)));
end $$;

-- =============================================================================
-- 7. Timestamps de sistema
-- =============================================================================
create or replace function public.preserve_created_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_at := old.created_at;
  return new;
end $$;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'created_at' and tb.table_type = 'BASE TABLE'
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep_created_at', t);
    execute format('create trigger %I before update on public.%I
                    for each row execute function public.preserve_created_at()', t || '_keep_created_at', t);
  end loop;
end $$;

-- Demandas: datas calculadas pelo banco + coerência status × etapa final (B).
-- Papéis da API (authenticated/anon) não definem stage_changed_at/closed_at;
-- papéis privilegiados (migrações, service_role, testes) podem.
create or replace function public.demands_before_write()
returns trigger language plpgsql set search_path = public as $$
declare
  v_api    boolean := current_user in ('authenticated', 'anon');
  v_final  boolean;
  v_pos    int;
  v_target uuid;
begin
  if v_api then
    if tg_op = 'INSERT' then
      new.closed_at := null;
    else
      new.stage_changed_at := old.stage_changed_at;
      new.closed_at := old.closed_at;
    end if;
  end if;

  -- Mudou de categoria sem informar etapa nova → volta para a 1ª etapa da nova categoria
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id
     and new.stage_id is not distinct from old.stage_id then
    new.stage_id := null;
  end if;

  if new.stage_id is null then
    select id into new.stage_id from public.workflow_stages
     where category_id = new.category_id order by position limit 1;
  end if;

  -- B. status alterado sem trocar de etapa → ajusta a etapa
  if (tg_op = 'INSERT' and new.status = 'concluida')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status
         and new.stage_id is not distinct from old.stage_id) then
    select is_final, position into v_final, v_pos from public.workflow_stages where id = new.stage_id;
    v_target := null;
    if coalesce(v_final, false) and new.status not in ('concluida', 'cancelada') then
      select id into v_target from public.workflow_stages
       where category_id = new.category_id and not is_final and position < v_pos
       order by position desc limit 1;
    elsif not coalesce(v_final, false) and new.status = 'concluida' then
      select id into v_target from public.workflow_stages
       where category_id = new.category_id and is_final
       order by position limit 1;
    end if;
    if v_target is not null then
      new.stage_id := v_target;
    end if;
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if tg_op = 'INSERT' and not v_api then
      new.stage_changed_at := coalesce(new.stage_changed_at, now());
    else
      new.stage_changed_at := now();
    end if;
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

create or replace function public.tasks_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.completed_at := null;
    else
      new.completed_at := old.completed_at;
    end if;
  end if;
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

-- =============================================================================
-- 8 + A. Pagamentos: saldo do contrato/parcela e contrato em rascunho
-- =============================================================================
create or replace function public.payments_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status  public.contract_status;
  v_total   numeric;
  v_paid    numeric;
  v_inst    numeric;
begin
  if new.installment_id is not null and not exists (
    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  ) then
    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  end if;

  -- trava o contrato: pagamentos simultâneos não estouram o saldo
  select status, total_amount into v_status, v_total
    from public.contracts where id = new.contract_id for update;
  if v_status = 'cancelado' then
    raise exception 'Não é possível registrar pagamento em contrato cancelado.' using errcode = 'P0001';
  end if;
  if v_status = 'rascunho' then
    raise exception 'Não é possível registrar pagamento em contrato em rascunho. Ative o contrato antes de registrar recebimentos.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT'
     or new.amount is distinct from old.amount
     or new.installment_id is distinct from old.installment_id
     or new.contract_id is distinct from old.contract_id then
    select coalesce(sum(amount), 0) into v_paid
      from public.payments where contract_id = new.contract_id and id <> new.id;
    if v_paid + new.amount > v_total + 0.01 then
      raise exception 'O pagamento excede o saldo do contrato (saldo em aberto: R$ %).',
        translate(to_char(greatest(v_total - v_paid, 0), 'FM999,999,990.00'), ',.', '.,') using errcode = 'P0001';
    end if;
    if new.installment_id is not null then
      select amount into v_inst from public.installments where id = new.installment_id;
      select coalesce(sum(amount), 0) into v_paid
        from public.payments where installment_id = new.installment_id and id <> new.id;
      if v_paid + new.amount > v_inst + 0.01 then
        raise exception 'O pagamento excede o restante da parcela (em aberto: R$ %).',
          translate(to_char(greatest(v_inst - v_paid, 0), 'FM999,999,990.00'), ',.', '.,') using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Contrato com pagamentos não troca de cliente (moveria o histórico financeiro).
create or replace function public.contracts_lock_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is distinct from old.client_id
     and exists (select 1 from public.payments where contract_id = old.id) then
    raise exception 'Não é possível trocar o cliente de um contrato que já possui pagamentos.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists contracts_lock_client on public.contracts;
create trigger contracts_lock_client before update of client_id on public.contracts
  for each row execute function public.contracts_lock_client();

-- =============================================================================
-- 9 + C. ai_consume_quota: teto fixo, teto mensal por escritório, retenção
-- =============================================================================
create index if not exists ai_usage_org_created_idx on public.ai_usage(organization_id, created_at);

drop function if exists public.ai_consume_quota(uuid, text, int);
create or replace function public.ai_consume_quota(
  p_org uuid, p_kind text, p_limit_per_hour int, p_monthly_org_limit int default 3000
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_count   int;
  v_limit   int := least(greatest(coalesce(p_limit_per_hour, 30), 1), 200);       -- teto fixo do servidor
  v_monthly int := least(greatest(coalesce(p_monthly_org_limit, 3000), 1), 20000);
  v_month   timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('assistant', 'import', 'compose') then
    raise exception 'Tipo de uso inválido' using errcode = 'P0001';
  end if;
  -- ordem fixa de locks: escritório → usuário+tipo
  perform pg_advisory_xact_lock(hashtextextended('jurisflow.ai_org:' || p_org::text, 0));
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || p_kind));

  -- retenção barata: só os registros antigos do próprio usuário
  delete from public.ai_usage where user_id = auth.uid() and created_at < now() - interval '35 days';

  select count(*) into v_count from public.ai_usage
   where organization_id = p_org and created_at >= v_month;
  if v_count >= v_monthly then
    return false;
  end if;
  select count(*) into v_count from public.ai_usage
   where user_id = auth.uid() and kind = p_kind and created_at > now() - interval '1 hour';
  if v_count >= v_limit then
    return false;
  end if;
  insert into public.ai_usage (organization_id, user_id, kind) values (p_org, auth.uid(), p_kind);
  return true;
end $$;

-- =============================================================================
-- 10. create_organization com lock por usuário
-- =============================================================================
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jurisflow.create_org:' || auth.uid()::text, 0));
  if (select count(*) from public.organization_members where user_id = auth.uid() and role = 'admin') >= 3 then
    raise exception 'Limite de escritórios por usuário atingido.' using errcode = 'P0001';
  end if;
  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, auth.uid(), 'admin');
  perform public.seed_default_workflows(v_org);
  return v_org;
end $$;

-- =============================================================================
-- D. dashboard_metrics: intervalos (usam índices) e installment_overview 1x.
--    Mesma saída JSON da versão 007.
-- =============================================================================
create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'
as $$
declare
  v jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  with io as materialized (
    select due_date, status, amount, remaining_amount
      from installment_overview where organization_id = p_org
  ),
  months as (
    select m, m + interval '1 month' as m_end
      from generate_series(date_trunc('month', current_date) - interval '5 months',
                           date_trunc('month', current_date), interval '1 month') m
  )
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
    'installments_overdue',(select coalesce(sum(remaining_amount),0) from io where status = 'vencida'),
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
                 'month', to_char(mo.m, 'YYYY-MM'),
                 'opened', (select count(*) from demands where organization_id = p_org
                             and opened_at >= mo.m and opened_at < mo.m_end),
                 'closed', (select count(*) from demands where organization_id = p_org and status = 'concluida'
                             and closed_at >= mo.m and closed_at < mo.m_end),
                 'new_clients', (select count(*) from clients where organization_id = p_org
                             and created_at >= mo.m and created_at < mo.m_end)
               ) order by mo.m)
          from months mo),
    'revenue_monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(mo.m, 'YYYY-MM'),
                 'received', (select coalesce(sum(amount),0) from payments where organization_id = p_org
                               and paid_at >= mo.m and paid_at < mo.m_end),
                 'expected', (select coalesce(sum(amount),0) from io where status not in ('cancelada','rascunho')
                               and due_date >= mo.m and due_date < mo.m_end)
               ) order by mo.m)
          from months mo),
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

-- =============================================================================
-- 1/2. Grants explícitos — feito por ÚLTIMO, cobrindo tudo o que existe
-- =============================================================================

-- Tabelas, views e sequências do public: ninguém além do dono, por padrão.
do $$
declare r record;
begin
  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from public, anon, authenticated', r.relname);
    else
      execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);
    end if;
  end loop;
end $$;

-- Matriz da 003/006/009 (a RLS faz o filtro por linha)
grant select on public.organizations to authenticated;
grant update (name, settings) on public.organizations to authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select, delete on public.organization_members to authenticated;
grant update (role, active) on public.organization_members to authenticated;
grant select, delete on public.organization_invitations to authenticated;
grant insert (organization_id, email, role, invited_by, expires_at) on public.organization_invitations to authenticated;
grant update (role, invited_by, expires_at) on public.organization_invitations to authenticated;  -- invited_by: imutável pelo trigger set_invited_by
grant select, insert, update, delete on
  public.clients, public.demands, public.tasks, public.demand_categories, public.workflow_stages,
  public.contracts, public.installments, public.payments, public.ai_conversations,
  public.message_templates, public.checklist_templates, public.demand_checklist_items
  to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select on public.activity_logs to authenticated;
grant select on public.ai_usage to authenticated;
grant select on public.installment_overview, public.contract_overview to authenticated;

-- Funções do public: nenhuma executável por PUBLIC/anon/authenticated...
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')  -- citext etc.
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- ...exceto as RPCs usadas pelo app/Edge Functions e os helpers que políticas
-- RLS e funções SECURITY INVOKER chamam com os privilégios do usuário.
do $$
declare f text;
begin
  foreach f in array array[
    -- usados por políticas RLS (avaliadas como o usuário)
    'public.is_org_member(uuid)',
    'public.has_org_role(uuid, public.member_role[])',
    'public.shares_org_with(uuid)',
    -- RPCs do frontend (src/)
    'public.create_organization(text)',
    'public.accept_pending_invitations()',
    'public.my_pending_invitations()',
    'public.accept_invitation(uuid)',
    'public.decline_invitation(uuid)',
    'public.leave_organization(uuid)',
    'public.anonymize_client(uuid)',
    'public.dashboard_metrics(uuid)',
    'public.log_export(uuid, text, int, boolean, uuid)',
    'public.reorder_workflow_stages(uuid, uuid[])',
    'public.delete_workflow_stage(uuid, uuid)',
    'public.apply_checklist_template(uuid)',
    'public.reorder_checklist_items(uuid, uuid[])',
    'public.reorder_checklist_templates(uuid, uuid[])',
    -- Edge Functions (supabase/functions/)
    'public.ai_consume_quota(uuid, text, int, int)',
    'public.ai_stalled_demands(uuid, int)',
    'public.ai_waiting_documents(uuid)',
    'public.ai_overdue_tasks(uuid)',
    'public.ai_upcoming_tasks(uuid, int)',
    'public.ai_weekly_summary(uuid, date)',
    'public.ai_count_demands(uuid, text, date, date, text)',
    'public.ai_clients_awaiting(uuid)',
    'public.ai_financial_overview(uuid)',
    'public.ai_office_overview(uuid)',
    -- helpers chamados pelas ferramentas de IA (SECURITY INVOKER)
    'public.ai_today()',
    'public.ai_norm(text)',
    'public.ai_assert_member(uuid)',
    'public.ai_member_name(uuid)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Objetos FUTUROS criados por este papel no public também nascem fechados
-- (o Supabase concede ALL a anon/authenticated por default privileges).
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
