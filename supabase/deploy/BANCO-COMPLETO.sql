-- JurisFlow AI — estrutura completa do banco (21 migrations em ordem).
-- Banco NOVO: cole TUDO no Supabase > SQL Editor > New query e clique em Run. Rodar uma única vez.
-- Banco que já rodou a versão antiga deste arquivo: use ATUALIZAR-BANCO.sql.
-- Gerado por scripts/gerar-sql-unico.py — não editar à mão.

-- >>>>>>>>>> 20261109000001_core_schema.sql
-- =============================================================================
-- JurisFlow AI — Migration 001: schema principal, multiempresa e RLS
-- =============================================================================
-- Princípios:
--  * Toda tabela de dados privados tem organization_id e RLS habilitada.
--  * Chaves estrangeiras compostas (organization_id, id) garantem, no próprio
--    banco, que uma demanda nunca aponte para cliente/etapa/responsável de outro
--    escritório — mesmo que o frontend erre.
--  * Funções auxiliares SECURITY DEFINER evitam recursão nas políticas.
--  * Nenhum armazenamento de documentos (requisito do MVP).
-- =============================================================================

create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'advogado', 'assistente');
create type public.client_status as enum ('prospecto', 'ativo', 'inativo', 'arquivado');
create type public.priority_level as enum ('baixa', 'media', 'alta', 'urgente');
create type public.demand_status as enum ('em_andamento', 'aguardando_cliente', 'suspensa', 'concluida', 'cancelada');
create type public.task_status as enum ('pendente', 'em_andamento', 'concluida', 'cancelada');
create type public.contract_type as enum ('honorarios_fixos', 'exito', 'misto', 'consultoria', 'outro');
create type public.payment_method as enum ('pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'outro');
create type public.contract_status as enum ('rascunho', 'ativo', 'quitado', 'cancelado');
create type public.ai_role as enum ('user', 'assistant');

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Impede mover um registro para outro escritório depois de criado.
create or replace function public.prevent_org_change()
returns trigger language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id não pode ser alterado' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Organizações, perfis e membros
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  is_demo     boolean not null default false,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  email       citext,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.organization_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             public.member_role not null default 'assistente',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create table public.organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  email            citext not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role             public.member_role not null default 'assistente',
  invited_by       uuid references public.profiles(id) on delete set null,
  accepted_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index organization_invitations_pending_uidx
  on public.organization_invitations(organization_id, email) where accepted_at is null;

-- -----------------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER: leem membership sem RLS → sem recursão)
-- -----------------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.active
      and m.role = any(p_roles)
  );
$$;

create or replace function public.shares_org_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b on b.organization_id = a.organization_id
    where a.user_id = auth.uid() and a.active and b.user_id = p_user
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.member_role[]) from public;
revoke all on function public.shares_org_with(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.shares_org_with(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Clientes
-- -----------------------------------------------------------------------------
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  full_name        text not null check (char_length(btrim(full_name)) between 2 and 160),
  cpf              text check (cpf ~ '^[0-9]{11}$'),
  phone            text check (phone ~ '^[0-9]{10,13}$'),
  email            citext check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  birth_date       date check (birth_date is null or (birth_date > '1900-01-01' and birth_date <= current_date)),
  address          text check (char_length(address) <= 300),
  notes            text check (char_length(notes) <= 4000),
  status           public.client_status not null default 'ativo',
  anonymized_at    timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index clients_org_cpf_uidx on public.clients(organization_id, cpf) where cpf is not null;
create index clients_org_status_idx on public.clients(organization_id, status);
create index clients_org_name_idx on public.clients(organization_id, lower(full_name));

-- -----------------------------------------------------------------------------
-- Categorias e etapas (fluxos configuráveis)
-- -----------------------------------------------------------------------------
create table public.demand_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  color            text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order       int not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.workflow_stages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  category_id      uuid not null,
  name             text not null check (char_length(btrim(name)) between 1 and 80),
  position         int not null check (position >= 0),
  is_final         boolean not null default false,  -- etapa de conclusão
  is_waiting_docs  boolean not null default false,  -- conta como "aguardando documentos"
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (category_id, id),
  foreign key (organization_id, category_id)
    references public.demand_categories(organization_id, id) on delete cascade
);
create index workflow_stages_category_idx on public.workflow_stages(category_id, position);

-- -----------------------------------------------------------------------------
-- Demandas
-- -----------------------------------------------------------------------------
create table public.demands (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  client_id         uuid not null,
  category_id       uuid not null,
  stage_id          uuid,
  title             text not null check (char_length(btrim(title)) between 2 and 160),
  description       text check (char_length(description) <= 4000),
  responsible_id    uuid,
  opened_at         date not null default current_date,
  priority          public.priority_level not null default 'media',
  status            public.demand_status not null default 'em_andamento',
  next_action       text check (char_length(next_action) <= 300),
  next_action_date  date,
  notes             text check (char_length(notes) <= 4000),
  stage_changed_at  timestamptz not null default now(),
  closed_at         timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, category_id)
    references public.demand_categories(organization_id, id) on delete restrict,
  -- a etapa precisa pertencer à mesma categoria
  foreign key (category_id, stage_id)
    references public.workflow_stages(category_id, id) on delete set null (stage_id),
  foreign key (organization_id, responsible_id)
    references public.organization_members(organization_id, user_id) on delete set null (responsible_id)
);
create index demands_org_status_idx on public.demands(organization_id, status);
create index demands_org_category_idx on public.demands(organization_id, category_id);
create index demands_stage_idx on public.demands(stage_id);
create index demands_client_idx on public.demands(client_id);
create index demands_responsible_idx on public.demands(organization_id, responsible_id);
create index demands_org_stage_changed_idx on public.demands(organization_id, stage_changed_at);

-- -----------------------------------------------------------------------------
-- Tarefas
-- -----------------------------------------------------------------------------
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 2 and 160),
  description      text check (char_length(description) <= 4000),
  client_id        uuid,
  demand_id        uuid,
  assignee_id      uuid,
  due_date         date,
  priority         public.priority_level not null default 'media',
  status           public.task_status not null default 'pendente',
  completed_at     timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete set null (client_id),
  foreign key (organization_id, demand_id)
    references public.demands(organization_id, id) on delete cascade,
  foreign key (organization_id, assignee_id)
    references public.organization_members(organization_id, user_id) on delete set null (assignee_id)
);
create index tasks_org_status_due_idx on public.tasks(organization_id, status, due_date);
create index tasks_demand_idx on public.tasks(demand_id);
create index tasks_client_idx on public.tasks(client_id);
create index tasks_assignee_idx on public.tasks(organization_id, assignee_id);

-- -----------------------------------------------------------------------------
-- Contratos, parcelas e pagamentos
-- -----------------------------------------------------------------------------
create table public.contracts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  client_id           uuid not null,
  demand_id           uuid,
  contract_type       public.contract_type not null default 'honorarios_fixos',
  description         text check (char_length(description) <= 1000),
  total_amount        numeric(12,2) not null check (total_amount > 0 and total_amount < 100000000),
  payment_method      public.payment_method not null default 'pix',
  installments_count  int not null default 1 check (installments_count between 1 and 120),
  first_due_date      date not null default current_date,
  signed_at           date not null default current_date,
  status              public.contract_status not null default 'ativo',
  notes               text check (char_length(notes) <= 2000),
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, demand_id)
    references public.demands(organization_id, id) on delete set null (demand_id)
);
create index contracts_org_status_idx on public.contracts(organization_id, status);
create index contracts_client_idx on public.contracts(client_id);

create table public.installments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contract_id      uuid not null,
  number           int not null check (number >= 1),
  due_date         date not null,
  amount           numeric(12,2) not null check (amount > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  unique (contract_id, number),
  foreign key (organization_id, contract_id)
    references public.contracts(organization_id, id) on delete cascade
);
create index installments_org_due_idx on public.installments(organization_id, due_date);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contract_id      uuid not null,
  installment_id   uuid,
  amount           numeric(12,2) not null check (amount > 0),
  paid_at          date not null default current_date check (paid_at <= current_date + 1),
  method           public.payment_method not null default 'pix',
  notes            text check (char_length(notes) <= 500),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (organization_id, contract_id)
    references public.contracts(organization_id, id) on delete cascade,
  foreign key (organization_id, installment_id)
    references public.installments(organization_id, id) on delete set null (installment_id)
);
create index payments_contract_idx on public.payments(contract_id);
create index payments_org_paid_idx on public.payments(organization_id, paid_at);
create index payments_installment_idx on public.payments(installment_id);

-- -----------------------------------------------------------------------------
-- Logs de atividade (sem valores de dados pessoais)
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  actor_id         uuid references public.profiles(id) on delete set null,
  entity_type      text not null,
  entity_id        uuid not null,
  action           text not null,
  changes          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index activity_logs_org_created_idx on public.activity_logs(organization_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs(entity_type, entity_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Assistente de IA (histórico privado por usuário)
-- -----------------------------------------------------------------------------
create table public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  title            text not null default 'Nova conversa' check (char_length(title) <= 120),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create index ai_conversations_user_idx on public.ai_conversations(organization_id, user_id, updated_at desc);

create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  conversation_id  uuid not null,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             public.ai_role not null,
  content          text not null check (char_length(content) <= 20000),
  tools_used       text[] not null default '{}',
  created_at       timestamptz not null default now(),
  foreign key (organization_id, conversation_id)
    references public.ai_conversations(organization_id, id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);
create index ai_messages_user_created_idx on public.ai_messages(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Triggers de updated_at e proteção de organization_id
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','organization_members','organization_invitations',
    'clients','demand_categories','workflow_stages','demands','tasks','contracts','installments',
    'payments','ai_conversations']
  loop
    execute format('create trigger %I_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
  foreach t in array array['organization_members','organization_invitations','clients',
    'demand_categories','workflow_stages','demands','tasks','contracts','installments','payments',
    'ai_conversations','ai_messages','activity_logs']
  loop
    execute format('create trigger %I_no_org_change before update on public.%I
                    for each row execute function public.prevent_org_change()', t, t);
  end loop;
end $$;

-- >>>>>>>>>> 20261109000002_business_logic.sql
-- =============================================================================
-- JurisFlow AI — Migration 002: regras de negócio, auditoria, RPCs e views
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfil automático ao criar usuário no Supabase Auth
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Auditoria (activity_logs). Para clientes registramos apenas NOMES de campos
-- alterados, nunca os valores (CPF, telefone etc.) — LGPD, minimização.
-- -----------------------------------------------------------------------------
create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row        jsonb;
  v_old        jsonb;
  v_changes    jsonb := '{}'::jsonb;
  v_action     text;
  v_key        text;
  v_safe_keys  text[] := coalesce(tg_argv, '{}');   -- campos cujos valores podem ir para o log
  v_ignore     text[] := array['updated_at','created_at','stage_changed_at','closed_at','completed_at'];
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old); v_action := 'deleted';
  elsif tg_op = 'INSERT' then
    v_row := to_jsonb(new); v_action := 'created';
  else
    v_row := to_jsonb(new); v_old := to_jsonb(old); v_action := 'updated';
    for v_key in select jsonb_object_keys(v_row) loop
      continue when v_key = any(v_ignore);
      if v_row->v_key is distinct from v_old->v_key then
        if v_key = any(v_safe_keys) then
          v_changes := v_changes || jsonb_build_object(v_key,
            jsonb_build_object('from', v_old->v_key, 'to', v_row->v_key));
        else
          v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('changed', true));
        end if;
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    if v_changes ? 'stage_id' then v_action := 'stage_changed';
    elsif v_changes ? 'status' then v_action := 'status_changed';
    end if;
  end if;

  if tg_op = 'INSERT' and tg_table_name = 'payments' then
    v_changes := jsonb_build_object('amount', v_row->'amount');
  end if;

  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values ((v_row->>'organization_id')::uuid, auth.uid(), tg_table_name, (v_row->>'id')::uuid, v_action, v_changes);

  return coalesce(new, old);
end $$;

create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.log_activity('status');
create trigger demands_audit after insert or update or delete on public.demands
  for each row execute function public.log_activity('stage_id','status','priority','responsible_id','category_id','title');
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.log_activity('status','priority','assignee_id','due_date','title');
create trigger contracts_audit after insert or update or delete on public.contracts
  for each row execute function public.log_activity('status','total_amount','installments_count');
create trigger payments_audit after insert or delete on public.payments
  for each row execute function public.log_activity('amount');
create trigger members_audit after insert or update or delete on public.organization_members
  for each row execute function public.log_activity('role','active');

-- -----------------------------------------------------------------------------
-- Demandas: etapa padrão, data de mudança de etapa, conclusão automática
-- -----------------------------------------------------------------------------
create or replace function public.demands_before_write()
returns trigger language plpgsql as $$
declare
  v_final boolean;
begin
  -- Mudou de categoria sem informar etapa nova → volta para a 1ª etapa da nova categoria
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id
     and new.stage_id is not distinct from old.stage_id then
    new.stage_id := null;
  end if;

  if new.stage_id is null then
    select id into new.stage_id from public.workflow_stages
     where category_id = new.category_id order by position limit 1;
  end if;

  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
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

create trigger demands_before_write before insert or update on public.demands
  for each row execute function public.demands_before_write();

-- -----------------------------------------------------------------------------
-- Tarefas: completed_at e herança do cliente pela demanda
-- -----------------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql as $$
begin
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

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- -----------------------------------------------------------------------------
-- Contratos: geração automática de parcelas
-- -----------------------------------------------------------------------------
create or replace function public.generate_installments(p_contract uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c        public.contracts%rowtype;
  v_base   numeric(12,2);
  v_last   numeric(12,2);
  i        int;
begin
  select * into c from public.contracts where id = p_contract;
  delete from public.installments where contract_id = p_contract;
  v_base := trunc(c.total_amount / c.installments_count, 2);
  v_last := c.total_amount - v_base * (c.installments_count - 1);
  for i in 1..c.installments_count loop
    insert into public.installments (organization_id, contract_id, number, due_date, amount)
    values (c.organization_id, c.id, i,
            (c.first_due_date + make_interval(months => i - 1))::date,
            case when i = c.installments_count then v_last else v_base end);
  end loop;
end $$;
revoke all on function public.generate_installments(uuid) from public, authenticated;

create or replace function public.contracts_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.generate_installments(new.id);
  elsif new.total_amount is distinct from old.total_amount
     or new.installments_count is distinct from old.installments_count
     or new.first_due_date is distinct from old.first_due_date then
    if exists (select 1 from public.payments where contract_id = new.id) then
      raise exception 'Não é possível alterar valor, parcelas ou vencimento de um contrato que já possui pagamentos.'
        using errcode = 'P0001';
    end if;
    perform public.generate_installments(new.id);
  end if;
  return new;
end $$;

create trigger contracts_after_write after insert or update on public.contracts
  for each row execute function public.contracts_after_write();

-- -----------------------------------------------------------------------------
-- Pagamentos: valida parcela × contrato e atualiza status (quitado/ativo)
-- -----------------------------------------------------------------------------
create or replace function public.payments_before_write()
returns trigger language plpgsql as $$
begin
  if new.installment_id is not null and not exists (
    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  ) then
    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.contracts where id = new.contract_id and status = 'cancelado') then
    raise exception 'Não é possível registrar pagamento em contrato cancelado.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.refresh_contract_status(p_contract uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_total    numeric;
  v_paid     numeric;
  v_status   public.contract_status;
begin
  select total_amount, status into v_total, v_status from public.contracts where id = p_contract;
  if v_status in ('cancelado', 'rascunho') or v_status is null then return; end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where contract_id = p_contract;
  update public.contracts
     set status = case when v_paid >= v_total then 'quitado'::public.contract_status else 'ativo' end
   where id = p_contract
     and status is distinct from (case when v_paid >= v_total then 'quitado'::public.contract_status else 'ativo' end);
end $$;
revoke all on function public.refresh_contract_status(uuid) from public, authenticated;

create or replace function public.payments_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_contract_status(coalesce(new.contract_id, old.contract_id));
  return coalesce(new, old);
end $$;

create trigger payments_after_write after insert or update or delete on public.payments
  for each row execute function public.payments_after_write();

-- -----------------------------------------------------------------------------
-- Membros: nunca deixar um escritório sem administrador ativo
-- -----------------------------------------------------------------------------
create or replace function public.protect_last_admin()
returns trigger language plpgsql as $$
begin
  if old.role = 'admin' and old.active and (
       tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    if not exists (
      select 1 from public.organization_members
       where organization_id = old.organization_id and role = 'admin' and active and id <> old.id
    ) then
      raise exception 'O escritório precisa de pelo menos um administrador ativo.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger members_protect_last_admin before update or delete on public.organization_members
  for each row execute function public.protect_last_admin();

-- -----------------------------------------------------------------------------
-- Categorias/etapas padrão (controles administrativos — personalizáveis)
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_workflows(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cat   uuid;
  v_def   jsonb := $json$[
    {"name":"Salário-maternidade","color":"#db2777","stages":["Primeiro atendimento","Cadastro da cliente","Solicitação de documentos","Aguardando documentação*","Conferência documental externa","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Aposentadoria","color":"#2563eb","stages":["Primeiro atendimento","Levantamento de informações","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Benefícios por incapacidade","color":"#d97706","stages":["Primeiro atendimento","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Perícia agendada","Acompanhamento","Concluído!"]},
    {"name":"Benefícios relacionados à pesca","color":"#0891b2","stages":["Primeiro atendimento","Solicitação de documentos","Aguardando documentação*","Preparação do requerimento","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Demandas trabalhistas","color":"#7c3aed","stages":["Primeiro atendimento","Coleta de informações","Aguardando documentação*","Elaboração","Protocolo","Acompanhamento","Concluído!"]},
    {"name":"Contratos","color":"#059669","stages":["Solicitação","Elaboração","Revisão","Assinatura","Concluído!"]},
    {"name":"Outros","color":"#64748b","stages":["A fazer","Em andamento","Aguardando documentação*","Concluído!"]}
  ]$json$::jsonb;
  v_item  jsonb;
  v_stage text;
  v_pos   int;
  v_ord   int := 0;
begin
  for v_item in select * from jsonb_array_elements(v_def) loop
    insert into public.demand_categories (organization_id, name, color, sort_order)
    values (p_org, v_item->>'name', v_item->>'color', v_ord)
    on conflict (organization_id, name) do nothing
    returning id into v_cat;
    v_ord := v_ord + 1;
    continue when v_cat is null;
    v_pos := 0;
    for v_stage in select * from jsonb_array_elements_text(v_item->'stages') loop
      insert into public.workflow_stages (organization_id, category_id, name, position, is_final, is_waiting_docs)
      values (p_org, v_cat, rtrim(v_stage, '*!'), v_pos, v_stage like '%!', v_stage like '%*');
      v_pos := v_pos + 1;
    end loop;
  end loop;
end $$;
revoke all on function public.seed_default_workflows(uuid) from public, authenticated;

-- -----------------------------------------------------------------------------
-- RPCs de onboarding
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if (select count(*) from public.organization_members where user_id = auth.uid() and role = 'admin') >= 3 then
    raise exception 'Limite de escritórios por usuário atingido.' using errcode = 'P0001';
  end if;
  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, auth.uid(), 'admin');
  perform public.seed_default_workflows(v_org);
  return v_org;
end $$;
revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- Aceita convites pendentes cujo e-mail coincide com o e-mail verificado do usuário.
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
    insert into public.organization_members (organization_id, user_id, role)
    values (inv.organization_id, auth.uid(), inv.role)
    on conflict (organization_id, user_id) do update set active = true;
    update public.organization_invitations set accepted_at = now() where id = inv.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function public.accept_pending_invitations() from public;
grant execute on function public.accept_pending_invitations() to authenticated;

-- -----------------------------------------------------------------------------
-- LGPD: anonimização de cliente (mantém histórico operacional/financeiro,
-- remove dados pessoais). Apenas administradores.
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;
end $$;
revoke all on function public.anonymize_client(uuid) from public;
grant execute on function public.anonymize_client(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Reordenação atômica de etapas (Kanban/configuração de fluxos)
-- -----------------------------------------------------------------------------
create or replace function public.reorder_workflow_stages(p_category uuid, p_stage_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.workflow_stages where category_id = p_category)
     <> coalesce(array_length(p_stage_ids, 1), 0) then
    raise exception 'A lista de etapas está incompleta ou desatualizada.' using errcode = 'P0001';
  end if;
  for i in 1..array_length(p_stage_ids, 1) loop
    update public.workflow_stages set position = i - 1
     where id = p_stage_ids[i] and category_id = p_category;
    if not found then
      raise exception 'Etapa inválida ou sem permissão.' using errcode = '42501';
    end if;
  end loop;
end $$;
grant execute on function public.reorder_workflow_stages(uuid, uuid[]) to authenticated;

-- Exclui etapa movendo as demandas para outra etapa da mesma categoria.
create or replace function public.delete_workflow_stage(p_stage uuid, p_move_to uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_cat uuid;
begin
  select category_id into v_cat from public.workflow_stages where id = p_stage;
  if v_cat is null then raise exception 'Etapa não encontrada' using errcode = 'P0002'; end if;
  if p_move_to is not null then
    if not exists (select 1 from public.workflow_stages where id = p_move_to and category_id = v_cat and id <> p_stage) then
      raise exception 'Etapa de destino inválida' using errcode = 'P0001';
    end if;
    update public.demands set stage_id = p_move_to where stage_id = p_stage;
  elsif exists (select 1 from public.demands where stage_id = p_stage) then
    raise exception 'Há demandas nesta etapa. Escolha uma etapa de destino.' using errcode = 'P0001';
  end if;
  delete from public.workflow_stages where id = p_stage;
  if not found then raise exception 'Sem permissão para excluir a etapa' using errcode = '42501'; end if;
end $$;
grant execute on function public.delete_workflow_stage(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Views financeiras (security_invoker → respeitam a RLS de quem consulta)
-- -----------------------------------------------------------------------------
create view public.installment_overview with (security_invoker = true) as
select
  i.id, i.organization_id, i.contract_id, i.number, i.due_date, i.amount,
  coalesce(p.paid, 0)::numeric(12,2)                         as paid_amount,
  greatest(i.amount - coalesce(p.paid, 0), 0)::numeric(12,2) as remaining_amount,
  case
    when coalesce(p.paid, 0) >= i.amount then 'paga'
    when c.status = 'cancelado'           then 'cancelada'
    when i.due_date < current_date        then 'vencida'
    when coalesce(p.paid, 0) > 0          then 'parcial'
    else 'a_vencer'
  end as status,
  c.client_id
from public.installments i
join public.contracts c on c.id = i.contract_id
left join lateral (
  select sum(amount) as paid from public.payments where installment_id = i.id
) p on true;

create view public.contract_overview with (security_invoker = true) as
select
  c.*,
  coalesce(p.received, 0)::numeric(12,2)                                as received_amount,
  greatest(c.total_amount - coalesce(p.received, 0), 0)::numeric(12,2)  as balance_amount,
  coalesce(io.overdue_count, 0)                                         as overdue_count,
  io.next_due_date
from public.contracts c
left join lateral (select sum(amount) as received from public.payments where contract_id = c.id) p on true
left join lateral (
  select count(*) filter (where status = 'vencida')                       as overdue_count,
         min(due_date) filter (where status in ('a_vencer', 'parcial', 'vencida')) as next_due_date
    from public.installment_overview where contract_id = c.id
) io on true;

-- -----------------------------------------------------------------------------
-- Dashboard: todos os indicadores calculados no banco com dados reais.
-- SECURITY INVOKER → RLS continua valendo.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

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
    'installments_overdue',(select coalesce(sum(remaining_amount),0) from installment_overview
                             where organization_id = p_org and status = 'vencida'),
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
                 'month', to_char(m, 'YYYY-MM'),
                 'opened', (select count(*) from demands where organization_id = p_org and date_trunc('month', opened_at) = m),
                 'closed', (select count(*) from demands where organization_id = p_org and status = 'concluida' and date_trunc('month', closed_at) = m),
                 'new_clients', (select count(*) from clients where organization_id = p_org and date_trunc('month', created_at) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'revenue_monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'received', (select coalesce(sum(amount),0) from payments where organization_id = p_org and date_trunc('month', paid_at) = m),
                 'expected', (select coalesce(sum(amount),0) from installment_overview where organization_id = p_org and status <> 'cancelada' and date_trunc('month', due_date) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
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
grant execute on function public.dashboard_metrics(uuid) to authenticated;

-- >>>>>>>>>> 20261109000003_rls_policies.sql
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

-- >>>>>>>>>> 20261109000004_ai_tools.sql
-- =============================================================================
-- JurisFlow AI — Migration 004: "ferramentas" do Assistente de IA
-- =============================================================================
-- O modelo de linguagem NUNCA executa SQL. A Edge Function `ai-assistant`
-- expõe ao modelo apenas uma whitelist de ferramentas, cada uma mapeada para
-- uma destas funções. Regras comuns:
--   * SECURITY INVOKER  → a RLS do usuário que fez a pergunta continua valendo
--                          (a Edge Function chama com o JWT do próprio usuário).
--   * STABLE, somente leitura.
--   * Verificam is_org_member(p_org) e lançam 42501 caso contrário.
--   * Parâmetros validados/limitados; listas com no máximo 50 itens
--     (o total real é informado em `total` para o modelo saber se truncou).
--   * Retornam jsonb SEM CPF, telefone, e-mail, endereço, nascimento ou
--     observações. Nomes de clientes/membros saem daqui, mas a Edge Function os
--     pseudonimiza antes de enviar ao provedor de IA.
--   * "Hoje" = data em America/Sao_Paulo (o servidor Supabase roda em UTC).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------
create or replace function public.ai_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Normaliza texto para busca: minúsculas, sem acentos, hífens/underscores → espaço.
create or replace function public.ai_norm(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
           translate(lower(coalesce(p, '')),
             'áàâãäéèêëíìîïóòôõöúùûüçñ-_',
             'aaaaaeeeeiiiiooooouuuucn  '),
           '\s+', ' ', 'g'));
$$;

create or replace function public.ai_assert_member(p_org uuid)
returns void language plpgsql stable set search_path = public as $$
begin
  if p_org is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
end $$;

-- Nome exibível de um membro (nunca usa e-mail).
create or replace function public.ai_member_name(p_user uuid)
returns text language sql stable set search_path = public as $$
  select case when p_user is null then null
              else coalesce((select nullif(btrim(full_name), '') from public.profiles where id = p_user), 'Membro sem nome')
         end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Demandas paradas: abertas e sem mudança de etapa há ≥ N dias
-- -----------------------------------------------------------------------------
create or replace function public.ai_stalled_demands(p_org uuid, p_days int default 15)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 15), 1), 365);
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.id, d.title, d.priority, d.status, d.responsible_id, d.next_action_date,
           c.full_name as client, cat.name as category, s.name as stage,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_stalled
      from demands d
      join clients c            on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
      left join workflow_stages s on s.id = d.stage_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) >= v_days
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'client', b.client, 'category', b.category,
                    'stage', b.stage, 'status', b.status, 'priority', b.priority,
                    'days_stalled', b.days_stalled,
                    'responsible', public.ai_member_name(b.responsible_id)) order by b.days_stalled desc)
                   from (select * from base order by days_stalled desc limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('min_days', v_days, 'today', v_today, 'total', v_total,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Demandas aguardando documentação (etapa is_waiting_docs)
-- -----------------------------------------------------------------------------
create or replace function public.ai_waiting_documents(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today   date := public.ai_today();
  v_total   int;
  v_clients int;
  v_items   jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.id, d.title, d.client_id, d.responsible_id,
           c.full_name as client, cat.name as category, s.name as stage,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_in_stage
      from demands d
      join workflow_stages s     on s.id = d.stage_id and s.is_waiting_docs
      join clients c             on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
  )
  select (select count(*) from base),
         (select count(distinct client_id) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'client', b.client, 'category', b.category,
                    'stage', b.stage, 'days_in_stage', b.days_in_stage,
                    'responsible', public.ai_member_name(b.responsible_id)) order by b.days_in_stage desc)
                   from (select * from base order by days_in_stage desc limit 50) b), '[]'::jsonb)
    into v_total, v_clients, v_items;

  return jsonb_build_object('today', v_today, 'total_demands', v_total, 'distinct_clients', v_clients,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 3/4. Tarefas atrasadas e próximas
-- -----------------------------------------------------------------------------
create or replace function public.ai_overdue_tasks(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select t.id, t.title, t.due_date, t.priority, t.status, t.assignee_id,
           c.full_name as client, d.title as demand, (v_today - t.due_date) as days_overdue
      from tasks t
      left join clients c on c.id = t.client_id
      left join demands d on d.id = t.demand_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date < v_today
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'due_date', b.due_date, 'days_overdue', b.days_overdue,
                    'priority', b.priority, 'status', b.status, 'client', b.client, 'demand', b.demand,
                    'assignee', public.ai_member_name(b.assignee_id)) order by b.due_date)
                   from (select * from base order by due_date limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('today', v_today, 'total', v_total, 'truncated', v_total > 50, 'items', v_items);
end $$;

create or replace function public.ai_upcoming_tasks(p_org uuid, p_days int default 7)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 7), 1), 60);
  v_today date := public.ai_today();
  v_total int;
  v_items jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select t.id, t.title, t.due_date, t.priority, t.status, t.assignee_id,
           c.full_name as client, d.title as demand, (t.due_date - v_today) as days_left
      from tasks t
      left join clients c on c.id = t.client_id
      left join demands d on d.id = t.demand_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date between v_today and v_today + v_days
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', b.id, 'title', b.title, 'due_date', b.due_date, 'days_left', b.days_left,
                    'priority', b.priority, 'status', b.status, 'client', b.client, 'demand', b.demand,
                    'assignee', public.ai_member_name(b.assignee_id)) order by b.due_date)
                   from (select * from base order by due_date limit 50) b), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('today', v_today, 'days', v_days, 'total', v_total,
                            'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Resumo semanal (segunda a domingo). Valores financeiros só para
--    administrador/advogado; para assistente vêm nulos com financial_restricted.
-- -----------------------------------------------------------------------------
create or replace function public.ai_weekly_summary(p_org uuid, p_start date default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today  date := public.ai_today();
  v_start  date;
  v_end    date;
  v_fin    boolean;
  v_result jsonb;
begin
  perform public.ai_assert_member(p_org);
  v_fin := public.has_org_role(p_org, array['admin', 'advogado']::public.member_role[]);

  v_start := coalesce(p_start, v_today);
  v_start := least(greatest(v_start, v_today - 366), v_today);  -- até 1 ano para trás, nunca futuro
  v_start := date_trunc('week', v_start)::date;                 -- segunda-feira
  v_end   := v_start + 6;

  select jsonb_build_object(
    'week_start', v_start,
    'week_end', v_end,
    'today', v_today,
    'demands_opened', (select count(*) from demands
                        where organization_id = p_org and opened_at between v_start and v_end),
    'demands_completed', (select count(*) from demands
                        where organization_id = p_org and status = 'concluida'
                          and (closed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'demands_open_now', (select count(*) from demands
                        where organization_id = p_org and status not in ('concluida', 'cancelada')),
    'stage_changes', (select count(*) from activity_logs
                        where organization_id = p_org and entity_type = 'demands' and action = 'stage_changed'
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_created', (select count(*) from tasks
                        where organization_id = p_org
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_completed', (select count(*) from tasks
                        where organization_id = p_org and status = 'concluida'
                          and (completed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'tasks_overdue_in_week', (select count(*) from tasks
                        where organization_id = p_org and status in ('pendente', 'em_andamento')
                          and due_date between v_start and least(v_end, v_today - 1)),
    'tasks_overdue_now', (select count(*) from tasks
                        where organization_id = p_org and status in ('pendente', 'em_andamento') and due_date < v_today),
    'new_clients', (select count(*) from clients
                        where organization_id = p_org
                          and (created_at at time zone 'America/Sao_Paulo')::date between v_start and v_end),
    'financial_restricted', not v_fin,
    'payments_count', case when v_fin then (select count(*) from payments
                        where organization_id = p_org and paid_at between v_start and v_end) end,
    'payments_received', case when v_fin then (select coalesce(sum(amount), 0) from payments
                        where organization_id = p_org and paid_at between v_start and v_end) end,
    'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', x.name, 'opened', x.opened, 'completed', x.completed)
                         order by x.opened desc, x.name)
          from (select cat.name,
                       count(*) filter (where d.opened_at between v_start and v_end) as opened,
                       count(*) filter (where d.status = 'concluida'
                         and (d.closed_at at time zone 'America/Sao_Paulo')::date between v_start and v_end) as completed
                  from demand_categories cat
                  join demands d on d.category_id = cat.id
                 where cat.organization_id = p_org
                 group by cat.name) x
         where x.opened > 0 or x.completed > 0), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Contagem de demandas com filtros (categoria por nome, período, status)
-- -----------------------------------------------------------------------------
create or replace function public.ai_count_demands(
  p_org uuid,
  p_category_name text default null,
  p_from date default null,
  p_to date default null,
  p_status text default null
)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_term    text;
  v_pattern text;
  v_status  public.demand_status;
  v_cats    uuid[];
  v_total   int;
  v_by_cat  jsonb;
  v_by_st   jsonb;
  v_matched jsonb;
begin
  perform public.ai_assert_member(p_org);

  if p_status is not null and btrim(p_status) <> '' then
    if btrim(p_status) not in ('em_andamento', 'aguardando_cliente', 'suspensa', 'concluida', 'cancelada') then
      raise exception 'Status inválido: use em_andamento, aguardando_cliente, suspensa, concluida ou cancelada'
        using errcode = '22023';
    end if;
    v_status := btrim(p_status)::public.demand_status;
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Período inválido: data inicial maior que a final' using errcode = '22023';
  end if;

  v_term := left(public.ai_norm(p_category_name), 80);
  if v_term <> '' then
    -- curingas do LIKE escapados: o termo é tratado como texto literal
    v_pattern := '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    select coalesce(array_agg(id), '{}'),
           coalesce(jsonb_agg(name order by name), '[]'::jsonb)
      into v_cats, v_matched
      from demand_categories
     where organization_id = p_org and public.ai_norm(name) like v_pattern escape '\';
  end if;

  with base as (
    select d.status, cat.name as category
      from demands d
      join demand_categories cat on cat.id = d.category_id
     where d.organization_id = p_org
       and (v_term = '' or d.category_id = any(v_cats))
       and (p_from is null or d.opened_at >= p_from)
       and (p_to is null or d.opened_at <= p_to)
       and (v_status is null or d.status = v_status)
  )
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object('category', category, 'count', n) order by n desc, category)
                     from (select category, count(*) n from base group by category) x), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('status', status, 'count', n) order by n desc)
                     from (select status, count(*) n from base group by status) y), '[]'::jsonb)
    into v_total, v_by_cat, v_by_st;

  return jsonb_build_object(
    'filters', jsonb_build_object('category_name', nullif(v_term, ''), 'from', p_from, 'to', p_to,
                                  'status', v_status, 'date_field', 'opened_at'),
    'matched_categories', case when v_term = '' then null else v_matched end,
    'total', v_total,
    'by_category', v_by_cat,
    'by_status', v_by_st);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Clientes aguardando (cliente/documentação/1º atendimento)
-- -----------------------------------------------------------------------------
create or replace function public.ai_clients_awaiting(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today   date := public.ai_today();
  v_total   int;
  v_by_rsn  jsonb;
  v_items   jsonb;
begin
  perform public.ai_assert_member(p_org);

  with base as (
    select d.client_id, c.full_name as client, d.title, cat.name as category, s.name as stage,
           case when d.status = 'aguardando_cliente' then 'aguardando_cliente'
                when s.is_waiting_docs              then 'aguardando_documentacao'
                else 'primeiro_atendimento' end as reason,
           (v_today - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date) as days_in_stage
      from demands d
      join clients c             on c.id = d.client_id
      join demand_categories cat on cat.id = d.category_id
      left join workflow_stages s on s.id = d.stage_id
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and (d.status = 'aguardando_cliente'
            or s.is_waiting_docs
            or public.ai_norm(s.name) like '%primeiro atendimento%'
            or public.ai_norm(s.name) like '%1º atendimento%')
  ),
  per_client as (
    select client_id, client, max(days_in_stage) as max_days,
           jsonb_agg(jsonb_build_object('demand', title, 'category', category, 'stage', stage,
                                        'reason', reason, 'days_in_stage', days_in_stage)
                     order by days_in_stage desc) as demands
      from base group by client_id, client
  )
  select (select count(*) from per_client),
         coalesce((select jsonb_object_agg(reason, n)
                     from (select reason, count(distinct client_id) n from base group by reason) r), '{}'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('client', p.client, 'max_days_waiting', p.max_days,
                                                       'demands', p.demands) order by p.max_days desc)
                     from (select * from per_client order by max_days desc limit 50) p), '[]'::jsonb)
    into v_total, v_by_rsn, v_items;

  return jsonb_build_object('today', v_today, 'total_clients', v_total,
                            'clients_by_reason', v_by_rsn, 'truncated', v_total > 50, 'items', v_items);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Visão financeira — somente administrador/advogado
-- -----------------------------------------------------------------------------
create or replace function public.ai_financial_overview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today    date := public.ai_today();
  v_expected numeric;
  v_received numeric;
  v_result   jsonb;
begin
  perform public.ai_assert_member(p_org);
  if not public.has_org_role(p_org, array['admin', 'advogado']::public.member_role[]) then
    raise exception 'Apenas administradores e advogados podem consultar dados financeiros.'
      using errcode = '42501';
  end if;

  select coalesce(sum(total_amount), 0) into v_expected
    from contracts where organization_id = p_org and status in ('ativo', 'quitado');
  select coalesce(sum(p.amount), 0) into v_received
    from payments p join contracts c on c.id = p.contract_id
   where p.organization_id = p_org and c.status in ('ativo', 'quitado');

  select jsonb_build_object(
    'today', v_today,
    'contracts_active', (select count(*) from contracts where organization_id = p_org and status = 'ativo'),
    'contracts_paid_off', (select count(*) from contracts where organization_id = p_org and status = 'quitado'),
    'fees_expected', v_expected,
    'fees_received', v_received,
    'balance', greatest(v_expected - v_received, 0),
    'overdue_installments_count', (select count(*) from installment_overview
                                    where organization_id = p_org and status = 'vencida'),
    'overdue_amount', (select coalesce(sum(remaining_amount), 0) from installment_overview
                        where organization_id = p_org and status = 'vencida'),
    'next_30_days_count', (select count(*) from installment_overview
                            where organization_id = p_org and status in ('a_vencer', 'parcial')
                              and due_date between v_today and v_today + 30),
    'next_30_days_amount', (select coalesce(sum(remaining_amount), 0) from installment_overview
                             where organization_id = p_org and status in ('a_vencer', 'parcial')
                               and due_date between v_today and v_today + 30),
    'received_this_month', (select coalesce(sum(amount), 0) from payments
                             where organization_id = p_org
                               and paid_at between date_trunc('month', v_today)::date and v_today)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Visão geral do escritório (resumo do dashboard, sem valores financeiros)
-- -----------------------------------------------------------------------------
create or replace function public.ai_office_overview(p_org uuid)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_today  date := public.ai_today();
  v_result jsonb;
begin
  perform public.ai_assert_member(p_org);

  select jsonb_build_object(
    'today', v_today,
    'clients_active', (select count(*) from clients where organization_id = p_org and anonymized_at is null
                         and status in ('ativo', 'prospecto')),
    'demands_in_progress', (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida', 'cancelada')),
    'demands_waiting_client', (select count(*) from demands where organization_id = p_org
                                and status = 'aguardando_cliente'),
    'demands_waiting_docs', (select count(*) from demands d join workflow_stages s on s.id = d.stage_id
                              where d.organization_id = p_org and s.is_waiting_docs
                                and d.status not in ('concluida', 'cancelada')),
    'demands_stalled_15d', (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida', 'cancelada')
                             and (stage_changed_at at time zone 'America/Sao_Paulo')::date <= v_today - 15),
    'demands_completed_30d', (select count(*) from demands where organization_id = p_org and status = 'concluida'
                               and closed_at >= now() - interval '30 days'),
    'tasks_pending', (select count(*) from tasks where organization_id = p_org
                       and status in ('pendente', 'em_andamento')),
    'tasks_overdue', (select count(*) from tasks where organization_id = p_org
                       and status in ('pendente', 'em_andamento') and due_date < v_today),
    'tasks_due_next_7d', (select count(*) from tasks where organization_id = p_org
                           and status in ('pendente', 'em_andamento') and due_date between v_today and v_today + 7),
    'open_by_category', coalesce((
        select jsonb_agg(jsonb_build_object('category', x.name, 'count', x.n) order by x.n desc, x.name)
          from (select cat.name, count(*) n
                  from demands d join demand_categories cat on cat.id = d.category_id
                 where d.organization_id = p_org and d.status not in ('concluida', 'cancelada')
                 group by cat.name) x), '[]'::jsonb),
    'by_status', coalesce((
        select jsonb_object_agg(status, n)
          from (select status, count(*) n from demands where organization_id = p_org group by status) s), '{}'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- Permissões: somente usuários autenticados (a RLS e is_org_member fazem o resto)
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.ai_today()',
    'public.ai_norm(text)',
    'public.ai_assert_member(uuid)',
    'public.ai_member_name(uuid)',
    'public.ai_stalled_demands(uuid, int)',
    'public.ai_waiting_documents(uuid)',
    'public.ai_overdue_tasks(uuid)',
    'public.ai_upcoming_tasks(uuid, int)',
    'public.ai_weekly_summary(uuid, date)',
    'public.ai_count_demands(uuid, text, date, date, text)',
    'public.ai_clients_awaiting(uuid)',
    'public.ai_financial_overview(uuid)',
    'public.ai_office_overview(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- >>>>>>>>>> 20261109000005_security_fixes.sql
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

-- >>>>>>>>>> 20261109000006_checklists_templates.sql
-- =============================================================================
-- JurisFlow AI — Migration 006: modelos de mensagem e checklist de pendências
-- =============================================================================
-- * message_templates: modelos de mensagem (WhatsApp/e-mail) do escritório.
--   Nada é enviado pelo sistema — a UI só monta links wa.me/mailto.
-- * checklist_templates: itens sugeridos por categoria (editáveis).
-- * demand_checklist_items: lista TEXTUAL de itens solicitados/recebidos por
--   demanda. NÃO há armazenamento de arquivos (requisito do MVP).
-- Os itens padrão são sugestões administrativas, não exigências legais.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Modelos de mensagem
-- -----------------------------------------------------------------------------
create table public.message_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  subject          text check (subject is null or char_length(subject) <= 160),
  body             text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index message_templates_org_name_uidx on public.message_templates(organization_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- Modelos de checklist por categoria
-- -----------------------------------------------------------------------------
create table public.checklist_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  category_id      uuid not null,
  label            text not null check (char_length(btrim(label)) between 1 and 160),
  position         int not null default 0 check (position >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id)
    references public.demand_categories(organization_id, id) on delete cascade
);
create index checklist_templates_category_idx on public.checklist_templates(category_id, position);
create unique index checklist_templates_label_uidx on public.checklist_templates(category_id, lower(btrim(label)));

-- -----------------------------------------------------------------------------
-- Itens do checklist de cada demanda
-- -----------------------------------------------------------------------------
create table public.demand_checklist_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  demand_id        uuid not null,
  label            text not null check (char_length(btrim(label)) between 1 and 160),
  done             boolean not null default false,
  done_at          timestamptz,
  done_by          uuid references public.profiles(id) on delete set null,
  position         int not null default 0 check (position >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, demand_id)
    references public.demands(organization_id, id) on delete cascade
);
create index demand_checklist_items_demand_idx on public.demand_checklist_items(demand_id, position);
create index demand_checklist_items_org_pending_idx on public.demand_checklist_items(organization_id) where not done;
-- Um mesmo rótulo não se repete na demanda (garante idempotência do apply).
create unique index demand_checklist_items_label_uidx on public.demand_checklist_items(demand_id, lower(btrim(label)));

-- done_at/done_by são definidos pelo banco (não confiamos no cliente).
create or replace function public.checklist_items_before_write()
returns trigger language plpgsql as $$
begin
  new.label := btrim(new.label);
  if tg_op = 'INSERT' or new.done is distinct from old.done then
    if new.done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end $$;

create or replace function public.trim_label_before_write()
returns trigger language plpgsql as $$
begin
  new.label := btrim(new.label);
  return new;
end $$;

create trigger demand_checklist_items_before_write before insert or update on public.demand_checklist_items
  for each row execute function public.checklist_items_before_write();
create trigger checklist_templates_trim before insert or update on public.checklist_templates
  for each row execute function public.trim_label_before_write();

do $$
declare t text;
begin
  foreach t in array array['message_templates','checklist_templates','demand_checklist_items'] loop
    execute format('create trigger %I_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t, t);
    execute format('create trigger %I_no_org_change before update on public.%I
                    for each row execute function public.prevent_org_change()', t, t);
  end loop;
end $$;

create trigger message_templates_created_by before insert or update on public.message_templates
  for each row execute function public.set_created_by();

-- Sem trigger de auditoria nos itens: marcar/desmarcar é frequente e poluiria o
-- histórico do escritório; a rastreabilidade fica em done_at/done_by.

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.message_templates      enable row level security;
alter table public.checklist_templates    enable row level security;
alter table public.demand_checklist_items enable row level security;

-- message_templates: ler membros; escrever admin/advogado
create policy message_templates_select on public.message_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy message_templates_insert on public.message_templates for insert to authenticated
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy message_templates_update on public.message_templates for update to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]))
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy message_templates_delete on public.message_templates for delete to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));

-- checklist_templates: ler membros; escrever admin/advogado (igual aos fluxos)
create policy checklist_templates_select on public.checklist_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy checklist_templates_insert on public.checklist_templates for insert to authenticated
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy checklist_templates_update on public.checklist_templates for update to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]))
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy checklist_templates_delete on public.checklist_templates for delete to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));

-- demand_checklist_items: ler/criar/editar membros; excluir admin/advogado
create policy demand_checklist_items_select on public.demand_checklist_items for select to authenticated
  using (public.is_org_member(organization_id));
create policy demand_checklist_items_insert on public.demand_checklist_items for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy demand_checklist_items_update on public.demand_checklist_items for update to authenticated
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy demand_checklist_items_delete on public.demand_checklist_items for delete to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));

revoke all on public.message_templates, public.checklist_templates, public.demand_checklist_items from anon;
grant select, insert, update, delete on
  public.message_templates, public.checklist_templates, public.demand_checklist_items to authenticated;

-- -----------------------------------------------------------------------------
-- Modelos padrão de checklist (sugestões administrativas editáveis)
-- -----------------------------------------------------------------------------
create or replace function public.default_checklist_for(p_category_name text)
returns text[] language sql immutable set search_path = public as $$
  select case
    when lower(p_category_name) ~ 'sal[aá]rio.?maternidade' then array[
      'Documento de identificação com CPF',
      'Comprovante de residência',
      'Certidão de nascimento da criança',
      'Carteira de trabalho (se houver)',
      'Extrato CNIS',
      'Comprovantes de contribuição ou de atividade (se aplicável)']
    when lower(p_category_name) ~ 'aposentadoria' then array[
      'Documento de identificação com CPF',
      'Comprovante de residência',
      'Carteira(s) de trabalho',
      'Extrato CNIS',
      'Carnês ou comprovantes de contribuição (se houver)',
      'Documentos de períodos especiais ou rurais (se aplicável)']
    when lower(p_category_name) ~ 'incapacidade' then array[
      'Documento de identificação com CPF',
      'Comprovante de residência',
      'Carteira de trabalho',
      'Extrato CNIS',
      'Laudos e atestados médicos',
      'Exames e receitas recentes']
    when lower(p_category_name) ~ 'pesca' then array[
      'Documento de identificação com CPF',
      'Comprovante de residência',
      'Registro ou licença de pescador',
      'Documentos da atividade pesqueira',
      'Extrato CNIS',
      'Comprovantes de comercialização do pescado (se houver)']
    when lower(p_category_name) ~ 'trabalhist' then array[
      'Documento de identificação com CPF',
      'Comprovante de residência',
      'Carteira de trabalho',
      'Contracheques',
      'Termo de rescisão (se houver)',
      'Extrato do FGTS',
      'Registros de jornada ou comunicações relevantes (se houver)']
    else null
  end;
$$;

create or replace function public.seed_category_checklist(p_org uuid, p_category uuid, p_name text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_items text[] := public.default_checklist_for(p_name);
  v_count int;
begin
  if v_items is null then return 0; end if;
  insert into public.checklist_templates (organization_id, category_id, label, position)
  select p_org, p_category, x.label, (x.ord - 1)::int
    from unnest(v_items) with ordinality as x(label, ord)
  on conflict (category_id, lower(btrim(label))) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Popula os modelos para todas as categorias de um escritório (orgs existentes).
create or replace function public.seed_default_checklists(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_total int := 0;
begin
  for r in select id, name from public.demand_categories where organization_id = p_org loop
    -- só semeia categorias que ainda não têm nenhum modelo (respeita edições)
    continue when exists (select 1 from public.checklist_templates where category_id = r.id);
    v_total := v_total + public.seed_category_checklist(p_org, r.id, r.name);
  end loop;
  return v_total;
end $$;

-- Novas categorias (incluindo as criadas por seed_default_workflows no onboarding)
create or replace function public.demand_categories_seed_checklist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_category_checklist(new.organization_id, new.id, new.name);
  return new;
end $$;
create trigger demand_categories_seed_checklist after insert on public.demand_categories
  for each row execute function public.demand_categories_seed_checklist();

revoke all on function public.default_checklist_for(text) from public, anon;
revoke all on function public.seed_category_checklist(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.seed_default_checklists(uuid) from public, anon, authenticated;
revoke all on function public.demand_categories_seed_checklist() from public, anon, authenticated;
grant execute on function public.default_checklist_for(text) to authenticated;

-- Escritórios que já existiam antes desta migration
do $$
declare v_org uuid;
begin
  for v_org in select id from public.organizations loop
    perform public.seed_default_checklists(v_org);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER → RLS do usuário continua valendo)
-- -----------------------------------------------------------------------------

-- Copia os modelos da categoria da demanda; não duplica rótulos. Retorna quantos entraram.
create or replace function public.apply_checklist_template(p_demand uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare
  v_org   uuid;
  v_cat   uuid;
  v_base  int;
  v_count int;
begin
  select organization_id, category_id into v_org, v_cat from public.demands where id = p_demand;
  if v_org is null then
    raise exception 'Demanda não encontrada' using errcode = 'P0002';
  end if;
  select coalesce(max(position) + 1, 0) into v_base from public.demand_checklist_items where demand_id = p_demand;

  insert into public.demand_checklist_items (organization_id, demand_id, label, position)
  select v_org, p_demand, t.label, v_base + (row_number() over (order by t.position, t.created_at))::int - 1
    from public.checklist_templates t
   where t.category_id = v_cat and t.organization_id = v_org
     and not exists (
       select 1 from public.demand_checklist_items i
        where i.demand_id = p_demand and lower(btrim(i.label)) = lower(btrim(t.label)))
  on conflict (demand_id, lower(btrim(label))) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.reorder_checklist_items(p_demand uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.demand_checklist_items where demand_id = p_demand)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'A lista de itens está desatualizada. Recarregue a página.' using errcode = 'P0001';
  end if;
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.demand_checklist_items set position = i - 1 where id = p_ids[i] and demand_id = p_demand;
    if not found then raise exception 'Item inválido ou sem permissão.' using errcode = '42501'; end if;
  end loop;
end $$;

create or replace function public.reorder_checklist_templates(p_category uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.checklist_templates where category_id = p_category)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'A lista de modelos está desatualizada. Recarregue a página.' using errcode = 'P0001';
  end if;
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.checklist_templates set position = i - 1 where id = p_ids[i] and category_id = p_category;
    if not found then raise exception 'Item inválido ou sem permissão.' using errcode = '42501'; end if;
  end loop;
end $$;

revoke all on function public.apply_checklist_template(uuid) from public, anon;
revoke all on function public.reorder_checklist_items(uuid, uuid[]) from public, anon;
revoke all on function public.reorder_checklist_templates(uuid, uuid[]) from public, anon;
grant execute on function public.apply_checklist_template(uuid) to authenticated;
grant execute on function public.reorder_checklist_items(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_checklist_templates(uuid, uuid[]) to authenticated;

-- >>>>>>>>>> 20261109000007_integration_fixes.sql
-- =============================================================================
-- JurisFlow AI — Migration 007: ajustes de integração
--  * Parcelas de contratos em RASCUNHO não contam como vencidas nem como receita
--    prevista (status próprio 'rascunho' em installment_overview).
--  * "Hoje" calculado no fuso America/Sao_Paulo (o servidor do Supabase roda em UTC).
-- =============================================================================

create or replace view public.installment_overview with (security_invoker = true) as
select
  i.id, i.organization_id, i.contract_id, i.number, i.due_date, i.amount,
  coalesce(p.paid, 0)::numeric(12,2)                         as paid_amount,
  greatest(i.amount - coalesce(p.paid, 0), 0)::numeric(12,2) as remaining_amount,
  case
    when coalesce(p.paid, 0) >= i.amount then 'paga'
    when c.status = 'cancelado'           then 'cancelada'
    when c.status = 'rascunho'            then 'rascunho'
    when i.due_date < (now() at time zone 'America/Sao_Paulo')::date then 'vencida'
    when coalesce(p.paid, 0) > 0          then 'parcial'
    else 'a_vencer'
  end as status,
  c.client_id
from public.installments i
join public.contracts c on c.id = i.contract_id
left join lateral (
  select sum(amount) as paid from public.payments where installment_id = i.id
) p on true;

create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'   -- "hoje" e meses no fuso do escritório (igual às ferramentas da IA)
as $$
declare
  v jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

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
    'installments_overdue',(select coalesce(sum(remaining_amount),0) from installment_overview
                             where organization_id = p_org and status = 'vencida'),
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
                 'month', to_char(m, 'YYYY-MM'),
                 'opened', (select count(*) from demands where organization_id = p_org and date_trunc('month', opened_at) = m),
                 'closed', (select count(*) from demands where organization_id = p_org and status = 'concluida' and date_trunc('month', closed_at) = m),
                 'new_clients', (select count(*) from clients where organization_id = p_org and date_trunc('month', created_at) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'revenue_monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'received', (select coalesce(sum(amount),0) from payments where organization_id = p_org and date_trunc('month', paid_at) = m),
                 'expected', (select coalesce(sum(amount),0) from installment_overview where organization_id = p_org and status not in ('cancelada','rascunho') and date_trunc('month', due_date) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
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
grant execute on function public.dashboard_metrics(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- LGPD: anonimização também remove o nome do cliente dos textos livres de
-- demandas e tarefas vinculadas (títulos, descrições, observações).
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_name  text;
  v_first text;
  v_cpf   text;
  v_re    text;
begin
  select organization_id, full_name, cpf into v_org, v_name, v_cpf from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  -- Nome completo (e CPF, se houver) → marcador neutro, sem diferenciar maiúsculas.
  v_re := regexp_replace(btrim(v_name), '([.^$*+?()[\]{}|\\-])', '\\\1', 'g');
  update public.demands
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi'),
         notes       = regexp_replace(notes, v_re, 'Cliente anonimizado', 'gi'),
         next_action = regexp_replace(next_action, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  update public.tasks
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  if v_cpf is not null then
    update public.demands set description = replace(description, v_cpf, '[CPF removido]'),
                              notes = replace(notes, v_cpf, '[CPF removido]')
     where client_id = p_client;
    update public.tasks set description = replace(description, v_cpf, '[CPF removido]') where client_id = p_client;
  end if;
  -- Primeiro nome isolado também sai dos títulos (ex.: "SM Maria")
  v_first := split_part(btrim(v_name), ' ', 1);
  if char_length(v_first) >= 3 then
    v_re := '\m' || regexp_replace(v_first, '([.^$*+?()[\]{}|\\-])', '\\\1', 'g') || '\M';
    update public.demands set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
    update public.tasks   set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
  end if;

  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;
end $$;
revoke all on function public.anonymize_client(uuid) from public;
grant execute on function public.anonymize_client(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Auditoria de exportações (CSV/JSON). activity_logs continua sem INSERT direto;
-- esta função registra apenas metadados (o quê, quantos, se incluiu dados pessoais).
-- -----------------------------------------------------------------------------
create or replace function public.log_export(
  p_org uuid, p_resource text, p_row_count int, p_sensitive boolean default false, p_entity uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_resource !~ '^[a-z_]{2,40}$' then
    raise exception 'Recurso inválido' using errcode = 'P0001';
  end if;
  insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
  values (p_org, auth.uid(), 'exports', coalesce(p_entity, p_org), 'exported',
          jsonb_build_object('resource', p_resource,
                             'rows', greatest(coalesce(p_row_count, 0), 0),
                             'sensitive', coalesce(p_sensitive, false)));
end $$;
revoke all on function public.log_export(uuid, text, int, boolean, uuid) from public;
grant execute on function public.log_export(uuid, text, int, boolean, uuid) to authenticated;

-- >>>>>>>>>> 20261109000008_review_fixes.sql
-- =============================================================================
-- JurisFlow AI — Migration 008: correções da revisão independente
-- Não altera as migrations anteriores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LGPD: anonymize_client deixava o nome do cliente em activity_logs.
--    demands_audit/tasks_audit gravam o TÍTULO antigo e o novo (from/to), e os
--    títulos costumam conter o nome do cliente ("SM Maria Souza"). Pior: a
--    própria anonimização gerava um log novo com o título original em "from".
--    Agora, depois de limpar os textos, os valores de título dos logs das
--    demandas/tarefas do cliente viram apenas {"changed": true} (mesmo padrão
--    usado para os demais campos pessoais).
-- -----------------------------------------------------------------------------
create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_name  text;
  v_first text;
  v_cpf   text;
  v_re    text;
begin
  select organization_id, full_name, cpf into v_org, v_name, v_cpf from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  -- Nome completo (e CPF, se houver) → marcador neutro, sem diferenciar maiúsculas.
  v_re := regexp_replace(btrim(v_name), '([.^$*+?()[\]{}|\\-])', '\\\1', 'g');
  update public.demands
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi'),
         notes       = regexp_replace(notes, v_re, 'Cliente anonimizado', 'gi'),
         next_action = regexp_replace(next_action, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  update public.tasks
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  if v_cpf is not null then
    update public.demands set description = replace(description, v_cpf, '[CPF removido]'),
                              notes = replace(notes, v_cpf, '[CPF removido]')
     where client_id = p_client;
    update public.tasks set description = replace(description, v_cpf, '[CPF removido]') where client_id = p_client;
  end if;
  -- Primeiro nome isolado também sai dos títulos (ex.: "SM Maria")
  v_first := split_part(btrim(v_name), ' ', 1);
  if char_length(v_first) >= 3 then
    v_re := '\m' || regexp_replace(v_first, '([.^$*+?()[\]{}|\\-])', '\\\1', 'g') || '\M';
    update public.demands set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
    update public.tasks   set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
  end if;

  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;

  -- Histórico: remove os valores de título (antigos e novos) das demandas/tarefas
  -- do cliente, inclusive os logs gerados pelos UPDATEs acima.
  update public.activity_logs l
     set changes = l.changes || jsonb_build_object('title', jsonb_build_object('changed', true))
   where l.organization_id = v_org
     and l.changes ? 'title'
     and (
       (l.entity_type = 'demands' and l.entity_id in (select d.id from public.demands d where d.client_id = p_client))
       or (l.entity_type = 'tasks' and l.entity_id in (
             select t.id from public.tasks t
              where t.client_id = p_client
                 or t.demand_id in (select d.id from public.demands d where d.client_id = p_client)))
     );
end $$;
revoke all on function public.anonymize_client(uuid) from public, anon;
grant execute on function public.anonymize_client(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Defesa em profundidade: no Supabase, funções novas recebem EXECUTE para
--    anon por "default privileges" (não só via PUBLIC). log_export (007) só
--    revogava de PUBLIC. Ela já recusa quem não é membro, mas anon não precisa dela.
-- -----------------------------------------------------------------------------
revoke all on function public.log_export(uuid, text, int, boolean, uuid) from anon;

-- >>>>>>>>>> 20261109000009_ai_quota.sql
-- =============================================================================
-- JurisFlow AI — Migration 009: cota de uso da IA e anonimização do histórico
--  * ai_usage: registro de uso que o usuário NÃO consegue apagar (antes, excluir
--    conversas zerava a contagem e permitia custo ilimitado no provedor).
--  * ai_consume_quota(): checa e registra o uso de forma atômica, para as três
--    Edge Functions (assistant, import, compose).
--  * anonymize_client(): também remove o nome do cliente das mensagens do assistente.
-- =============================================================================

create table public.ai_usage (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  kind             text not null check (kind in ('assistant', 'import', 'compose')),
  created_at       timestamptz not null default now()
);
create index ai_usage_user_kind_idx on public.ai_usage(user_id, kind, created_at desc);

alter table public.ai_usage enable row level security;
-- leitura apenas do próprio uso; sem insert/update/delete direto (somente via RPC)
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
grant select on public.ai_usage to authenticated;
revoke all on public.ai_usage from anon;

create or replace function public.ai_consume_quota(p_org uuid, p_kind text, p_limit_per_hour int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_limit int := least(greatest(coalesce(p_limit_per_hour, 30), 1), 1000);
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_kind not in ('assistant', 'import', 'compose') then
    raise exception 'Tipo de uso inválido' using errcode = 'P0001';
  end if;
  -- serializa por usuário+tipo para evitar corrida entre requisições simultâneas
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':' || p_kind));
  select count(*) into v_count from public.ai_usage
   where user_id = auth.uid() and kind = p_kind and created_at > now() - interval '1 hour';
  if v_count >= v_limit then
    return false;
  end if;
  insert into public.ai_usage (organization_id, user_id, kind) values (p_org, auth.uid(), p_kind);
  return true;
end $$;
revoke all on function public.ai_consume_quota(uuid, text, int) from public, anon;
grant execute on function public.ai_consume_quota(uuid, text, int) to authenticated;

create or replace function public.anonymize_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_name  text;
  v_first text;
  v_cpf   text;
  v_re    text;
begin
  select organization_id, full_name, cpf into v_org, v_name, v_cpf from public.clients where id = p_client;
  if v_org is null or not public.has_org_role(v_org, array['admin']::public.member_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  -- Nome completo (e CPF, se houver) → marcador neutro, sem diferenciar maiúsculas.
  v_re := regexp_replace(btrim(v_name), '([.^$*+?()[\]{}|\\-])', '\\\1', 'g');
  update public.demands
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi'),
         notes       = regexp_replace(notes, v_re, 'Cliente anonimizado', 'gi'),
         next_action = regexp_replace(next_action, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  update public.tasks
     set title       = left(regexp_replace(title, v_re, 'Cliente anonimizado', 'gi'), 160),
         description = regexp_replace(description, v_re, 'Cliente anonimizado', 'gi')
   where client_id = p_client;
  if v_cpf is not null then
    update public.demands set description = replace(description, v_cpf, '[CPF removido]'),
                              notes = replace(notes, v_cpf, '[CPF removido]')
     where client_id = p_client;
    update public.tasks set description = replace(description, v_cpf, '[CPF removido]') where client_id = p_client;
  end if;
  -- Primeiro nome isolado também sai dos títulos (ex.: "SM Maria")
  v_first := split_part(btrim(v_name), ' ', 1);
  if char_length(v_first) >= 3 then
    v_re := '\m' || regexp_replace(v_first, '([.^$*+?()[\]{}|\\-])', '\\\1', 'g') || '\M';
    update public.demands set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
    update public.tasks   set title = left(regexp_replace(title, v_re, 'Cliente', 'gi'), 160) where client_id = p_client;
  end if;

  update public.clients
     set full_name = 'Cliente anonimizado', cpf = null, phone = null, email = null,
         birth_date = null, address = null, notes = null,
         status = 'arquivado', anonymized_at = now()
   where id = p_client;

  -- Histórico: remove os valores de título (antigos e novos) das demandas/tarefas
  -- do cliente, inclusive os logs gerados pelos UPDATEs acima.
  update public.activity_logs l
     set changes = l.changes || jsonb_build_object('title', jsonb_build_object('changed', true))
   where l.organization_id = v_org
     and l.changes ? 'title'
     and (
       (l.entity_type = 'demands' and l.entity_id in (select d.id from public.demands d where d.client_id = p_client))
       or (l.entity_type = 'tasks' and l.entity_id in (
             select t.id from public.tasks t
              where t.client_id = p_client
                 or t.demand_id in (select d.id from public.demands d where d.client_id = p_client)))
     );

  -- Conversas com o assistente: troca o nome do cliente nas mensagens gravadas,
  -- para que o histórico não volte a enviá-lo ao provedor de IA.
  if char_length(btrim(v_name)) >= 3 then
    update public.ai_messages
       set content = regexp_replace(content,
                       regexp_replace(btrim(v_name), '([.^$*+?()[\]{}|\\-])', '\\\1', 'g'),
                       'Cliente anonimizado', 'gi')
     where organization_id = v_org and content ilike '%' || btrim(v_name) || '%';
  end if;
end $$;
revoke all on function public.anonymize_client(uuid) from public, anon;
grant execute on function public.anonymize_client(uuid) to authenticated;

-- >>>>>>>>>> 20261109000010_pre_launch_hardening.sql
-- -----------------------------------------------------------------------------
-- Endurecimento pré-lançamento: histórico de IA de ex-membros e consistência
-- de escritório nas mensagens.
-- -----------------------------------------------------------------------------

-- Excluir uma conversa exige continuar sendo membro ativo do escritório.
drop policy if exists ai_conv_delete on public.ai_conversations;
create policy ai_conv_delete on public.ai_conversations for delete to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

-- A conversa referenciada pela mensagem precisa ser do mesmo escritório,
-- do mesmo usuário e ele ainda precisa ser membro ativo.
drop policy if exists ai_msg_insert on public.ai_messages;
create policy ai_msg_insert on public.ai_messages for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_org_member(organization_id)
    and exists (select 1 from public.ai_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid()
                   and c.organization_id = ai_messages.organization_id)
  );

-- >>>>>>>>>> 20261111000001_today_panel.sql
-- =============================================================================
-- JurisFlow AI — Migration 011: painel "O que fazer hoje"
--  * dashboard_metrics ganha contadores de próximas ações vencidas e de hoje.
--  * Mesma assinatura/chaves anteriores de 20261109000007_integration_fixes.sql.
-- =============================================================================

create or replace function public.dashboard_metrics(p_org uuid)
returns jsonb language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'   -- "hoje" e meses no fuso do escritório (igual às ferramentas da IA)
as $$
declare
  v jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'clients_total',       (select count(*) from clients where organization_id = p_org and anonymized_at is null),
    'demands_in_progress', (select count(*) from demands where organization_id = p_org and status not in ('concluida','cancelada')),
    'demands_done',        (select count(*) from demands where organization_id = p_org and status = 'concluida'),
    'demands_waiting_docs',(select count(*) from demands d join workflow_stages s on s.id = d.stage_id
                             where d.organization_id = p_org and s.is_waiting_docs and d.status not in ('concluida','cancelada')),
    'tasks_pending',       (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento')),
    'tasks_overdue',       (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento') and due_date < current_date),
    'next_actions_overdue',(select count(*) from demands where organization_id = p_org
                             and status not in ('concluida','cancelada') and next_action_date < current_date),
    'next_actions_today',  (select count(*) from demands where organization_id = p_org
                             and status not in ('concluida','cancelada') and next_action_date = current_date),
    'deadlines_upcoming',  (select count(*) from tasks where organization_id = p_org and status in ('pendente','em_andamento')
                             and due_date between current_date and current_date + 7),
    'fees_expected',       (select coalesce(sum(total_amount),0) from contracts where organization_id = p_org and status in ('ativo','quitado')),
    'fees_received',       (select coalesce(sum(p.amount),0) from payments p join contracts c on c.id = p.contract_id
                             where p.organization_id = p_org and c.status <> 'cancelado'),
    'installments_overdue',(select coalesce(sum(remaining_amount),0) from installment_overview
                             where organization_id = p_org and status = 'vencida'),
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
                 'month', to_char(m, 'YYYY-MM'),
                 'opened', (select count(*) from demands where organization_id = p_org and date_trunc('month', opened_at) = m),
                 'closed', (select count(*) from demands where organization_id = p_org and status = 'concluida' and date_trunc('month', closed_at) = m),
                 'new_clients', (select count(*) from clients where organization_id = p_org and date_trunc('month', created_at) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'revenue_monthly', (
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m, 'YYYY-MM'),
                 'received', (select coalesce(sum(amount),0) from payments where organization_id = p_org and date_trunc('month', paid_at) = m),
                 'expected', (select coalesce(sum(amount),0) from installment_overview where organization_id = p_org and status not in ('cancelada','rascunho') and date_trunc('month', due_date) = m)
               ) order by m)
          from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
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
grant execute on function public.dashboard_metrics(uuid) to authenticated;

-- >>>>>>>>>> 20261111000002_agenda.sql
-- =============================================================================
-- JurisFlow AI — Migration 012: agenda unificada
--  * Um lugar só para ver prazos: tarefas, próximas ações e parcelas.
--  * Somente leitura; não inventa eventos nem calcula prazo jurídico.
--  * Isolamento por escritório conferido explicitamente além da RLS.
-- =============================================================================

create or replace function public.agenda_items(
  p_org uuid,
  p_from date,
  p_to date,
  p_only_mine boolean default false
)
returns table (
  kind text,
  id uuid,
  title text,
  date date,
  overdue boolean,
  status text,
  client_id uuid,
  demand_id uuid,
  assignee_id uuid,
  amount numeric,
  contract_id uuid
)
language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'   -- "hoje" no fuso do escritório
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  if (p_to - p_from) > 62 then
    raise exception 'Intervalo máximo de 62 dias' using errcode = '22023';
  end if;

  return query
  with items as (
    -- Tarefas abertas com prazo no intervalo (ou vencidas, quando o intervalo
    -- começa em hoje ou antes — assim "Hoje" e "Atrasados" as mostram).
    select 'task'::text as kind,
           t.id,
           t.title,
           t.due_date as date,
           (t.due_date < current_date) as overdue,
           t.status::text as status,
           coalesce(t.client_id, d.client_id) as client_id,
           t.demand_id,
           t.assignee_id,
           null::numeric as amount,
           null::uuid as contract_id
      from public.tasks t
      left join public.demands d
        on d.id = t.demand_id and d.organization_id = t.organization_id
     where t.organization_id = p_org
       and t.status in ('pendente', 'em_andamento')
       and t.due_date is not null
       and ((t.due_date between p_from and p_to)
            or (t.due_date < current_date and p_from <= current_date))
       and (not p_only_mine or t.assignee_id = auth.uid())

    union all

    -- Próximas ações de demandas não concluídas/canceladas.
    select 'next_action'::text as kind,
           d.id,
           coalesce(nullif(btrim(d.next_action), ''), 'Próxima ação') as title,
           d.next_action_date as date,
           (d.next_action_date < current_date) as overdue,
           d.status::text as status,
           d.client_id,
           d.id as demand_id,
           d.responsible_id as assignee_id,
           null::numeric as amount,
           null::uuid as contract_id
      from public.demands d
     where d.organization_id = p_org
       and d.status not in ('concluida', 'cancelada')
       and d.next_action_date is not null
       and ((d.next_action_date between p_from and p_to)
            or (d.next_action_date < current_date and p_from <= current_date))
       and (not p_only_mine or d.responsible_id = auth.uid())

    union all

    -- Parcelas em aberto (parcelas não pertencem a um responsável).
    select 'installment'::text as kind,
           io.id,
           'Parcela ' || io.number::text as title,
           io.due_date as date,
           (io.due_date < current_date) as overdue,
           io.status::text as status,
           io.client_id,
           null::uuid as demand_id,
           null::uuid as assignee_id,
           io.remaining_amount as amount,
           io.contract_id
      from public.installment_overview io
     where io.organization_id = p_org
       and io.status in ('a_vencer', 'parcial', 'vencida')
       and ((io.due_date between p_from and p_to)
            or (io.due_date < current_date and p_from <= current_date))
       and not p_only_mine
  )
  select i.kind, i.id, i.title, i.date, i.overdue, i.status, i.client_id,
         i.demand_id, i.assignee_id, i.amount, i.contract_id
    from items i
   order by i.date, i.kind, i.title, i.id;
end $$;

revoke all on function public.agenda_items(uuid, date, date, boolean) from public;
grant execute on function public.agenda_items(uuid, date, date, boolean) to authenticated;

-- >>>>>>>>>> 20261111000003_ai_proposals.sql
-- =============================================================================
-- JurisFlow AI — Migration 013: propostas da IA e confirmação pelo usuário
--  * A IA só PROPÕE ações; nada é gravado por ela.
--  * ai_messages.proposals guarda as propostas pendentes (jsonb, nulo sem propostas).
--  * ai_proposal_done() registra a decisão do DONO da conversa (confirmar/descartar),
--    valida vínculo com o escritório e grava auditoria só na confirmação,
--    com metadados (kind/proposal_id) — nunca os textos da proposta.
-- =============================================================================

alter table public.ai_messages add column proposals jsonb;

create or replace function public.ai_proposal_done(
  p_message uuid,
  p_proposal text,
  p_status text,
  p_entity uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_owner   uuid;
  v_role    public.ai_role;
  v_props   jsonb;
  v_elem    jsonb;
  v_updated jsonb;
begin
  if p_status is null or p_status not in ('confirmada', 'descartada') then
    raise exception 'Status inválido: use confirmada ou descartada' using errcode = '22023';
  end if;

  -- Mensagem + conversa (dono = ai_conversations.user_id) + escritório.
  select m.organization_id, c.user_id, m.role, coalesce(m.proposals, '[]'::jsonb)
    into v_org, v_owner, v_role, v_props
    from public.ai_messages m
    join public.ai_conversations c
      on c.id = m.conversation_id
     and c.organization_id = m.organization_id
   where m.id = p_message;

  if v_org is null
     or v_role <> 'assistant'
     or v_owner <> auth.uid()
     or not public.is_org_member(v_org) then
    raise exception 'Sem permissão para confirmar esta proposta' using errcode = '42501';
  end if;

  select elem into v_elem
    from jsonb_array_elements(v_props) elem
   where elem->>'id' = p_proposal
   limit 1;

  if v_elem is null then
    raise exception 'Proposta não encontrada' using errcode = '22023';
  end if;

  if coalesce(v_elem->>'status', 'pendente') <> 'pendente' then
    raise exception 'Proposta já resolvida' using errcode = '22023';
  end if;

  select jsonb_agg(
           case
             when elem->>'id' = p_proposal then jsonb_set(elem, '{status}', to_jsonb(p_status))
             else elem
           end
           order by ord
         )
    into v_updated
    from jsonb_array_elements(v_props) with ordinality as t(elem, ord);

  update public.ai_messages set proposals = v_updated where id = p_message;

  if p_status = 'confirmada' then
    insert into public.activity_logs (organization_id, actor_id, entity_type, entity_id, action, changes)
    values (
      v_org,
      auth.uid(),
      'ai_proposals',
      coalesce(p_entity, p_message),
      'ai_confirmed',
      jsonb_build_object('kind', v_elem->>'kind', 'proposal_id', p_proposal)
    );
  end if;
end $$;
revoke all on function public.ai_proposal_done(uuid, text, text, uuid) from public, anon;
grant execute on function public.ai_proposal_done(uuid, text, text, uuid) to authenticated;

-- >>>>>>>>>> 20261111000004_client_overview.sql
-- =============================================================================
-- JurisFlow AI — Migration 014: ficha 360° do cliente
--  * Um único retorno jsonb com o que está pendente para um cliente.
--  * Somente leitura, com dados reais e sem GED; RLS continua valendo
--    (security invoker) e o escritório é conferido pela visibilidade do cliente.
--  * "Hoje" no fuso do escritório, igual ao painel e à agenda.
-- =============================================================================

create or replace function public.client_overview(p_client uuid)
returns jsonb
language plpgsql stable security invoker
  set search_path = public
  set timezone = 'America/Sao_Paulo'
as $$
declare
  v_org uuid;
  v_last_activity_at timestamptz;
begin
  -- A RLS de clients garante que só membros do escritório enxergam o cliente.
  select c.organization_id into v_org
    from public.clients c
   where c.id = p_client;

  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  -- Última movimentação: cliente, demandas e tarefas dele.
  select max(al.created_at) into v_last_activity_at
    from public.activity_logs al
   where al.organization_id = v_org
     and (
       (al.entity_type = 'clients' and al.entity_id = p_client)
       or (al.entity_type = 'demands' and al.entity_id in (
             select d.id from public.demands d
              where d.organization_id = v_org and d.client_id = p_client))
       or (al.entity_type = 'tasks' and al.entity_id in (
             select t.id from public.tasks t
              where t.organization_id = v_org
                and (t.client_id = p_client
                     or t.demand_id in (select d.id from public.demands d
                                         where d.organization_id = v_org and d.client_id = p_client))))
     );

  return jsonb_build_object(
    'open_demands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id,
               'title', x.title,
               'status', x.status,
               'stage_name', x.stage_name,
               'category_name', x.category_name,
               'next_action', x.next_action,
               'next_action_date', x.next_action_date,
               'next_action_overdue', x.next_action_overdue,
               'checklist_pending', x.checklist_pending,
               'checklist_total', x.checklist_total,
               'days_in_stage', x.days_in_stage
             ) order by x.created_at desc, x.id)
        from (
          select d.id,
                 d.title,
                 d.status::text as status,
                 coalesce(s.name, '') as stage_name,
                 coalesce(cat.name, '') as category_name,
                 d.next_action,
                 d.next_action_date,
                 coalesce(d.next_action_date < current_date, false) as next_action_overdue,
                 (select count(*) from public.demand_checklist_items i
                   where i.demand_id = d.id and not i.done)::int as checklist_pending,
                 (select count(*) from public.demand_checklist_items i
                   where i.demand_id = d.id)::int as checklist_total,
                 (current_date
                    - (d.stage_changed_at at time zone 'America/Sao_Paulo')::date)::int as days_in_stage,
                 d.created_at
            from public.demands d
            left join public.workflow_stages s on s.id = d.stage_id
            left join public.demand_categories cat on cat.id = d.category_id
           where d.organization_id = v_org
             and d.client_id = p_client
             and d.status not in ('concluida', 'cancelada')
           order by d.created_at desc, d.id
           limit 20
        ) x
    ), '[]'::jsonb),

    'checklist_pending_items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'demand_id', x.demand_id,
               'demand_title', x.demand_title,
               'label', x.label
             ) order by x.created_at, x.demand_id, x.position, x.item_id)
        from (
          select d.id as demand_id,
                 d.title as demand_title,
                 i.label,
                 i.position,
                 i.id as item_id,
                 d.created_at
            from public.demand_checklist_items i
            join public.demands d
              on d.id = i.demand_id and d.organization_id = i.organization_id
           where d.organization_id = v_org
             and d.client_id = p_client
             and d.status not in ('concluida', 'cancelada')
             and not i.done
           order by d.created_at, d.id, i.position, i.id
           limit 15
        ) x
    ), '[]'::jsonb),

    'tasks', (
      select jsonb_build_object(
               'open', count(*) filter (where t.status in ('pendente', 'em_andamento')),
               'overdue', count(*) filter (
                 where t.status in ('pendente', 'em_andamento') and t.due_date < current_date),
               'next_due_date', min(t.due_date) filter (
                 where t.status in ('pendente', 'em_andamento'))
             )
        from public.tasks t
       where t.organization_id = v_org
         and t.client_id = p_client
    ),

    'finance', (
      select jsonb_build_object(
               'open_amount', coalesce(sum(io.remaining_amount) filter (
                 where io.status in ('a_vencer', 'parcial', 'vencida')), 0),
               'overdue_amount', coalesce(sum(io.remaining_amount) filter (
                 where io.status = 'vencida'), 0),
               'overdue_count', count(*) filter (where io.status = 'vencida'),
               'next_due_date', min(io.due_date) filter (
                 where io.status in ('a_vencer', 'parcial', 'vencida'))
             )
        from public.installment_overview io
       where io.organization_id = v_org
         and io.client_id = p_client
    ),

    'last_activity_at', v_last_activity_at
  );
end $$;

revoke all on function public.client_overview(uuid) from public;
grant execute on function public.client_overview(uuid) to authenticated;

-- >>>>>>>>>> 20261112000001_stage_history.sql
-- =============================================================================
-- JurisFlow AI — Migration L6: histórico de etapas e métricas operacionais
-- =============================================================================
-- * demand_stage_history guarda as passagens de cada demanda pelas etapas.
--   A escrita é feita apenas pelo trigger (SECURITY DEFINER); membros só leem.
-- * operational_metrics devolve gargalos por etapa e carga por responsável
--   calculados no banco, com dados reais e RLS do usuário (SECURITY INVOKER).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Histórico de etapas
-- -----------------------------------------------------------------------------
create table public.demand_stage_history (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  demand_id        uuid not null,
  stage_id         uuid,
  entered_at       timestamptz not null default now(),
  left_at          timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, demand_id)
    references public.demands(organization_id, id) on delete cascade
);

create index demand_stage_history_org_stage_idx
  on public.demand_stage_history(organization_id, stage_id, left_at);
create index demand_stage_history_demand_idx
  on public.demand_stage_history(demand_id, entered_at);
-- Uma única passagem aberta por demanda.
create unique index demand_stage_history_open_uidx
  on public.demand_stage_history(demand_id) where left_at is null;

alter table public.demand_stage_history enable row level security;

-- Membros leem; ninguém escreve direto (só o trigger SECURITY DEFINER).
create policy demand_stage_history_select on public.demand_stage_history for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.demand_stage_history from anon, authenticated;
grant select on public.demand_stage_history to authenticated;

-- -----------------------------------------------------------------------------
-- Trigger: mantém o histórico sincronizado com a etapa/status da demanda
-- -----------------------------------------------------------------------------
create or replace function public.demand_stage_history_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('concluida', 'cancelada') then
      insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
      values (new.organization_id, new.id, new.stage_id, new.stage_changed_at);
    end if;
    return new;
  end if;

  -- Conclusão/cancelamento: fecha a passagem aberta e não abre outra.
  if new.status in ('concluida', 'cancelada')
     and (old.status not in ('concluida', 'cancelada')
          or new.stage_id is distinct from old.stage_id) then
    update public.demand_stage_history
       set left_at = coalesce(new.closed_at, now())
     where organization_id = new.organization_id and demand_id = new.id and left_at is null;
    return new;
  end if;

  -- Mudança de etapa: fecha a passagem anterior e abre a nova.
  if new.stage_id is distinct from old.stage_id then
    update public.demand_stage_history
       set left_at = now()
     where organization_id = new.organization_id and demand_id = new.id and left_at is null;
    if new.status not in ('concluida', 'cancelada') then
      insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
      values (new.organization_id, new.id, new.stage_id, new.stage_changed_at);
    end if;
    return new;
  end if;

  -- Reabertura: abre uma nova passagem na etapa atual.
  if old.status in ('concluida', 'cancelada')
     and new.status not in ('concluida', 'cancelada') then
    insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
    select new.organization_id, new.id, new.stage_id, now()
     where not exists (
       select 1 from public.demand_stage_history
        where demand_id = new.id and left_at is null
     );
  end if;

  return new;
end $$;

create trigger demands_stage_history_after_insert after insert on public.demands
  for each row execute function public.demand_stage_history_sync();
create trigger demands_stage_history_after_update after update on public.demands
  for each row execute function public.demand_stage_history_sync();

revoke all on function public.demand_stage_history_sync() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Backfill: demandas já abertas ganham a passagem atual
-- -----------------------------------------------------------------------------
insert into public.demand_stage_history (organization_id, demand_id, stage_id, entered_at)
select d.organization_id, d.id, d.stage_id, d.stage_changed_at
  from public.demands d
 where d.status not in ('concluida', 'cancelada');

-- -----------------------------------------------------------------------------
-- RPC: métricas operacionais (gargalos e carga)
-- -----------------------------------------------------------------------------
create or replace function public.operational_metrics(p_org uuid, p_days int default 90)
returns jsonb language plpgsql stable security invoker
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
declare
  v_stages      jsonb;
  v_bottlenecks jsonb;
  v_workload    jsonb;
begin
  if not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;
  if p_days is null or p_days < 7 or p_days > 365 then
    raise exception 'O período deve estar entre 7 e 365 dias' using errcode = '22023';
  end if;

  with open_hist as (
    select h.stage_id,
           count(*)::int as open_now,
           round(avg(extract(epoch from (now() - h.entered_at)) / 86400.0)::numeric, 1) as avg_age_open_days,
           ceil(max(extract(epoch from (now() - h.entered_at)) / 86400.0))::int as oldest_open_days
      from public.demand_stage_history h
      join public.demands d
        on d.organization_id = h.organization_id and d.id = h.demand_id
     where h.organization_id = p_org
       and h.left_at is null
       and d.status not in ('concluida', 'cancelada')
     group by h.stage_id
  ),
  completed as (
    select h.stage_id,
           count(*)::int as passes_completed,
           round(avg(extract(epoch from (h.left_at - h.entered_at)) / 86400.0)::numeric, 1) as avg_days_completed
      from public.demand_stage_history h
     where h.organization_id = p_org
       and h.left_at is not null
       and h.left_at >= now() - make_interval(days => p_days)
     group by h.stage_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', s.name,
           'category_name', c.name,
           'position', s.position,
           'open_now', coalesce(o.open_now, 0),
           'avg_age_open_days', o.avg_age_open_days,
           'oldest_open_days', o.oldest_open_days,
           'avg_days_completed', k.avg_days_completed,
           'passes_completed', coalesce(k.passes_completed, 0)
         ) order by c.sort_order, c.name, s.position, s.id), '[]'::jsonb)
    into v_stages
    from public.workflow_stages s
    join public.demand_categories c
      on c.organization_id = s.organization_id and c.id = s.category_id
    left join open_hist o on o.stage_id = s.id
    left join completed k on k.stage_id = s.id
   where s.organization_id = p_org;

  select coalesce(jsonb_agg(e order by b.open_now desc, b.avg_age desc nulls last), '[]'::jsonb)
    into v_bottlenecks
    from (
      select e,
             (e->>'open_now')::int as open_now,
             (e->>'avg_age_open_days')::numeric as avg_age
        from jsonb_array_elements(v_stages) e
       where (e->>'open_now')::int > 0
       order by (e->>'open_now')::int desc, (e->>'avg_age_open_days')::numeric desc nulls last
       limit 5
    ) b;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', w.user_id,
           'name', w.name,
           'open_demands', w.open_demands,
           'open_tasks', w.open_tasks,
           'overdue_tasks', w.overdue_tasks,
           'next_actions_overdue', w.next_actions_overdue
         ) order by w.overdue_tasks desc, w.open_tasks desc, w.name), '[]'::jsonb)
    into v_workload
    from (
      select m.user_id,
             coalesce(nullif(pr.full_name, ''), split_part(pr.email::text, '@', 1), 'Membro') as name,
             (select count(*)::int from public.demands d
               where d.organization_id = m.organization_id and d.responsible_id = m.user_id
                 and d.status not in ('concluida', 'cancelada')) as open_demands,
             (select count(*)::int from public.tasks t
               where t.organization_id = m.organization_id and t.assignee_id = m.user_id
                 and t.status in ('pendente', 'em_andamento')) as open_tasks,
             (select count(*)::int from public.tasks t
               where t.organization_id = m.organization_id and t.assignee_id = m.user_id
                 and t.status in ('pendente', 'em_andamento')
                 and t.due_date < current_date) as overdue_tasks,
             (select count(*)::int from public.demands d
               where d.organization_id = m.organization_id and d.responsible_id = m.user_id
                 and d.status not in ('concluida', 'cancelada')
                 and d.next_action_date < current_date) as next_actions_overdue
        from public.organization_members m
        join public.profiles pr on pr.id = m.user_id
       where m.organization_id = p_org and m.active
    ) w;

  return jsonb_build_object(
    'stages', v_stages,
    'bottlenecks', v_bottlenecks,
    'workload', v_workload
  );
end $$;

revoke all on function public.operational_metrics(uuid, int) from public, anon;
grant execute on function public.operational_metrics(uuid, int) to authenticated;

-- >>>>>>>>>> 20261112000002_notifications.sql
-- =============================================================================
-- JurisFlow AI — Migration L7: avisos no app e alertas automáticos
-- =============================================================================
-- * public.notifications guarda os avisos de cada pessoa (poucos e úteis).
-- * O gerador diário (SECURITY DEFINER) calcula tudo das tabelas reais; não há
--   dado fictício nem nomes de clientes no texto (só contagens).
-- * A pessoa só lê as próprias notificações e marca leitura pelas RPCs; não
--   consegue inserir, alterar o texto nem chamar o gerador.
-- =============================================================================

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null,
  kind             text not null check (kind in (
                     'resumo_diario',
                     'tarefas_atrasadas',
                     'prazos_hoje',
                     'proximas_acoes_vencidas',
                     'demandas_paradas'
                   )),
  title            text not null check (char_length(title) <= 160),
  body             text check (char_length(body) <= 600),
  link             text check (char_length(link) <= 200 and link like '/%'),
  ref_date         date not null,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id, kind, ref_date),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index notifications_user_read_created_idx
  on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Gerador diário (cron / postgres). Revogado de authenticated: só o agendador.
-- -----------------------------------------------------------------------------
create or replace function public.generate_daily_notifications(
  p_day date default (now() at time zone 'America/Sao_Paulo')::date
)
returns void language plpgsql security definer
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
declare
  m             record;
  v_day         date := coalesce(p_day, (now() at time zone 'America/Sao_Paulo')::date);
  v_tasks_late  int;
  v_due_today   int;
  v_next_late   int;
  v_stalled     int;
  v_parts       text[];
  v_body        text;
begin
  -- Retenção: lidas há mais de 60 dias e não lidas há mais de 120 dias.
  delete from public.notifications
   where (read_at is not null and read_at < now() - interval '60 days')
      or (read_at is null and created_at < now() - interval '120 days');

  for m in
    select om.organization_id, om.user_id, om.role
      from public.organization_members om
     where om.active
  loop
    select count(*)::int into v_tasks_late
      from public.tasks t
     where t.organization_id = m.organization_id
       and t.assignee_id = m.user_id
       and t.status in ('pendente', 'em_andamento')
       and t.due_date < v_day;

    select count(*)::int into v_due_today
      from public.tasks t
     where t.organization_id = m.organization_id
       and t.assignee_id = m.user_id
       and t.status in ('pendente', 'em_andamento')
       and t.due_date = v_day;

    select count(*)::int into v_next_late
      from public.demands d
     where d.organization_id = m.organization_id
       and d.responsible_id = m.user_id
       and d.status not in ('concluida', 'cancelada')
       and d.next_action_date < v_day;

    v_stalled := 0;
    if m.role = 'admin' then
      select count(*)::int into v_stalled
        from public.demands d
       where d.organization_id = m.organization_id
         and d.status not in ('concluida', 'cancelada')
         and (d.stage_changed_at at time zone 'America/Sao_Paulo')::date <= v_day - 15;
    end if;

    if v_tasks_late > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'tarefas_atrasadas',
              v_tasks_late || case when v_tasks_late = 1 then ' tarefa atrasada' else ' tarefas atrasadas' end,
              '/tarefas', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_due_today > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'prazos_hoje',
              v_due_today || case when v_due_today = 1 then ' prazo hoje' else ' prazos hoje' end,
              '/agenda?v=hoje', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_next_late > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'proximas_acoes_vencidas',
              v_next_late || case
                when v_next_late = 1 then ' próxima ação vencida'
                else ' próximas ações vencidas'
              end,
              '/agenda?v=atrasados', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_stalled > 0 then
      insert into public.notifications (organization_id, user_id, kind, title, link, ref_date)
      values (m.organization_id, m.user_id, 'demandas_paradas',
              v_stalled || case when v_stalled = 1 then ' demanda parada' else ' demandas paradas' end,
              '/relatorios', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;

    if v_tasks_late > 0 or v_due_today > 0 or v_next_late > 0 or v_stalled > 0 then
      v_parts := array[]::text[];
      if v_due_today > 0 then
        v_parts := array_append(v_parts, v_due_today || case when v_due_today = 1 then ' prazo' else ' prazos' end);
      end if;
      if v_tasks_late > 0 then
        v_parts := array_append(v_parts,
          v_tasks_late || case when v_tasks_late = 1 then ' tarefa atrasada' else ' tarefas atrasadas' end);
      end if;
      if v_next_late > 0 then
        v_parts := array_append(v_parts,
          v_next_late || case
            when v_next_late = 1 then ' próxima ação vencida'
            else ' próximas ações vencidas'
          end);
      end if;
      if v_stalled > 0 then
        v_parts := array_append(v_parts,
          v_stalled || case when v_stalled = 1 then ' demanda parada' else ' demandas paradas' end);
      end if;
      v_body := 'Hoje: ' || array_to_string(v_parts, ', ') || '.';

      insert into public.notifications (organization_id, user_id, kind, title, body, link, ref_date)
      values (m.organization_id, m.user_id, 'resumo_diario', 'Resumo do dia', v_body, '/', v_day)
      on conflict (organization_id, user_id, kind, ref_date) do nothing;
    end if;
  end loop;
end $$;

revoke all on function public.generate_daily_notifications(date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Leitura: RPCs marcam só as notificações do próprio usuário.
-- -----------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications
       set read_at = now()
     where id = any(coalesce(p_ids, array[]::uuid[]))
       and user_id = auth.uid()
       and read_at is null
       and public.is_org_member(organization_id)
    returning 1
  )
  select count(*)::int into v_count from updated;

  return v_count;
end $$;

create or replace function public.mark_all_notifications_read(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório' using errcode = '42501';
  end if;

  with updated as (
    update public.notifications
       set read_at = now()
     where organization_id = p_org
       and user_id = auth.uid()
       and read_at is null
    returning 1
  )
  select count(*)::int into v_count from updated;

  return v_count;
end $$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Agendamento diário às 07:00 de São Paulo (10:00 UTC).
-- Tolerante a ambientes sem pg_cron (ex.: PostgreSQL simples dos testes).
-- -----------------------------------------------------------------------------
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron indisponível (%); agendamento ignorado', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute $sql$
        select cron.unschedule('jurisflow-notificacoes-diarias')
         where exists (select 1 from cron.job where jobname = 'jurisflow-notificacoes-diarias')
      $sql$;
    exception when others then
      raise notice 'não foi possível remover agendamento anterior: %', sqlerrm;
    end;

    begin
      execute $sql$
        select cron.schedule(
          'jurisflow-notificacoes-diarias',
          '0 10 * * *',
          'select public.generate_daily_notifications()'
        )
      $sql$;
    exception when others then
      raise notice 'não foi possível agendar as notificações diárias: %', sqlerrm;
    end;
  end if;
end $$;

-- >>>>>>>>>> 20261112000003_invite_link.sql
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

-- >>>>>>>>>> 20261112000004_task_templates.sql
-- =============================================================================
-- JurisFlow AI — L9: demanda nasce pronta
-- =============================================================================
-- * task_templates: tarefas sugeridas por categoria (editáveis). offset_days é
--   um deslocamento em dias a partir da criação da demanda, usado apenas para
--   SUGERIR datas internas de organização — não são prazos jurídicos.
-- * kickoff_demand: aplica o checklist-modelo e cria as tarefas confirmadas pela
--   pessoa ao criar a demanda (tudo ou nada, respeitando a RLS de quem chama).
-- =============================================================================

create table public.task_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  category_id      uuid not null,
  title            text not null check (char_length(btrim(title)) between 3 and 160),
  offset_days      int check (offset_days is null or offset_days between 0 and 365),
  priority         public.priority_level not null default 'media',
  position         int not null default 0 check (position >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id)
    references public.demand_categories(organization_id, id) on delete cascade
);
create index task_templates_category_idx on public.task_templates(category_id, position);

create or replace function public.task_templates_before_write()
returns trigger language plpgsql as $$
begin
  new.title := btrim(new.title);
  return new;
end $$;

create trigger task_templates_trim before insert or update on public.task_templates
  for each row execute function public.task_templates_before_write();
create trigger task_templates_updated_at before update on public.task_templates
  for each row execute function public.set_updated_at();
create trigger task_templates_no_org_change before update on public.task_templates
  for each row execute function public.prevent_org_change();

-- RLS: ler membros; escrever admin/advogado (igual ao checklist-modelo)
alter table public.task_templates enable row level security;

create policy task_templates_select on public.task_templates for select to authenticated
  using (public.is_org_member(organization_id));
create policy task_templates_insert on public.task_templates for insert to authenticated
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy task_templates_update on public.task_templates for update to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]))
  with check (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));
create policy task_templates_delete on public.task_templates for delete to authenticated
  using (public.has_org_role(organization_id, '{admin,advogado}'::public.member_role[]));

revoke all on public.task_templates from anon;
grant select, insert, update, delete on public.task_templates to authenticated;

-- Reordena os modelos de tarefa de uma categoria (mesmo padrão do checklist).
create or replace function public.reorder_task_templates(p_category uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare i int;
begin
  if (select count(*) from public.task_templates where category_id = p_category)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'A lista de modelos está desatualizada. Recarregue a página.' using errcode = 'P0001';
  end if;
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.task_templates set position = i - 1 where id = p_ids[i] and category_id = p_category;
    if not found then raise exception 'Item inválido ou sem permissão.' using errcode = '42501'; end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- kickoff_demand (SECURITY INVOKER → RLS do usuário continua valendo)
-- p_tasks: [{ title, due_date (AAAA-MM-DD|null), priority, assignee_id|null }], máx. 20
-- -----------------------------------------------------------------------------
create or replace function public.kickoff_demand(p_demand uuid, p_checklist boolean, p_tasks jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_org     uuid;
  v_client  uuid;
  v_items   int := 0;
  v_created int := 0;
  v_tasks   jsonb := coalesce(p_tasks, '[]'::jsonb);
  t         jsonb;
  v_title   text;
  v_due     date;
  v_prio    public.priority_level;
  v_assign  uuid;
begin
  select organization_id, client_id into v_org, v_client from public.demands where id = p_demand;
  if v_org is null or not public.is_org_member(v_org) then
    raise exception 'Demanda não encontrada ou sem permissão.' using errcode = '42501';
  end if;

  if jsonb_typeof(v_tasks) <> 'array' then
    raise exception 'A lista de tarefas é inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_tasks) > 20 then
    raise exception 'No máximo 20 tarefas por vez.' using errcode = '22023';
  end if;

  if coalesce(p_checklist, false) then
    v_items := public.apply_checklist_template(p_demand);
  end if;

  for t in select value from jsonb_array_elements(v_tasks) loop
    begin
      if jsonb_typeof(t) <> 'object' then raise exception 'item inválido' using errcode = '22023'; end if;
      v_title := btrim(coalesce(t->>'title', ''));
      if char_length(v_title) not between 3 and 160 then
        raise exception 'O título da tarefa deve ter entre 3 e 160 caracteres.' using errcode = '22023';
      end if;
      v_due := nullif(t->>'due_date', '')::date;
      v_prio := coalesce(nullif(t->>'priority', ''), 'media')::public.priority_level;
      v_assign := nullif(t->>'assignee_id', '')::uuid;
    exception
      when sqlstate '22023' then raise;
      when others then
        raise exception 'Dados da tarefa inválidos (data, prioridade ou responsável).' using errcode = '22023';
    end;

    insert into public.tasks (organization_id, title, client_id, demand_id, assignee_id, due_date, priority, status)
    values (v_org, v_title, v_client, p_demand, v_assign, v_due, v_prio, 'pendente');
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('checklist_items', v_items, 'tasks_created', v_created);
end $$;

revoke all on function public.reorder_task_templates(uuid, uuid[]) from public, anon;
revoke all on function public.kickoff_demand(uuid, boolean, jsonb) from public, anon;
grant execute on function public.reorder_task_templates(uuid, uuid[]) to authenticated;
grant execute on function public.kickoff_demand(uuid, boolean, jsonb) to authenticated;

-- >>>>>>>>>> 20261112000005_stage_task_rules.sql
-- L11: regras por etapa. Um modelo de tarefa pode ser sugerido ao ENTRAR numa etapa do Kanban.
-- stage_id nulo = modelo de criação (comportamento do L9, inalterado). Nada é criado sem confirmação.
-- RLS, reorder_task_templates e kickoff_demand não mudam.

alter table public.task_templates add column stage_id uuid null;

-- A etapa precisa ser do mesmo escritório e da mesma categoria do modelo.
alter table public.task_templates
  add constraint task_templates_stage_org_fk
  foreign key (organization_id, stage_id) references public.workflow_stages (organization_id, id) on delete cascade;

alter table public.task_templates
  add constraint task_templates_stage_category_fk
  foreign key (category_id, stage_id) references public.workflow_stages (category_id, id) on delete cascade;

create index task_templates_stage_idx on public.task_templates (organization_id, stage_id);

-- >>>>>>>>>> 20261112000006_saved_views_bulk.sql
-- =============================================================================
-- JurisFlow AI — Migration L13: filtros salvos e ações em massa
-- =============================================================================
-- * public.saved_views guarda combinações de filtros (query string) por pessoa,
--   com opção de compartilhar com o escritório. Só o dono altera/apaga.
-- * bulk_update_demands / bulk_update_tasks alteram vários itens de uma vez.
--   São SECURITY INVOKER: a RLS das tabelas continua valendo e os gatilhos
--   (histórico de etapa, conclusão, completed_at, auditoria) disparam normalmente.
-- =============================================================================

create table public.saved_views (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null,
  page             text not null check (page in ('demandas', 'tarefas')),
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  query            text not null check (char_length(query) <= 500),
  shared           boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id, page, name),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index saved_views_org_page_idx on public.saved_views(organization_id, page);

alter table public.saved_views enable row level security;

create policy saved_views_select on public.saved_views for select to authenticated
  using (public.is_org_member(organization_id) and (user_id = auth.uid() or shared));

create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy saved_views_update on public.saved_views for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_org_member(organization_id));

create policy saved_views_delete on public.saved_views for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.saved_views from anon, authenticated;
grant select, insert, delete on public.saved_views to authenticated;
grant update (name, query, shared) on public.saved_views to authenticated;

-- -----------------------------------------------------------------------------
-- Demandas em massa. Chaves aceitas: responsible_id, priority, stage_id.
-- Devolve quantas demandas (do escritório, visíveis pela RLS) foram atualizadas.
-- -----------------------------------------------------------------------------
create or replace function public.bulk_update_demands(p_org uuid, p_ids uuid[], p_patch jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_resp  boolean;
  v_has_prio  boolean;
  v_has_stage boolean;
  v_resp      uuid;
  v_prio      public.priority_level;
  v_stage     uuid;
  v_cat       uuid;
  n           int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório.' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 200 then
    raise exception 'Informe de 1 a 200 demandas.' using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nenhuma alteração informada.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_patch) k
     where k <> all (array['responsible_id', 'priority', 'stage_id'])
  ) then
    raise exception 'Campo não permitido na alteração em massa.' using errcode = '22023';
  end if;

  v_has_resp  := p_patch ? 'responsible_id';
  v_has_prio  := p_patch ? 'priority';
  v_has_stage := p_patch ? 'stage_id';

  if v_has_resp then
    begin
      v_resp := (p_patch->>'responsible_id')::uuid;
    exception when others then
      raise exception 'Responsável inválido.' using errcode = '22023';
    end;
    if v_resp is not null and not exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_resp and m.active
    ) then
      raise exception 'O responsável precisa ser um membro ativo do escritório.' using errcode = '22023';
    end if;
  end if;

  if v_has_prio then
    begin
      v_prio := (p_patch->>'priority')::public.priority_level;
    exception when others then
      raise exception 'Prioridade inválida.' using errcode = '22023';
    end;
    if v_prio is null then
      raise exception 'Prioridade inválida.' using errcode = '22023';
    end if;
  end if;

  if v_has_stage then
    begin
      v_stage := (p_patch->>'stage_id')::uuid;
    exception when others then
      raise exception 'Etapa inválida.' using errcode = '22023';
    end;
    select s.category_id into v_cat
      from public.workflow_stages s
     where s.id = v_stage and s.organization_id = p_org;
    if v_cat is null then
      raise exception 'Etapa inválida.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.demands d
       where d.organization_id = p_org and d.id = any (p_ids) and d.category_id <> v_cat
    ) then
      raise exception 'A etapa precisa ser da mesma categoria de todas as demandas.' using errcode = '22023';
    end if;
  end if;

  update public.demands d set
    responsible_id = case when v_has_resp  then v_resp  else d.responsible_id end,
    priority       = case when v_has_prio  then v_prio  else d.priority end,
    stage_id       = case when v_has_stage then v_stage else d.stage_id end
   where d.organization_id = p_org
     and d.id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- Tarefas em massa. Chaves aceitas: assignee_id, due_date, status.
-- O gatilho tasks_before_write preenche/limpa completed_at.
-- -----------------------------------------------------------------------------
create or replace function public.bulk_update_tasks(p_org uuid, p_ids uuid[], p_patch jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_has_assignee boolean;
  v_has_due      boolean;
  v_has_status   boolean;
  v_assignee     uuid;
  v_due          date;
  v_status       public.task_status;
  n              int;
begin
  if auth.uid() is null or not public.is_org_member(p_org) then
    raise exception 'Sem acesso a este escritório.' using errcode = '42501';
  end if;

  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 200 then
    raise exception 'Informe de 1 a 200 tarefas.' using errcode = '22023';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nenhuma alteração informada.' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_patch) k
     where k <> all (array['assignee_id', 'due_date', 'status'])
  ) then
    raise exception 'Campo não permitido na alteração em massa.' using errcode = '22023';
  end if;

  v_has_assignee := p_patch ? 'assignee_id';
  v_has_due      := p_patch ? 'due_date';
  v_has_status   := p_patch ? 'status';

  if v_has_assignee then
    begin
      v_assignee := (p_patch->>'assignee_id')::uuid;
    exception when others then
      raise exception 'Responsável inválido.' using errcode = '22023';
    end;
    if v_assignee is not null and not exists (
      select 1 from public.organization_members m
       where m.organization_id = p_org and m.user_id = v_assignee and m.active
    ) then
      raise exception 'O responsável precisa ser um membro ativo do escritório.' using errcode = '22023';
    end if;
  end if;

  if v_has_due then
    begin
      v_due := (p_patch->>'due_date')::date;
    exception when others then
      raise exception 'Data inválida.' using errcode = '22023';
    end;
  end if;

  if v_has_status then
    begin
      v_status := (p_patch->>'status')::public.task_status;
    exception when others then
      raise exception 'Status inválido.' using errcode = '22023';
    end;
    if v_status is null then
      raise exception 'Status inválido.' using errcode = '22023';
    end if;
  end if;

  update public.tasks t set
    assignee_id = case when v_has_assignee then v_assignee else t.assignee_id end,
    due_date    = case when v_has_due      then v_due      else t.due_date end,
    status      = case when v_has_status   then v_status   else t.status end
   where t.organization_id = p_org
     and t.id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bulk_update_demands(uuid, uuid[], jsonb) from public, anon;
revoke all on function public.bulk_update_tasks(uuid, uuid[], jsonb) from public, anon;
grant execute on function public.bulk_update_demands(uuid, uuid[], jsonb) to authenticated;
grant execute on function public.bulk_update_tasks(uuid, uuid[], jsonb) to authenticated;

-- >>>>>>>>>> 20261112000007_import_batches.sql
-- =============================================================================
-- JurisFlow AI — Migration L14: importação com lote, desfazer e mapeamento lembrado
-- =============================================================================
-- * import_batches: um registro por importação (quem, quando, arquivo, contagens).
--   Nunca é apagado; "desfeito" é marcado por undo_import_batch().
-- * clients/demands.import_batch_id: ligam o que foi criado ao lote (FK composta).
-- * import_batch_updates: valor anterior/aplicado dos campos complementados.
-- * import_mappings: mapeamento de colunas lembrado por assinatura de cabeçalhos.
-- * undo_import_batch(): SECURITY DEFINER; remove só o que ainda não foi usado.
-- =============================================================================

create table public.import_batches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),
  file_name        text check (file_name is null or char_length(file_name) <= 200),
  created_clients  int not null default 0 check (created_clients >= 0),
  updated_clients  int not null default 0 check (updated_clients >= 0),
  created_demands  int not null default 0 check (created_demands >= 0),
  undone_at        timestamptz,
  undone_by        uuid,
  undo_result      jsonb,
  unique (organization_id, id)
);

create index import_batches_org_created_idx on public.import_batches(organization_id, created_at desc);

alter table public.import_batches enable row level security;

create policy import_batches_select on public.import_batches for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_batches_insert on public.import_batches for insert to authenticated
  with check (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id));

create policy import_batches_update on public.import_batches for update to authenticated
  using (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id))
  with check (created_by = auth.uid() and undone_at is null and public.is_org_member(organization_id));

revoke all on public.import_batches from anon, authenticated;
grant select on public.import_batches to authenticated;
grant insert (organization_id, created_by, file_name, created_clients, updated_clients, created_demands)
  on public.import_batches to authenticated;
grant update (created_clients, updated_clients, created_demands) on public.import_batches to authenticated;

-- -----------------------------------------------------------------------------
-- Ligação do que foi criado ao lote (sem cascade: o lote nunca é apagado)
-- -----------------------------------------------------------------------------
alter table public.clients add column import_batch_id uuid;
alter table public.clients add constraint clients_import_batch_fk
  foreign key (organization_id, import_batch_id) references public.import_batches(organization_id, id);
create index clients_import_batch_idx on public.clients(import_batch_id) where import_batch_id is not null;

alter table public.demands add column import_batch_id uuid;
alter table public.demands add constraint demands_import_batch_fk
  foreign key (organization_id, import_batch_id) references public.import_batches(organization_id, id);
create index demands_import_batch_idx on public.demands(import_batch_id) where import_batch_id is not null;

-- -----------------------------------------------------------------------------
-- Campos complementados em clientes existentes
-- -----------------------------------------------------------------------------
create table public.import_batch_updates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  batch_id         uuid not null,
  client_id        uuid not null,
  previous         jsonb not null check (
    jsonb_typeof(previous) = 'object' and (previous - array['cpf','phone','email','birth_date','address']) = '{}'::jsonb),
  applied          jsonb not null check (
    jsonb_typeof(applied) = 'object' and (applied - array['cpf','phone','email','birth_date','address']) = '{}'::jsonb),
  created_at       timestamptz not null default now(),
  foreign key (organization_id, batch_id) references public.import_batches(organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete cascade
);

create index import_batch_updates_batch_idx on public.import_batch_updates(batch_id);
create index import_batch_updates_client_idx on public.import_batch_updates(client_id);

alter table public.import_batch_updates enable row level security;

create policy import_batch_updates_select on public.import_batch_updates for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_batch_updates_insert on public.import_batch_updates for insert to authenticated
  with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.import_batches b
       where b.organization_id = import_batch_updates.organization_id
         and b.id = import_batch_updates.batch_id
         and b.created_by = auth.uid()
         and b.undone_at is null
    )
  );

revoke all on public.import_batch_updates from anon, authenticated;
grant select, insert on public.import_batch_updates to authenticated;

-- -----------------------------------------------------------------------------
-- Mapeamento lembrado por assinatura dos cabeçalhos
-- -----------------------------------------------------------------------------
create table public.import_mappings (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  signature        text not null check (char_length(signature) between 8 and 64),
  mapping          jsonb not null check (pg_column_size(mapping) <= 4096),
  category_map     jsonb not null default '{}'::jsonb check (pg_column_size(category_map) <= 8192),
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, signature)
);

alter table public.import_mappings enable row level security;

create policy import_mappings_select on public.import_mappings for select to authenticated
  using (public.is_org_member(organization_id));

create policy import_mappings_insert on public.import_mappings for insert to authenticated
  with check (public.is_org_member(organization_id));

create policy import_mappings_update on public.import_mappings for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

revoke all on public.import_mappings from anon, authenticated;
grant select, insert on public.import_mappings to authenticated;
grant update (mapping, category_map, updated_by, updated_at) on public.import_mappings to authenticated;

-- -----------------------------------------------------------------------------
-- Desfazer importação
-- -----------------------------------------------------------------------------
create or replace function public.undo_import_batch(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch     public.import_batches%rowtype;
  v_removed_d int := 0;
  v_skipped_d int := 0;
  v_removed_c int := 0;
  v_skipped_c int := 0;
  v_restored  int := 0;
  v_skipped_f int := 0;
  v_result    jsonb;
  u           record;
  cur         jsonb;
  k           text;
  v_restore   jsonb;
  v_n         int;
begin
  if auth.uid() is null then
    raise exception 'Sem acesso a esta importação.' using errcode = '42501';
  end if;

  select * into v_batch from public.import_batches where id = p_batch for update;
  -- inexistente ou de outro escritório: mesma resposta
  if not found or not public.is_org_member(v_batch.organization_id) then
    raise exception 'Sem acesso a esta importação.' using errcode = '42501';
  end if;
  if v_batch.created_by <> auth.uid() and not public.has_org_role(v_batch.organization_id, array['admin']::public.member_role[]) then
    raise exception 'Só o administrador ou quem fez a importação pode desfazê-la.' using errcode = '42501';
  end if;
  if v_batch.undone_at is not null then
    raise exception 'Esta importação já foi desfeita.' using errcode = '22023';
  end if;
  if v_batch.created_at < now() - interval '30 days' then
    raise exception 'Importações com mais de 30 dias não podem ser desfeitas.' using errcode = '22023';
  end if;

  -- 1) Demandas sem uso: sem tarefas, contrato, item marcado e sem mudança de etapa.
  with del as (
    delete from public.demands d
     where d.organization_id = v_batch.organization_id
       and d.import_batch_id = v_batch.id
       and not exists (select 1 from public.tasks t where t.demand_id = d.id)
       and not exists (select 1 from public.contracts c where c.demand_id = d.id)
       and not exists (select 1 from public.demand_checklist_items i where i.demand_id = d.id and i.done)
       and (select count(*) from public.demand_stage_history h where h.demand_id = d.id) <= 1
    returning 1
  )
  select count(*)::int into v_removed_d from del;

  select count(*)::int into v_skipped_d
    from public.demands where organization_id = v_batch.organization_id and import_batch_id = v_batch.id;

  -- 2) Clientes sem demandas, contratos nem tarefas.
  with del as (
    delete from public.clients c
     where c.organization_id = v_batch.organization_id
       and c.import_batch_id = v_batch.id
       and not exists (select 1 from public.demands d where d.client_id = c.id)
       and not exists (select 1 from public.contracts ct where ct.client_id = c.id)
       and not exists (select 1 from public.tasks t where t.client_id = c.id)
    returning 1
  )
  select count(*)::int into v_removed_c from del;

  select count(*)::int into v_skipped_c
    from public.clients where organization_id = v_batch.organization_id and import_batch_id = v_batch.id;

  -- 3) Campos complementados: volta ao valor anterior só se ainda for o aplicado.
  for u in
    select client_id, previous, applied
      from public.import_batch_updates
     where organization_id = v_batch.organization_id and batch_id = v_batch.id
     order by created_at, id
  loop
    select to_jsonb(c) into cur from public.clients c
     where c.organization_id = v_batch.organization_id and c.id = u.client_id;
    if cur is null then continue; end if;

    v_restore := '{}'::jsonb;
    for k in select jsonb_object_keys(u.applied) loop
      if (cur ->> k) is not distinct from (u.applied ->> k) then
        v_restore := v_restore || jsonb_build_object(k, u.previous -> k);
      else
        v_skipped_f := v_skipped_f + 1;
      end if;
    end loop;

    if v_restore <> '{}'::jsonb then
      update public.clients c set
        cpf        = case when v_restore ? 'cpf'        then (jsonb_populate_record(null::public.clients, v_restore)).cpf        else c.cpf end,
        phone      = case when v_restore ? 'phone'      then (jsonb_populate_record(null::public.clients, v_restore)).phone      else c.phone end,
        email      = case when v_restore ? 'email'      then (jsonb_populate_record(null::public.clients, v_restore)).email      else c.email end,
        birth_date = case when v_restore ? 'birth_date' then (jsonb_populate_record(null::public.clients, v_restore)).birth_date else c.birth_date end,
        address    = case when v_restore ? 'address'    then (jsonb_populate_record(null::public.clients, v_restore)).address    else c.address end
       where c.organization_id = v_batch.organization_id and c.id = u.client_id;
      get diagnostics v_n = row_count;
      v_restored := v_restored + v_n;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'removed_clients',  v_removed_c,
    'removed_demands',  v_removed_d,
    'restored_clients', v_restored,
    'skipped_clients',  v_skipped_c,
    'skipped_demands',  v_skipped_d,
    'skipped_fields',   v_skipped_f
  );

  update public.import_batches
     set undone_at = now(), undone_by = auth.uid(), undo_result = v_result
   where id = v_batch.id;

  return v_result;
end;
$$;

revoke all on function public.undo_import_batch(uuid) from public, anon;
grant execute on function public.undo_import_batch(uuid) to authenticated;

-- >>>>>>>>>> registro das migrations (para a CLI do Supabase reconhecer)
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261109000001', 'core_schema'),
  ('20261109000002', 'business_logic'),
  ('20261109000003', 'rls_policies'),
  ('20261109000004', 'ai_tools'),
  ('20261109000005', 'security_fixes'),
  ('20261109000006', 'checklists_templates'),
  ('20261109000007', 'integration_fixes'),
  ('20261109000008', 'review_fixes'),
  ('20261109000009', 'ai_quota'),
  ('20261109000010', 'pre_launch_hardening'),
  ('20261111000001', 'today_panel'),
  ('20261111000002', 'agenda'),
  ('20261111000003', 'ai_proposals'),
  ('20261111000004', 'client_overview'),
  ('20261112000001', 'stage_history'),
  ('20261112000002', 'notifications'),
  ('20261112000003', 'invite_link'),
  ('20261112000004', 'task_templates'),
  ('20261112000005', 'stage_task_rules'),
  ('20261112000006', 'saved_views_bulk'),
  ('20261112000007', 'import_batches')
on conflict do nothing;

-- >>>>>>>>>> perfis de usuários que se cadastraram ANTES da criação do banco
insert into public.profiles (id, full_name, email)
select id, coalesce(raw_user_meta_data->>'full_name', ''), email from auth.users
on conflict (id) do nothing;
