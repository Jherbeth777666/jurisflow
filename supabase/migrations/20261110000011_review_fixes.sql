-- =============================================================================
-- JurisFlow AI — Migration 011: correções da revisão independente da 010
--   1. payments_before_write: a checagem de status do contrato (cancelado /
--      rascunho) só vale para lançamentos financeiros (INSERT ou mudança de
--      valor/parcela/contrato). Na 010 ela barrava QUALQUER UPDATE em pagamento
--      de contrato cancelado — e anonymize_client (LGPD) atualiza payments.notes,
--      então a anonimização de um cliente com contrato cancelado e pagamento com
--      observação citando o nome falhava com "Não é possível registrar pagamento
--      em contrato cancelado".
-- =============================================================================

create or replace function public.payments_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status  public.contract_status;
  v_total   numeric;
  v_paid    numeric;
  v_inst    numeric;
begin
  if new.installment_id is not null and not exists (
    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  ) then
    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  end if;

  -- Só lançamentos financeiros passam pelas regras de status e saldo; UPDATE de
  -- campos descritivos (ex.: notes na anonimização) não é um novo recebimento.
  if tg_op = 'INSERT'
     or new.amount is distinct from old.amount
     or new.installment_id is distinct from old.installment_id
     or new.contract_id is distinct from old.contract_id then
    -- trava o contrato: pagamentos simultâneos não estouram o saldo
    select status, total_amount into v_status, v_total
      from public.contracts where id = new.contract_id for update;
    if v_status = 'cancelado' then
      raise exception 'Não é possível registrar pagamento em contrato cancelado.' using errcode = 'P0001';
    end if;
    if v_status = 'rascunho' then
      raise exception 'Não é possível registrar pagamento em contrato em rascunho. Ative o contrato antes de registrar recebimentos.'
        using errcode = 'P0001';
    end if;

    select coalesce(sum(amount), 0) into v_paid
      from public.payments where contract_id = new.contract_id and id <> new.id;
    if v_paid + new.amount > v_total + 0.01 then
      raise exception 'O pagamento excede o saldo do contrato (saldo em aberto: R$ %).',
        translate(to_char(greatest(v_total - v_paid, 0), 'FM999,999,990.00'), ',.', '.,') using errcode = 'P0001';
    end if;
    if new.installment_id is not null then
      select amount into v_inst from public.installments where id = new.installment_id;
      select coalesce(sum(amount), 0) into v_paid
        from public.payments where installment_id = new.installment_id and id <> new.id;
      if v_paid + new.amount > v_inst + 0.01 then
        raise exception 'O pagamento excede o restante da parcela (em aberto: R$ %).',
          translate(to_char(greatest(v_inst - v_paid, 0), 'FM999,999,990.00'), ',.', '.,') using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;

-- função de trigger: ninguém executa diretamente
revoke all on function public.payments_before_write() from public, anon, authenticated;
