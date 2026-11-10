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
