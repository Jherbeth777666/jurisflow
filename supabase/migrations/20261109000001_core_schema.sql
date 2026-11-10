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
