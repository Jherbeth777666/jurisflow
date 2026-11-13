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
