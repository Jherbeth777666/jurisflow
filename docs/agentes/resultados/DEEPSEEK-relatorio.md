# Relatório DEEPSEEK

## Resumo

Foram revisados os módulos de dashboard, clientes, demandas, Kanban, checklist, tarefas, contratos/pagamentos, mensagens, assistente, importação, saúde do cadastro, busca global, relatórios e configurações. A revisão foi de leitura de código e das migrations 001–009; os testes propostos abaixo ainda não foram executados nesta rodada.

Seis propostas, em ordem de prioridade:

1. **ALTA** — Contrato em rascunho aceita pagamento (banco + UI).
2. **ALTA** — Demanda em etapa final aceita status aberto (banco + UI).
3. **MÉDIA** — `ClientPicker` busca nome sem filtrar escritório e fica em “Carregando…” para id inexistente.
4. **MÉDIA** — Lista de clientes exibe clientes anonimizados, ao contrário das demais consultas.
5. **BAIXA** — `MessageComposerModal` não reinicia o texto ao trocar para um modelo de corpo idêntico.
6. **BAIXA** — Assistente perde `?q` quando a página já está montada (Ctrl+K → “Perguntar ao assistente”).

As duas correções de banco ficam em **uma única migration nova**, `20261110000010_integrity_guards.sql`, sem editar as migrations 001–009.

## Propostas

### [ALTA] Contrato em rascunho aceita pagamento

- Arquivo(s): `supabase/migrations/20261109000002_business_logic.sql:191-203` (trigger atual), `src/features/contracts/ContractDetailPage.tsx:74-78`, `src/features/contracts/installments.ts:1-69`
- Problema: o formulário de contrato permite criar/editar com status `rascunho` (`ContractFormModal.tsx:70`), mas `payments_before_write` só bloqueia contrato `cancelado`. Com isso, `ContractDetailPage` mostra “Registrar pagamento” (`canPay` não olha o status) e o pagamento é gravado. A parcela passa a aparecer como `paga` em `installment_overview` (migration 007: a regra `paid >= amount` vem antes de `rascunho`), o contrato nunca vira `quitado` porque `refresh_contract_status` retorna cedo em `rascunho` (002:216), e `dashboard_metrics.fees_received` (inclui pagamentos de rascunho) pode ficar maior que `fees_expected` (exclui rascunhos). O próprio código já trata rascunho como não cobrável em `useFinanceSummary`/`useReceivables`, então o pagamento é uma inconsistência.
- Correção (diff):

  Novo arquivo `supabase/migrations/20261110000010_integrity_guards.sql` (parte 1):

  ```diff
  --- /dev/null
  +++ b/supabase/migrations/20261110000010_integrity_guards.sql
  @@
  +-- =============================================================================
  +-- JurisFlow AI — Migration 010: invariantes de integridade
  +--  1. Contrato em rascunho não recebe pagamento (e contrato com pagamento não
  +--     volta a rascunho) — senão o pagamento fica invisível para o status e para
  +--     as métricas, e a parcela aparece como "paga" em um contrato não cobrado.
  +--  2. Demanda em etapa final não pode ficar com status aberto.
  +-- =============================================================================
  +
  +-- 1) Pagamentos ---------------------------------------------------------------
  +create or replace function public.payments_before_write()
  +returns trigger language plpgsql as $$
  +begin
  +  if new.installment_id is not null and not exists (
  +    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  +  ) then
  +    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  +  end if;
  +  if exists (select 1 from public.contracts where id = new.contract_id and status = 'cancelado') then
  +    raise exception 'Não é possível registrar pagamento em contrato cancelado.' using errcode = 'P0001';
  +  end if;
  +  if exists (select 1 from public.contracts where id = new.contract_id and status = 'rascunho') then
  +    raise exception 'Não é possível registrar pagamento em contrato em rascunho. Ative o contrato primeiro.'
  +      using errcode = 'P0001';
  +  end if;
  +  return new;
  +end $$;
  +
  +-- Um contrato que já tem pagamentos não pode voltar a rascunho.
  +create or replace function public.contracts_guard_draft()
  +returns trigger language plpgsql as $$
  +begin
  +  if new.status = 'rascunho' and old.status is distinct from 'rascunho'
  +     and exists (select 1 from public.payments where contract_id = new.id) then
  +    raise exception 'Não é possível voltar o contrato para rascunho: já existem pagamentos registrados.'
  +      using errcode = 'P0001';
  +  end if;
  +  return new;
  +end $$;
  +
  +drop trigger if exists contracts_guard_draft on public.contracts;
  +create trigger contracts_guard_draft before update on public.contracts
  +  for each row execute function public.contracts_guard_draft();
  ```

  `src/features/contracts/installments.ts`:

  ```diff
  --- a/src/features/contracts/installments.ts
  +++ b/src/features/contracts/installments.ts
  @@
   // Regras puras de contratos/parcelas — espelham public.generate_installments (migration 002).
   import { parseCurrency } from '@/lib/format'
  +import type { ContractStatus } from '@/types/database'
  @@
   export function formatMoneyInput(value: number): string {
     return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
   }
  +
  +/** Pagamento só é permitido em contrato ativo/quitado com parcela em aberto. */
  +export function canRegisterPayment(status: ContractStatus, hasOpenInstallment: boolean): boolean {
  +  return hasOpenInstallment && status !== 'rascunho' && status !== 'cancelado'
  +}
  ```

  `src/features/contracts/ContractDetailPage.tsx`:

  ```diff
  --- a/src/features/contracts/ContractDetailPage.tsx
  +++ b/src/features/contracts/ContractDetailPage.tsx
  @@
   import { ContractFormModal } from './ContractFormModal'
   import { PaymentModal } from './PaymentModal'
   import { ProgressBar } from './ContractsPage'
  +import { canRegisterPayment } from './installments'
  @@
     const instList = installments.data ?? []
     const instNumber = new Map(instList.map((i) => [i.id, i.number]))
     const hasOpen = instList.some((i) => i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  -  const canPay = can('payments.create') && !cancelled && hasOpen
  +  const canPay = can('payments.create') && canRegisterPayment(c.status, hasOpen)
  ```

- Teste que comprova:

  `src/features/contracts/installments.test.ts`:

  ```diff
  --- a/src/features/contracts/installments.test.ts
  +++ b/src/features/contracts/installments.test.ts
  @@
  -import { addMonthsISO, computeInstallments, nextOpenInstallment, parseMoneyInput, formatMoneyInput } from './installments'
  +import { addMonthsISO, canRegisterPayment, computeInstallments, nextOpenInstallment, parseMoneyInput, formatMoneyInput } from './installments'
  @@
   describe('nextOpenInstallment', () => {
     it('escolhe a primeira parcela com saldo', () => {
       const list = [
         { number: 2, remaining_amount: '100.00', status: 'a_vencer' },
         { number: 1, remaining_amount: 0, status: 'paga' },
         { number: 3, remaining_amount: 100, status: 'a_vencer' },
       ]
       expect(nextOpenInstallment(list)?.number).toBe(2)
       expect(nextOpenInstallment([{ number: 1, remaining_amount: 0, status: 'paga' }])).toBeUndefined()
     })
   })
  +
  +describe('canRegisterPayment', () => {
  +  it('bloqueia rascunho/cancelado e exige parcela em aberto', () => {
  +    expect(canRegisterPayment('ativo', true)).toBe(true)
  +    expect(canRegisterPayment('quitado', true)).toBe(true)
  +    expect(canRegisterPayment('rascunho', true)).toBe(false)
  +    expect(canRegisterPayment('cancelado', true)).toBe(false)
  +    expect(canRegisterPayment('ativo', false)).toBe(false)
  +  })
  +})
  ```

  `supabase/tests/integrity_guards_test.sql` (trecho 1; o trecho 2 vem na proposta seguinte):

  ```sql
  -- supabase/tests/integrity_guards_test.sql
  \set ON_ERROR_STOP 1
  set client_min_messages = warning;
  begin;

  do $$
  declare
    u uuid := 'b9000000-0000-4000-9000-000000000001';
    o uuid; v_cli uuid; v_con uuid; v_inst uuid;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (u, 'guardas.pagamento@teste.local', '{"full_name":"Admin Guardas"}');
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    o := public.create_organization('Escritório Guardas');

    insert into clients (organization_id, full_name) values (o, 'Cliente Guardas') returning id into v_cli;
    insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date, status)
    values (o, v_cli, 300, 3, current_date, 'rascunho') returning id into v_con;
    select id into v_inst from installments where contract_id = v_con and number = 1;

    -- parcela de rascunho não é cobrável
    begin
      insert into payments (organization_id, contract_id, installment_id, amount)
      values (o, v_con, v_inst, 100);
      raise exception 'FALHOU: pagamento em contrato rascunho foi aceito';
    exception when sqlstate 'P0001' then
      if position('rascunho' in sqlerrm) = 0 then raise; end if;
    end;
    if exists (select 1 from payments where contract_id = v_con) then
      raise exception 'FALHOU: pagamento em rascunho foi gravado';
    end if;
    if (select status from installment_overview where id = v_inst) <> 'rascunho' then
      raise exception 'FALHOU: parcela de rascunho deveria continuar como rascunho';
    end if;

    -- ativar permite pagar (regressão)
    update contracts set status = 'ativo' where id = v_con;
    insert into payments (organization_id, contract_id, installment_id, amount)
    values (o, v_con, v_inst, 100);
    if (select status::text from contracts where id = v_con) <> 'ativo' then
      raise exception 'FALHOU: contrato com pagamento parcial deveria ficar ativo';
    end if;

    -- e não pode voltar a rascunho depois do pagamento
    begin
      update contracts set status = 'rascunho' where id = v_con;
      raise exception 'FALHOU: contrato com pagamento voltou a rascunho';
    exception when sqlstate 'P0001' then
      if position('rascunho' in sqlerrm) = 0 then raise; end if;
    end;
  end $$;
  ```

- Risco da mudança: baixo. Só bloqueia um caminho que já era tratado como não cobrável pelas telas de resumo/recebimentos; contratos ativos/quitados/cancelados mantêm o comportamento atual. A guarda de “voltar a rascunho” pode surpreender quem tentar rebaixar um contrato já pago, mas evita exatamente a inconsistência de métricas.

### [ALTA] Demanda em etapa final aceita status aberto

- Arquivo(s): `supabase/migrations/20261109000002_business_logic.sql:87-119`, `src/features/demands/DemandFormModal.tsx:120-122,217-222`
- Problema: `demands_before_write` só força `status = 'concluida'` quando a etapa muda (`tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id`). Se a demanda já está na etapa final e o usuário edita apenas o campo Status para `em_andamento`, o trigger não entra no bloco, deixa o status aberto e zera `closed_at` (linha 116). O formulário até avisa “Etapa final: a demanda será marcada como concluída” (`DemandFormModal.tsx:171`), mas o campo Status continua habilitado e permite a combinação inválida. Efeito: a demanda aparece como aberta no Kanban e nas contagens de “em andamento”, embora esteja na coluna final.
- Correção (diff):

  No mesmo arquivo novo `supabase/migrations/20261110000010_integrity_guards.sql` (parte 2):

  ```diff
  --- /dev/null
  +++ b/supabase/migrations/20261110000010_integrity_guards.sql
  @@
  +-- 2) Demandas ----------------------------------------------------------------
  +create or replace function public.demands_before_write()
  +returns trigger language plpgsql as $$
  +declare
  +  v_final boolean;
  +begin
  +  -- Mudou de categoria sem informar etapa nova → volta para a 1ª etapa da nova categoria
  +  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id
  +     and new.stage_id is not distinct from old.stage_id then
  +    new.stage_id := null;
  +  end if;
  +
  +  if new.stage_id is null then
  +    select id into new.stage_id from public.workflow_stages
  +     where category_id = new.category_id order by position limit 1;
  +  end if;
  +
  +  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
  +    new.stage_changed_at := now();
  +    select is_final into v_final from public.workflow_stages where id = new.stage_id;
  +    if coalesce(v_final, false) then
  +      new.status := 'concluida';
  +    elsif tg_op = 'UPDATE' and old.status = 'concluida' and new.status = 'concluida' then
  +      new.status := 'em_andamento';  -- saiu da etapa final → reabre
  +    end if;
  +  elsif coalesce((select is_final from public.workflow_stages where id = new.stage_id), false)
  +        and new.status <> 'cancelada' then
  +    -- Etapa final é invariante: só sai dela mudando de etapa; o status acompanha.
  +    new.status := 'concluida';
  +  end if;
  +
  +  if new.status in ('concluida', 'cancelada') then
  +    new.closed_at := coalesce(new.closed_at, now());
  +  else
  +    new.closed_at := null;
  +  end if;
  +  return new;
  +end $$;
  ```

  `src/features/demands/DemandFormModal.tsx`:

  ```diff
  --- a/src/features/demands/DemandFormModal.tsx
  +++ b/src/features/demands/DemandFormModal.tsx
  @@
     const selectedStage = category?.stages.find((s) => s.id === stageId)
  +  const finalStage = !!selectedStage?.is_final
     const loadingRefs = cats.isLoading || members.isLoading
  @@
             <Select
               label="Status"
               options={toOptions(DEMAND_STATUS)}
  -            value={values.status}
  +            value={finalStage && values.status !== 'cancelada' ? 'concluida' : values.status}
               onChange={(e) => set('status', e.target.value as DemandStatus)}
  +            disabled={finalStage}
  +            hint={finalStage ? 'Etapa final: o status é definido como Concluída.' : undefined}
             />
  ```

- Teste que comprova:

  Continuação de `supabase/tests/integrity_guards_test.sql` (antes do `rollback` final):

  ```sql
  do $$
  declare
    u uuid := 'b9000000-0000-4000-9000-000000000002';
    o uuid; v_cli uuid; v_dem uuid; v_final uuid; v_first uuid;
  begin
    insert into auth.users (id, email, raw_user_meta_data)
    values (u, 'guardas.demanda@teste.local', '{"full_name":"Admin Demanda"}');
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    o := public.create_organization('Escritório Etapas');

    select s.id into v_first from workflow_stages s
      join demand_categories c on c.id = s.category_id
     where c.organization_id = o and c.name = 'Outros' order by s.position limit 1;
    select s.id into v_final from workflow_stages s
      join demand_categories c on c.id = s.category_id
     where c.organization_id = o and c.name = 'Outros' and s.is_final;

    insert into clients (organization_id, full_name) values (o, 'Cliente Etapas') returning id into v_cli;
    insert into demands (organization_id, client_id, category_id, title)
    values (o, v_cli, (select category_id from workflow_stages where id = v_first), 'Demanda Etapas')
    returning id into v_dem;

    -- entra na etapa final → concluída
    update demands set stage_id = v_final where id = v_dem;
    if (select status::text from demands where id = v_dem) <> 'concluida' then
      raise exception 'FALHOU: etapa final deveria concluir';
    end if;

    -- tentar reabrir sem mudar de etapa → continua concluída
    update demands set status = 'em_andamento' where id = v_dem;
    if (select status::text from demands where id = v_dem) <> 'concluida' then
      raise exception 'FALHOU: demanda em etapa final aceitou status aberto';
    end if;
    if (select closed_at from demands where id = v_dem) is null then
      raise exception 'FALHOU: demanda concluída deveria manter closed_at';
    end if;

    -- sair da etapa final reabre
    update demands set stage_id = v_first where id = v_dem;
    if (select status::text from demands where id = v_dem) <> 'em_andamento' then
      raise exception 'FALHOU: sair da etapa final deveria reabrir';
    end if;

    -- cancelar na etapa final é permitido
    update demands set stage_id = v_final where id = v_dem;
    update demands set status = 'cancelada' where id = v_dem;
    if (select status::text from demands where id = v_dem) <> 'cancelada' then
      raise exception 'FALHOU: cancelamento na etapa final deveria ser preservado';
    end if;
  end $$;

  rollback;
  ```

- Risco da mudança: baixo. Preserva cancelamento e reabertura ao sair da etapa final; apenas corrige a combinação “etapa final + status aberto”, que contraria a dica do próprio formulário. Se algum escritório usava essa combinação de propósito, ela deixará de existir.

### [MÉDIA] ClientPicker busca nome sem filtrar escritório e fica em “Carregando…” para id inexistente

- Arquivo(s): `src/components/ClientPicker.tsx:37-42,64`
- Problema: a consulta do nome selecionado usa apenas `.eq('id', value)`; não filtra `organization_id`. Para um usuário com acesso a mais de um escritório, isso pode exibir o nome de um cliente de outra organização. Além disso, usa `.single()` e descarta o erro com `.data?.full_name ?? ''`; quando o id não existe (cliente removido, link antigo ou id de outra org), `data` é `null`, o resultado vira string vazia e a interface fica eternamente em “Carregando…” porque `selected.data || 'Carregando…'` nunca recebe um valor truthy.
- Correção (diff):

  ```diff
  --- a/src/components/ClientPicker.tsx
  +++ b/src/components/ClientPicker.tsx
  @@
     const selected = useQuery({
       queryKey: ['client-name', orgId, value],
       enabled: !!value,
  -    queryFn: async () => (await supabase.from('clients').select('full_name').eq('id', value!).single()).data?.full_name ?? '',
  +    queryFn: async () =>
  +      (
  +        await supabase
  +          .from('clients')
  +          .select('full_name')
  +          .eq('organization_id', orgId)
  +          .eq('id', value!)
  +          .maybeSingle()
  +      ).data?.full_name ?? 'Cliente não encontrado',
       staleTime: 300_000,
     })
  @@
  -            <span className={cn('truncate', !value && 'text-ink-subtle')}>{value ? selected.data || 'Carregando…' : 'Selecione um cliente'}</span>
  +            <span className={cn('truncate', !value && 'text-ink-subtle')}>
  +              {value ? (selected.isLoading ? 'Carregando…' : selected.data || 'Cliente não encontrado') : 'Selecione um cliente'}
  +            </span>
  ```

- Teste que comprova:

  Novo `src/components/ClientPicker.test.tsx`:

  ```tsx
  import { describe, expect, it, vi, beforeEach } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { ClientPicker } from './ClientPicker'

  const mocks = vi.hoisted(() => ({
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  }))

  vi.mock('@/contexts/AuthContext', () => ({ useOrg: () => ({ orgId: 'org-1' }) }))
  vi.mock('@/hooks/useOrgData', () => ({ useClientLookup: () => ({ data: [], isLoading: false }) }))
  vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))

  beforeEach(() => {
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
    mocks.eq.mockReset().mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle })
    mocks.select.mockReset().mockReturnValue({ eq: mocks.eq })
    mocks.from.mockReset().mockReturnValue({ select: mocks.select })
  })

  function renderPicker() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ClientPicker value="cli-1" onChange={() => {}} />
      </QueryClientProvider>,
    )
  }

  describe('ClientPicker', () => {
    it('filtra pelo escritório e mostra fallback quando o cliente não existe', async () => {
      renderPicker()
      expect(await screen.findByText('Cliente não encontrado')).toBeInTheDocument()
      expect(mocks.eq).toHaveBeenCalledWith('organization_id', 'org-1')
      expect(mocks.eq).toHaveBeenCalledWith('id', 'cli-1')
    })

    it('mostra o nome quando o cliente existe', async () => {
      mocks.maybeSingle.mockResolvedValueOnce({ data: { full_name: 'Maria' }, error: null })
      renderPicker()
      expect(await screen.findByText('Maria')).toBeInTheDocument()
    })
  })
  ```

- Risco da mudança: baixo. Adiciona um filtro que já existe em todas as outras consultas do módulo e troca `single()` por `maybeSingle()`, que é o método correto para “0 ou 1 linha”. O rótulo de fallback só aparece quando o nome realmente não pode ser carregado.

### [MÉDIA] Lista de clientes exibe clientes anonimizados

- Arquivo(s): `src/features/clients/api.ts:19-25`
- Problema: `anonymize_client` não apaga a linha; mantém o cliente com `full_name = 'Cliente anonimizado'`, `status = 'arquivado'` e `anonymized_at` preenchido. As consultas de busca (`useClientLookup`), exportação, saúde do cadastro, busca global e importação filtram `.is('anonymized_at', null)`, mas `useClientsList` não. Resultado: a lista principal mostra registros “Cliente anonimizado” sem utilidade operacional, permitindo abrir uma ficha que só exibe o aviso de anonimização.
- Correção (diff):

  ```diff
  --- a/src/features/clients/api.ts
  +++ b/src/features/clients/api.ts
  @@
       let q = supabase
         .from('clients')
         .select('*', { count: 'exact' })
         .eq('organization_id', orgId)
  +      .is('anonymized_at', null)
         .order('full_name')
         .range(from, from + PAGE_SIZE - 1)
  ```

- Teste que comprova:

  Novo `src/features/clients/api.test.ts`:

  ```ts
  import { describe, expect, it, vi } from 'vitest'
  import { renderHook, waitFor } from '@testing-library/react'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import type { ReactNode } from 'react'
  import { useClientsList } from './api'

  const mocks = vi.hoisted(() => {
    const builder: Record<string, any> = {}
    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn(() => builder)
    builder.is = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.range = vi.fn(() => Promise.resolve({ data: [], error: null, count: 0 }))
    return { builder, from: vi.fn(() => builder) }
  })

  vi.mock('@/contexts/AuthContext', () => ({ useOrg: () => ({ orgId: 'org-1' }) }))
  vi.mock('@/lib/supabase', () => ({
    supabase: { from: mocks.from },
    unwrap: <T,>(r: { data: T }) => r.data,
  }))

  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

  describe('useClientsList', () => {
    it('não lista clientes anonimizados', async () => {
      const { result } = renderHook(() => useClientsList({ term: '', status: '', page: 0 }), { wrapper })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(mocks.builder.is).toHaveBeenCalledWith('anonymized_at', null)
    })
  })
  ```

- Risco da mudança: baixo. Clientes anonimizados continuam acessíveis por links de demandas/histórico e pela ficha; apenas deixam de poluir a lista ativa, alinhando-se às demais consultas.

### [BAIXA] MessageComposerModal não reinicia ao trocar para modelo de corpo idêntico

- Arquivo(s): `src/features/messages/MessageComposerModal.tsx:111-115`
- Problema: o efeito de reset depende apenas de `template.body`. Se o usuário editar o texto e escolher outro modelo cujo corpo é igual (muito comum em modelos que só mudam o nome/assunto), o efeito não roda: `source`, `dirty` e `undo` permanecem do modelo anterior e o texto editado não é substituído. O assunto é atualizado pelo outro efeito (`template.subject`), criando uma combinação inconsistente.
- Correção (diff):

  ```diff
  --- a/src/features/messages/MessageComposerModal.tsx
  +++ b/src/features/messages/MessageComposerModal.tsx
  @@
     useEffect(() => {
       setSource(template.body)
       setDirty(false)
       setUndo(null)
  -  }, [template.body])
  +  }, [template.id, template.body])
  ```

- Teste que comprova:

  Novo `src/features/messages/MessageComposerModal.test.tsx`:

  ```tsx
  import { describe, expect, it, vi } from 'vitest'
  import { fireEvent, render, screen, waitFor } from '@testing-library/react'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { ToastProvider } from '@/components/ui'
  import { MessageComposerModal } from './MessageComposerModal'

  vi.mock('@/contexts/AuthContext', () => ({
    useOrg: () => ({ orgId: 'org-1', organization: { name: 'Escritório Teste' } }),
  }))
  vi.mock('@/hooks/useOrgData', () => ({
    useCategories: () => ({ data: [], isLoading: false }),
    useMemberNames: () => ({ map: new Map(), options: [] }),
  }))
  vi.mock('@/features/checklist/api', () => ({ useChecklistItems: () => ({ data: [] }) }))
  vi.mock('@/features/checklist/logic', () => ({ pendingLabels: () => [] }))
  vi.mock('./defaultTemplates', () => ({
    DEFAULT_TEMPLATES: [
      { id: 't1', name: 'Modelo 1', subject: '', body: 'Mesmo corpo', kind: 'padrao' },
      { id: 't2', name: 'Modelo 2', subject: '', body: 'Mesmo corpo', kind: 'padrao' },
    ],
  }))
  vi.mock('./api', () => ({
    ComposeError: class ComposeError extends Error {},
    adjustTemplateTone: vi.fn(),
    isAiComposeMarkedUnavailable: () => true,
    useComposeContext: () => ({
      data: {
        client: { full_name: 'Maria Silva', phone: null, email: null, anonymized_at: null },
        demands: [],
        nextInstallment: null,
      },
      isLoading: false,
      isError: false,
    }),
    useMessageTemplates: () => ({ data: [], isError: false }),
    useNextDemandTask: () => ({ data: null }),
  }))

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MessageComposerModal open onClose={() => {}} clientId="c1" initialTemplateId="t1" />
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  describe('MessageComposerModal', () => {
    it('restaura o texto ao trocar para um modelo com o mesmo corpo', async () => {
      setup()
      const textarea = screen.getByLabelText('Mensagem') as HTMLTextAreaElement
      await waitFor(() => expect(textarea.value).toBe('Mesmo corpo'))

      fireEvent.change(textarea, { target: { value: 'Editado por mim' } })
      expect(textarea.value).toBe('Editado por mim')

      fireEvent.click(screen.getByRole('button', { name: 'Modelo 2' }))
      await waitFor(() => expect(textarea.value).toBe('Mesmo corpo'))
    })
  })
  ```

- Risco da mudança: baixo. Modelos com corpos diferentes já reiniciavam; a mudança só inclui a identidade do modelo na dependência. Modelos do escritório editados no servidor continuam atualizando porque `template.body` permanece na lista de dependências.

### [BAIXA] Assistente perde `?q` quando a página já está montada

- Arquivo(s): `src/features/assistant/AssistantPage.tsx:29-33`
- Problema: o campo é inicializado uma única vez com `params.get('q')` e o efeito apenas remove o parâmetro da URL. Se o usuário já estiver em `/assistente` e usar Ctrl+K → “Perguntar ao assistente”, o React Router navega para `/assistente?q=...` sem remontar a página; o estado `input` não é atualizado e o efeito apaga o `q`, perdendo a pergunta. O fluxo funciona apenas quando a página é montada pela primeira vez.
- Correção (diff):

  ```diff
  --- a/src/features/assistant/AssistantPage.tsx
  +++ b/src/features/assistant/AssistantPage.tsx
  @@
  -  const [input, setInput] = useState(() => (params.get('q') ?? '').slice(0, 2000))
  -  useEffect(() => {
  -    if (params.has('q')) setParams((p) => { const n = new URLSearchParams(p); n.delete('q'); return n }, { replace: true })
  -  }, [params, setParams])
  +  const [input, setInput] = useState('')
  +  useEffect(() => {
  +    const q = params.get('q')
  +    if (q === null) return
  +    setInput(q.slice(0, MAX_MESSAGE_CHARS))
  +    setParams((p) => {
  +      const n = new URLSearchParams(p)
  +      n.delete('q')
  +      return n
  +    }, { replace: true })
  +  }, [params, setParams])
  ```

- Teste que comprova:

  Novo `src/features/assistant/AssistantPage.test.tsx`:

  ```tsx
  import { describe, expect, it, vi } from 'vitest'
  import { fireEvent, render, screen, waitFor } from '@testing-library/react'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
  import { ToastProvider } from '@/components/ui'
  import { AssistantPage } from './AssistantPage'

  vi.mock('@/contexts/AuthContext', () => ({ useOrg: () => ({ orgId: 'org-1', userId: 'user-1' }) }))
  vi.mock('./api', () => ({
    AssistantError: class AssistantError extends Error {},
    listConversations: async () => [],
    listMessages: async () => [],
    sendAssistantMessage: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
  }))

  function Nav() {
    const navigate = useNavigate()
    return <button onClick={() => navigate('/assistente?q=Segunda%20pergunta')}>navegar</button>
  }

  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/assistente?q=Primeira%20pergunta']}>
            <Routes>
              <Route path="/assistente" element={<><AssistantPage /><Nav /></>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    )
  }

  describe('AssistantPage', () => {
    it('aproveita ?q mesmo quando a página já está montada', async () => {
      setup()
      const textarea = (await screen.findByLabelText('Mensagem para o assistente')) as HTMLTextAreaElement
      await waitFor(() => expect(textarea.value).toBe('Primeira pergunta'))

      fireEvent.click(screen.getByRole('button', { name: 'navegar' }))
      await waitFor(() => expect(textarea.value).toBe('Segunda pergunta'))
    })
  })
  ```

- Risco da mudança: baixo. O efeito só escreve no campo quando existe `?q`; a remoção do parâmetro continua acontecendo com `replace`. Um usuário que estivesse digitando e recebesse um `?q` externo teria o texto substituído, mas esse é o comportamento esperado do atalho.

## Otimizações de desempenho e custo

1. **Resumo financeiro no banco**: `useFinanceSummary` (`src/features/contracts/api.ts:63-105`) baixa todas as linhas de `contract_overview` e todas as parcelas vencidas para somar em JavaScript. Em escritórios grandes isso vira tráfego e memória proporcionais ao histórico. Uma RPC `finance_summary(p_org)` (ou uma view agregada) devolveria apenas 6 números. Ganho de rede e de tempo de render; não muda a UI.
2. **Índices para relatórios**: as consultas de `src/features/reports/api.ts:19-27` filtram `demands` por `opened_at`/`closed_at`, mas a tabela só tem índices por status/categoria/etapa/cliente/responsável/stage_changed_at. Índices `demands(organization_id, opened_at)` e `demands(organization_id, closed_at)` evitam varredura do escritório inteiro ao gerar relatórios por período. `tasks(organization_id, completed_at)` também ajudaria a consulta de produtividade.
3. **Paginação de `fetchAllRows`**: o laço busca 1000 linhas por vez sequencialmente (`contracts/api.ts:27-36`). Como o total já é conhecido em várias consultas (`count: 'exact'`), dá para disparar as páginas em paralelo com um limite; reduz a latência em relatórios e no resumo financeiro sem alterar resultados.
4. **Busca de contratos por cliente**: `useContractList` limita a busca de clientes a 300 ids (`contracts/api.ts:121-128`). Se o termo casar com mais de 300 clientes, contratos ficam de fora silenciosamente. O caminho correto é uma view/RPC que faça o join `contract_overview × clients` no banco, com `ilike` e paginação.
5. **Bundle**: o leitor de `.xlsx` já é importado dinamicamente em `readFile.ts:33`; manter assim. As páginas usam `lazy` em `App.tsx`; não foi encontrado import pesado estático novo nos módulos revisados.

## Itens analisados sem problema

- **RLS e isolamento por escritório**: as consultas revisadas filtram `organization_id` e enviam `organization_id` nos inserts; as FKs compostas das migrations 001/002 sustentam o isolamento no banco. A exceção encontrada foi o `ClientPicker` (proposta 3).
- **Dashboard**: `dashboard_metrics` usa `timezone = 'America/Sao_Paulo'`, exclui rascunhos de `fees_expected` e de `revenue_monthly.expected`, e conta clientes anonimizados fora de `clients_total` (007). O caso de pagamento em rascunho é a exceção (proposta 1).
- **Parcelas**: `installment_overview` prioriza `paga`, depois `cancelada`, `rascunho`, `vencida`, `parcial` e `a_vencer`; a precedência é coerente com os testes de `business_rules_test.sql`. `computeInstallments`/`addMonthsISO` batem com `generate_installments` (truncamento em centavos e clamp de fim de mês).
- **CSV/planilhas**: `src/lib/csv.ts` trata BOM, detecta `;`/`,`/tab, aspas RFC 4180, quebras dentro de campos, Windows-1252 e proteção contra injeção de fórmula (`FORMULA_START`). `readFile.ts` limita 5 MB/5000 linhas e rejeita `.xls`; a API do `read-excel-file` v9 devolve `Sheet[]` com `{ sheet, data }`, compatível com o uso atual (verificado nos tipos instalados).
- **Telefone/WhatsApp/e-mail**: `normalizeBrPhone` valida DDDs da Anatel, trata `+55`, `0` de longa distância e celular/fixo; `buildWhatsAppLink`/`buildMailtoLink` codificam o texto e não disparam envio automático.
- **Modelos de mensagem**: `fillTemplate` substitui variáveis por função (o valor não é interpretado como `$&`/`$1`), e `validateRewrite` exige o mesmo conjunto de variáveis antes/depois da IA.
- **Busca de clientes**: `parseClientSearch` diferencia CPF de nome e escapa curingas com `escapeLike`; a paginação usa `PAGE_SIZE` e `keepPreviousData`.
- **Relatórios**: a sintaxe `.or()` com timestamps entre aspas em `reports/api.ts:24` é válida no PostgREST; os limites de período usam o início local convertido para ISO e as agregações puras de `aggregate.ts` são testáveis.
- **Busca global**: `CommandPalette` tem combobox/listbox com `aria-selected`, navegação por setas/Enter, Esc, atalho Ctrl+K e debounce; o caminho do assistente é o único ponto com perda de estado (proposta 6).
- **Importação**: `normalize.ts`/`rows.ts`/`dedupe.ts` normalizam CPF/telefone/data, tratam CPF com zero à esquerda e fazem deduplicação por CPF e nome; os limites de arquivo/linhas são aplicados antes do processamento.
- **Edge Functions (revisão de leitura)**: os provedores Anthropic/OpenAI usam `AbortSignal.timeout(60s)`, não repassam o corpo de erro do provedor ao usuário e convertem falhas de rede em `ProviderError`; o laço do assistente limita rodadas e usa `toolChoice: 'none'` no fim. Não foi feita auditoria exaustiva de todas as funções nesta rodada.

FIM DO RELATÓRIO DEEPSEEK
