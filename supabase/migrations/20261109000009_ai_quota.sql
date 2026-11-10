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
