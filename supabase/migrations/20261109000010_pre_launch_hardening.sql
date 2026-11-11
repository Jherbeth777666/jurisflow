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
