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
