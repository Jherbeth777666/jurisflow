-- Testes da migration 011 (revisão independente da 010).
-- Executado por run_local.sh após stub + migrations. Falha = raise exception.
-- Tudo roda numa transação desfeita no final.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'rv2.admin@teste.local');

do $$
declare v_org uuid; v_cli uuid; v_k uuid; v_inst uuid; v_p uuid; v_ok boolean; v_notes text;
begin
  perform set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001"}', true);
  perform set_config('role', 'authenticated', true);
  v_org := public.create_organization('Escritório Revisão 2');

  insert into clients (organization_id, full_name, cpf)
  values (v_org, 'Joana Darc Pereira', '52998224725') returning id into v_cli;
  insert into contracts (organization_id, client_id, total_amount, installments_count, status)
  values (v_org, v_cli, 1000, 2, 'ativo') returning id into v_k;
  select id into v_inst from installments where contract_id = v_k and number = 1;
  insert into payments (organization_id, contract_id, installment_id, amount, notes)
  values (v_org, v_k, v_inst, 100, 'Recebido de Joana Darc Pereira') returning id into v_p;

  -- 1. contrato cancelado com pagamento: anonimização (LGPD) não pode falhar
  update contracts set status = 'cancelado' where id = v_k;
  perform public.anonymize_client(v_cli);
  select notes into v_notes from payments where id = v_p;
  if v_notes ilike '%Joana%' then
    raise exception 'FALHOU: anonimização não limpou payments.notes (%)', v_notes;
  end if;

  -- 2. mas continua proibido lançar/alterar VALOR em contrato cancelado
  v_ok := false;
  begin
    insert into payments (organization_id, contract_id, amount) values (v_org, v_k, 10);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FALHOU: pagamento novo em contrato cancelado foi aceito'; end if;
  v_ok := false;
  begin
    update payments set amount = 50 where id = v_p;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FALHOU: alteração de valor em contrato cancelado foi aceita'; end if;

  -- 3. função de trigger não é executável pela API
  if has_function_privilege('authenticated', 'public.payments_before_write()', 'execute') then
    raise exception 'FALHOU: payments_before_write executável por authenticated';
  end if;
end $$;

rollback;
\echo '✔ review2_test: ok'
