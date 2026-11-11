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
