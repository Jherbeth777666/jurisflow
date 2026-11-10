-- Cota de uso da IA (migration 009) e anonimização do histórico do assistente.
begin;
insert into auth.users(id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'quota-a@teste.com'),
  ('a1000000-0000-0000-0000-000000000002', 'quota-b@teste.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
select create_organization('Cota A') as org_a \gset

do $$
declare v_org uuid := (select id from organizations where name = 'Cota A'); ok boolean; i int;
begin
  for i in 1..3 loop
    if not public.ai_consume_quota(v_org, 'assistant', 3) then raise exception 'FALHOU: cota negada antes do limite (%)', i; end if;
  end loop;
  if public.ai_consume_quota(v_org, 'assistant', 3) then raise exception 'FALHOU: cota permitiu acima do limite'; end if;
  -- tipos têm cotas independentes
  if not public.ai_consume_quota(v_org, 'compose', 3) then raise exception 'FALHOU: cota de compose afetada pelo assistant'; end if;
  -- usuário não consegue apagar o próprio uso
  begin
    delete from public.ai_usage;
  exception when insufficient_privilege then null;  -- bloqueado pela falta de GRANT
  end;
  if (select count(*) from public.ai_usage) <> 4 then raise exception 'FALHOU: usuário apagou registros de uso'; end if;
  begin
    insert into public.ai_usage(organization_id, user_id, kind) values (v_org, auth.uid(), 'assistant');
    raise exception 'FALHOU: insert direto em ai_usage permitido';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_consume_quota(v_org, 'outro', 3);
    raise exception 'FALHOU: tipo inválido aceito';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
  end;
end $$;

-- outro usuário, de outro escritório: não usa a cota do escritório A e não vê o uso de A
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002"}', true);
do $$
declare v_org uuid;
begin
  begin
    select id into v_org from organizations where name = 'Cota A';  -- invisível pela RLS
    perform public.ai_consume_quota('00000000-0000-0000-0000-000000000000'::uuid, 'assistant', 3);
    raise exception 'FALHOU: não-membro consumiu cota';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.ai_usage) <> 0 then raise exception 'FALHOU: usuário viu uso de outro'; end if;
end $$;

-- anonimização remove o nome do cliente do histórico do assistente
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001"}', true);
do $$
declare v_org uuid := (select id from organizations where name = 'Cota A'); v_cli uuid; v_conv uuid;
begin
  insert into clients(organization_id, full_name) values (v_org, 'Joana Pereira Lima') returning id into v_cli;
  insert into ai_conversations(organization_id, user_id) values (v_org, auth.uid()) returning id into v_conv;
  insert into ai_messages(organization_id, conversation_id, user_id, role, content)
  values (v_org, v_conv, auth.uid(), 'user', 'Como está o caso da JOANA PEREIRA LIMA?');
  perform public.anonymize_client(v_cli);
  if exists (select 1 from ai_messages where content ilike '%joana pereira lima%') then
    raise exception 'FALHOU: nome do cliente permaneceu no histórico do assistente';
  end if;
end $$;
rollback;
\echo '✔ quota_test: ok'
