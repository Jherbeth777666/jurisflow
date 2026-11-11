# Relatório DEEPSEEK

## Resumo

Analisei todos os módulos de `src/features`, as migrations 001→009 e as três Edge Functions (`ai-assistant`, `ai-compose`, `ai-import`). A base está madura: não encontrei `TODO`/`FIXME`/`@ts-ignore`/`as any`, e vários pontos que pareciam suspeitos já foram corrigidos nas migrations 005/007/008 (por exemplo, parcelas de rascunho já ficam fora dos recebíveis e do dashboard).

Este relatório traz **6 propostas** (3 de severidade alta, 3 média), todas localizadas e reversíveis:

1. **[ALTA]** Contrato em rascunho aceita pagamento (frontend + banco).
2. **[ALTA]** Filtro de status de demandas pode gerar consulta contraditória e lista sempre vazia.
3. **[ALTA]** Limite de corpo das Edge Functions medido em unidades UTF-16, não em bytes.
4. **[MÉDIA]** Contrato com pagamentos pode trocar de cliente, movendo o histórico financeiro.
5. **[MÉDIA]** Faixas de inadimplência não somam o total quando `days <= 0`.
6. **[MÉDIA]** Cota de IA é consumida antes de validar a conversa.

As propostas 1 e 4 compartilham a mesma migration nova (`20261110000010_contract_integrity.sql`). Nenhum arquivo do projeto foi alterado além deste relatório.

---

### [ALTA] Contrato em rascunho aceita pagamento

- Arquivo(s):
  - `supabase/migrations/20261109000002_business_logic.sql:191-203` (`payments_before_write`)
  - `supabase/migrations/20261109000002_business_logic.sql:168-172` (`contracts_after_write` gera parcelas no INSERT)
  - `supabase/migrations/20261109000007_integration_fixes.sql:13-20` (view marca as parcelas como `'rascunho'`)
  - `src/features/contracts/installments.ts:62-69` (`nextOpenInstallment`)
  - `src/features/contracts/PaymentModal.tsx:42`
  - `src/features/contracts/ContractDetailPage.tsx:77,195`

- Problema: `contracts_after_write` chama `generate_installments` em **todo** INSERT, inclusive com `status = 'rascunho'`; a view `installment_overview` (007) marca essas parcelas com status próprio `'rascunho'`. A UI, porém, considera "em aberto" tudo que não é `cancelada`/`paga` — então o detalhe do contrato mostra "Registrar pagamento" e o botão "Receber" em cada parcela, ao mesmo tempo em que o cabeçalho diz "Contrato em rascunho — parcelas ainda não são cobradas" (`ContractDetailPage.tsx:173`). Pior: `payments_before_write` só recusa contrato `cancelado`; logo o pagamento é gravado e `refresh_contract_status` retorna cedo para rascunho (`002:216`). O resultado é um contrato em rascunho com `received_amount > 0`, que some dos recebíveis (`contracts/api.ts:193`) e do resumo financeiro (`contracts/api.ts:93`), mas aparece como recebido no detalhe.

- Correção (diff):

  Nova migration:

  ```diff
  --- /dev/null
  +++ b/supabase/migrations/20261110000010_contract_integrity.sql
  @@
  +-- =============================================================================
  +-- JurisFlow AI — Migration 010: integridade de contratos
  +--  * Contrato em rascunho não pode receber pagamento.
  +--  * Contrato com pagamentos não pode trocar de cliente (ver proposta 4).
  +-- =============================================================================
  +
  +create or replace function public.payments_before_write()
  +returns trigger language plpgsql as $$
  +begin
  +  if new.installment_id is not null and not exists (
  +    select 1 from public.installments where id = new.installment_id and contract_id = new.contract_id
  +  ) then
  +    raise exception 'A parcela informada não pertence a este contrato.' using errcode = 'P0001';
  +  end if;
  +  if exists (
  +    select 1 from public.contracts
  +     where id = new.contract_id and status in ('cancelado', 'rascunho')
  +  ) then
  +    raise exception 'Não é possível registrar pagamento em contrato cancelado ou em rascunho.'
  +      using errcode = 'P0001';
  +  end if;
  +  return new;
  +end $$;
  ```

  Frontend (helper único, reutilizado nos três pontos):

  ```diff
  --- a/src/features/contracts/installments.ts
  +++ b/src/features/contracts/installments.ts
  @@
  +/** Parcela que pode receber pagamento: saldo > 0 e contrato não cancelado nem em rascunho. */
  +export function isPayableInstallment(i: { remaining_amount: number | string; status: string }): boolean {
  +  return Number(i.remaining_amount) > 0 && i.status !== 'cancelada' && i.status !== 'paga' && i.status !== 'rascunho'
  +}
  +
   /** Primeira parcela com saldo em aberto (padrão do modal de pagamento). */
   export function nextOpenInstallment<T extends { number: number; remaining_amount: number | string; status: string }>(
     list: T[],
   ): T | undefined {
     return [...list]
       .sort((a, b) => a.number - b.number)
  -    .find((i) => Number(i.remaining_amount) > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  +    .find(isPayableInstallment)
   }
  ```

  ```diff
  --- a/src/features/contracts/PaymentModal.tsx
  +++ b/src/features/contracts/PaymentModal.tsx
  @@
  -import { formatMoneyInput, nextOpenInstallment, parseMoneyInput } from './installments'
  +import { formatMoneyInput, isPayableInstallment, nextOpenInstallment, parseMoneyInput } from './installments'
  @@
  -  const open_list = all.filter((i) => i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  +  const open_list = all.filter(isPayableInstallment)
  ```

  ```diff
  --- a/src/features/contracts/ContractDetailPage.tsx
  +++ b/src/features/contracts/ContractDetailPage.tsx
  @@
   import { ContractFormModal } from './ContractFormModal'
   import { PaymentModal } from './PaymentModal'
   import { ProgressBar } from './ContractsPage'
  +import { isPayableInstallment } from './installments'
  @@
  -  const hasOpen = instList.some((i) => i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  +  const hasOpen = instList.some(isPayableInstallment)
  @@
  -                    const open = i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga'
  +                    const open = isPayableInstallment(i)
  ```

- Teste que comprova:

  `src/features/contracts/installments.test.ts` (acrescentar ao final; ajustar o import da linha 1):

  ```ts
  import {
    addMonthsISO,
    computeInstallments,
    isPayableInstallment,
    nextOpenInstallment,
    parseMoneyInput,
    formatMoneyInput,
  } from './installments'

  describe('isPayableInstallment', () => {
    it('ignora parcelas de contrato em rascunho', () => {
      expect(isPayableInstallment({ remaining_amount: 100, status: 'rascunho' })).toBe(false)
      expect(nextOpenInstallment([{ number: 1, remaining_amount: 100, status: 'rascunho' }])).toBeUndefined()
    })
    it('mantém parcelas em aberto normais', () => {
      expect(isPayableInstallment({ remaining_amount: 100, status: 'vencida' })).toBe(true)
      expect(isPayableInstallment({ remaining_amount: 100, status: 'parcial' })).toBe(true)
      expect(isPayableInstallment({ remaining_amount: 0, status: 'paga' })).toBe(false)
    })
  })
  ```

  `supabase/tests/business_rules_test.sql` (acrescentar como novo bloco após o `rollback to savepoint t;` da seção de contratos, linha ~304):

  ```sql
  savepoint t;
  do $$
  declare
    o uuid := tstb.id('org');
    v_cli uuid; v_con uuid;
  begin
    perform tstb.login('u_adv');
    insert into clients (organization_id, full_name) values (o, 'Cliente Rascunho') returning id into v_cli;
    insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date, status)
    values (o, v_cli, 300, 3, '2026-12-10', 'rascunho') returning id into v_con;

    perform tstb.eq((select count(*) from installments where contract_id = v_con), 3::bigint, 'rascunho gera parcelas');
    perform tstb.ok((select bool_and(status = 'rascunho') from installment_overview where contract_id = v_con),
                    'parcelas de contrato em rascunho = rascunho');
    perform tstb.expect_error_msg(
      format('insert into payments (organization_id, contract_id, amount) values (%L, %L, 10)', o, v_con),
      'rascunho', 'pagamento em contrato em rascunho');
  end $$;
  rollback to savepoint t;
  ```

- Risco da mudança: baixo. A migration só substitui uma função já existente (o trigger continua o mesmo) e o helper repete exatamente a condição atual acrescentando `rascunho`. Não há mudança de fluxo para contratos ativos/quitados.

---

### [ALTA] Filtro de status de demandas pode gerar consulta contraditória

- Arquivo(s): `src/features/demands/api.ts:32-34`, `src/features/demands/logic.ts:71-80`

- Problema: a consulta aplica **dois** filtros de status ao mesmo tempo quando `filters.status` é fechado e algum atalho de "abertas" está ligado:

  ```ts
  const onlyOpen = filters.status === 'abertas' || filters.waitingDocs || filters.stalled > 0
  if (filters.status !== 'abertas' && filters.status !== 'todas') q = q.eq('status', filters.status)
  if (onlyOpen) q = q.not('status', 'in', closedList)
  ```

  Cenário concreto e alcançável: abrir `/demandas?stalled=15` (chip "Paradas" ativo), trocar o `Select` de status para **Concluídas**. `patchDemandFilters` preserva `stalled`, então a consulta vira `status = 'concluida'` **e** `status not in ('concluida','cancelada')` → sempre vazia. O mesmo ocorre com `waiting_docs=1` + status fechado. O usuário vê "nenhuma demanda" mesmo tendo concluídas.

- Correção (diff):

  Regra única e pura em `logic.ts`:

  ```diff
  --- a/src/features/demands/logic.ts
  +++ b/src/features/demands/logic.ts
  @@
  +export interface DemandStatusConstraint {
  +  eq: DemandStatus | null
  +  excludeClosed: boolean
  +}
  +
  +/**
  + * Regra única do filtro de status: um status específico sempre vence os atalhos
  + * "só abertas" (aguardando documentação/paradas); sem status específico, os
  + * atalhos excluem concluídas e canceladas.
  + */
  +export function statusConstraint(f: Pick<DemandFilters, 'status' | 'waitingDocs' | 'stalled'>): DemandStatusConstraint {
  +  if (f.status !== 'abertas' && f.status !== 'todas') return { eq: f.status, excludeClosed: false }
  +  if (f.status === 'abertas' || f.waitingDocs || f.stalled > 0) return { eq: null, excludeClosed: true }
  +  return { eq: null, excludeClosed: false }
  +}
  +
   /** Aplica uma alteração de filtro; qualquer mudança que não seja de página volta à página 0. */
  ```

  ```diff
  --- a/src/features/demands/api.ts
  +++ b/src/features/demands/api.ts
  @@
  -import { CLOSED_STATUSES, demandFormToPayload, stalledCutoff, type DemandFilters, type DemandFormValues } from './logic'
  +import { CLOSED_STATUSES, demandFormToPayload, stalledCutoff, statusConstraint, type DemandFilters, type DemandFormValues } from './logic'
  @@
  -      const onlyOpen = filters.status === 'abertas' || filters.waitingDocs || filters.stalled > 0
  -      if (filters.status !== 'abertas' && filters.status !== 'todas') q = q.eq('status', filters.status)
  -      if (onlyOpen) q = q.not('status', 'in', closedList)
  +      const status = statusConstraint(filters)
  +      if (status.eq) q = q.eq('status', status.eq)
  +      if (status.excludeClosed) q = q.not('status', 'in', closedList)
  ```

- Teste que comprova:

  `src/features/demands/logic.test.ts` (acrescentar; incluir `statusConstraint` no import da linha 2):

  ```ts
  describe('statusConstraint', () => {
    it('status específico tem prioridade sobre os recortes de abertas', () => {
      expect(statusConstraint({ ...parse('stalled=15'), status: 'concluida' })).toEqual({ eq: 'concluida', excludeClosed: false })
      expect(statusConstraint({ ...parse('waiting_docs=1'), status: 'cancelada' })).toEqual({ eq: 'cancelada', excludeClosed: false })
    })
    it('abertas/todas com atalhos excluem os status fechados', () => {
      expect(statusConstraint(parse(''))).toEqual({ eq: null, excludeClosed: true })
      expect(statusConstraint(parse('status=todas'))).toEqual({ eq: null, excludeClosed: false })
      expect(statusConstraint(parse('status=todas&stalled=15'))).toEqual({ eq: null, excludeClosed: true })
    })
    it('URL com stalled + troca para Concluídas deixa de ser contraditória', () => {
      const f = patchDemandFilters(parse('stalled=15'), { status: 'concluida' })
      expect(statusConstraint(f)).toEqual({ eq: 'concluida', excludeClosed: false })
    })
  })
  ```

- Risco da mudança: baixo. Para `status='todas'` sem atalhos o comportamento é idêntico; a única mudança é que um status explícito passa a vencer o recorte de abertas, eliminando a contradição. O filtro de etapa (`waiting_docs`) e o de data (`stalled`) continuam aplicados como filtros adicionais coerentes.

---

### [ALTA] Limite de corpo das Edge Functions medido em unidades UTF-16

- Arquivo(s):
  - `supabase/functions/ai-assistant/index.ts:63`
  - `supabase/functions/ai-compose/index.ts:79`
  - `supabase/functions/ai-import/index.ts:72`

- Problema: os três endpoints comparam `rawText.length` com um limite em **bytes**. `String.length` conta unidades UTF-16: um `á` vale 1 (2 bytes UTF-8) e um emoji vale 2 (4 bytes UTF-8). Em `ai-import`, cujo limite é 32 KB e cujo payload é uma planilha convertida em texto (com acentos em praticamente toda linha), um corpo de ~20 mil caracteres acentuados passa na checagem mesmo tendo ~40 KB, indo para `JSON.parse` e para o provedor. Em `ai-compose` (8 KB) o desvio é proporcional. Isso anula o limite de robustez/custo que a função tenta impor.

- Correção (diff):

  Novo utilitário compartilhado (as três funções já importam módulos de `../ai-assistant`, então `../_shared` segue o mesmo padrão do Supabase):

  ```diff
  --- /dev/null
  +++ b/supabase/functions/_shared/bytes.ts
  @@
  +// Tamanho real em bytes UTF-8 (String.length conta unidades UTF-16).
  +const encoder = new TextEncoder()
  +
  +export function utf8ByteLength(text: string): number {
  +  return encoder.encode(text).length
  +}
  +
  +export function exceedsBodyLimit(text: string, maxBytes: number): boolean {
  +  return utf8ByteLength(text) > maxBytes
  +}
  ```

  ```diff
  --- a/supabase/functions/ai-assistant/index.ts
  +++ b/supabase/functions/ai-assistant/index.ts
  @@
   import {
     MAX_BODY_BYTES,
     bearerToken,
     conversationTitle,
     corsHeaders,
     isOriginAllowed,
     parseAllowedOrigins,
     validateBody,
   } from './request.ts'
  +import { exceedsBodyLimit } from '../_shared/bytes.ts'
  @@
  -  if (rawText.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Mensagem muito grande.')
  +  if (exceedsBodyLimit(rawText, MAX_BODY_BYTES)) return fail(413, 'payload_too_large', 'Mensagem muito grande.')
  ```

  ```diff
  --- a/supabase/functions/ai-compose/index.ts
  +++ b/supabase/functions/ai-compose/index.ts
  @@
   import {
     MAX_BODY_BYTES,
     buildComposeSystemPrompt,
     buildComposeUserMessage,
     checkRewrite,
     validateComposeBody,
   } from './compose.ts'
  +import { exceedsBodyLimit } from '../_shared/bytes.ts'
  @@
  -  if (rawText.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Modelo muito grande.')
  +  if (exceedsBodyLimit(rawText, MAX_BODY_BYTES)) return fail(413, 'payload_too_large', 'Modelo muito grande.')
  ```

  ```diff
  --- a/supabase/functions/ai-import/index.ts
  +++ b/supabase/functions/ai-import/index.ts
  @@
   import { buildImportSystemPrompt, buildImportUserMessage } from './prompt.ts'
   import { LIMITS, validateAIResponse, validateInput } from './validate.ts'
  +import { exceedsBodyLimit } from '../_shared/bytes.ts'
  @@
  -  if (rawText.length > LIMITS.bodyBytes) return fail(413, 'payload_too_large', 'Requisição muito grande.')
  +  if (exceedsBodyLimit(rawText, LIMITS.bodyBytes)) return fail(413, 'payload_too_large', 'Requisição muito grande.')
  ```

- Teste que comprova:

  ```ts
  // supabase/functions/_shared/bytes.test.ts
  // @vitest-environment node
  import { describe, expect, it } from 'vitest'
  import { exceedsBodyLimit, utf8ByteLength } from './bytes.ts'

  describe('limite de corpo em bytes UTF-8', () => {
    it('conta bytes, não unidades UTF-16', () => {
      expect(utf8ByteLength('a')).toBe(1)
      expect(utf8ByteLength('á')).toBe(2)
      expect(utf8ByteLength('😀')).toBe(4)
      expect(exceedsBodyLimit('a'.repeat(16), 16)).toBe(false)
      // 9 caracteres acentuados = 9 unidades UTF-16, mas 18 bytes UTF-8
      expect('á'.repeat(9).length).toBeLessThanOrEqual(16)
      expect(exceedsBodyLimit('á'.repeat(9), 16)).toBe(true)
    })
  })
  ```

- Risco da mudança: baixo. Só endurece a validação para o limite que já era a intenção; payloads legítimos (ASCII ou com poucos acentos) continuam passando. O novo diretório `_shared` é o padrão do Supabase e não altera a arquitetura das funções.

---

### [MÉDIA] Contrato com pagamentos pode trocar de cliente

- Arquivo(s): `src/features/contracts/ContractFormModal.tsx:214-224`; `supabase/migrations/20261109000002_business_logic.sql:168-183` (não há guarda)

- Problema: ao editar um contrato que já tem pagamentos, o formulário bloqueia valor/parcelas/1º vencimento (`locked`, linhas 88-90 e 274-307), mas o `ClientPicker` continua habilitado. Trocar o cliente move o contrato — e todos os pagamentos já recebidos — para a ficha financeira de outra pessoa. O contrato some do detalhe/exportação do cliente original e aparece no do novo, sem qualquer aviso; o banco não impede (só `total_amount`/`installments_count`/`first_due_date` têm guarda). O texto de aviso (linhas 267-269) também não menciona o cliente, reforçando que a alteração parece permitida.

- Correção (diff):

  Mesma migration da proposta 1 (acrescentar o bloco):

  ```diff
  --- a/supabase/migrations/20261110000010_contract_integrity.sql
  +++ b/supabase/migrations/20261110000010_contract_integrity.sql
  @@
   end $$;
  +
  +create or replace function public.contracts_before_write()
  +returns trigger language plpgsql as $$
  +begin
  +  if tg_op = 'UPDATE'
  +     and new.client_id is distinct from old.client_id
  +     and exists (select 1 from public.payments where contract_id = old.id) then
  +    raise exception 'Não é possível trocar o cliente de um contrato que já possui pagamentos.'
  +      using errcode = 'P0001';
  +  end if;
  +  return new;
  +end $$;
  +
  +drop trigger if exists contracts_before_write on public.contracts;
  +create trigger contracts_before_write before update on public.contracts
  +  for each row execute function public.contracts_before_write();
  ```

  ```diff
  --- a/src/features/contracts/ContractFormModal.tsx
  +++ b/src/features/contracts/ContractFormModal.tsx
  @@
           <ClientPicker
             value={form.client_id}
  +          disabled={locked}
             onChange={(id) => {
  @@
                Este contrato já possui {paymentCount.data} pagamento{paymentCount.data === 1 ? '' : 's'} registrado
  -              {paymentCount.data === 1 ? '' : 's'}. Valor, quantidade de parcelas e 1º vencimento não podem ser alterados — estorne os
  +              {paymentCount.data === 1 ? '' : 's'}. Cliente, valor, quantidade de parcelas e 1º vencimento não podem ser alterados — estorne os
                pagamentos antes, se precisar refazer o parcelamento.
  ```

- Teste que comprova:

  `supabase/tests/business_rules_test.sql` (acrescentar bloco próprio):

  ```sql
  savepoint t;
  do $$
  declare
    o uuid := tstb.id('org');
    v_cli uuid; v_cli2 uuid; v_con uuid; v_con2 uuid;
  begin
    perform tstb.login('u_adv');
    insert into clients (organization_id, full_name) values (o, 'Cliente A') returning id into v_cli;
    insert into clients (organization_id, full_name) values (o, 'Cliente B') returning id into v_cli2;
    insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
    values (o, v_cli, 100, 1, '2026-12-10') returning id into v_con;
    insert into contracts (organization_id, client_id, total_amount, installments_count, first_due_date)
    values (o, v_cli, 100, 1, '2026-12-10') returning id into v_con2;
    insert into payments (organization_id, contract_id, amount) values (o, v_con, 50);

    perform tstb.expect_error_msg(
      format('update contracts set client_id = %L where id = %L', v_cli2, v_con),
      'trocar o cliente', 'trocar cliente de contrato com pagamentos');
    perform tstb.eq((select client_id from contracts where id = v_con), v_cli,
                    'cliente permanece após tentativa recusada');

    -- sem pagamentos, a troca continua permitida
    update contracts set client_id = v_cli2 where id = v_con2;
    perform tstb.eq((select client_id from contracts where id = v_con2), v_cli2,
                    'troca de cliente liberada sem pagamentos');
  end $$;
  rollback to savepoint t;
  ```

- Risco da mudança: baixo/médio. A guarda no banco é restritiva apenas para contratos com pagamentos (operação hoje inconsistente); para contratos sem pagamentos nada muda. O `disabled` no seletor apenas reflete a regra já aplicada aos demais campos financeiros.

---

### [MÉDIA] Faixas de inadimplência não somam o total quando `days <= 0`

- Arquivo(s): `src/features/reports/aggregate.ts:255-279`

- Problema: `overdueSummary` filtra `status === 'vencida'` e calcula `days = diffInDays(due_date, today)`. Se `days <= 0` (vencimento igual a "hoje" por diferença entre o fuso do navegador e o de São Paulo usado pela view, ou por relógio adiantado), a linha entra em `total`, `count`, `clients` e `contracts`, mas **não** entra em nenhuma faixa (as faixas começam em 1). O relatório mostra uma tabela de faixas cuja soma não bate com o total exibido — e a linha fica invisível na lista por faixa.

- Correção (diff):

  ```diff
  --- a/src/features/reports/aggregate.ts
  +++ b/src/features/reports/aggregate.ts
  @@
     const rows = list
       .filter((i) => i.status === 'vencida' && Number(i.remaining_amount) > 0)
  -    .map((i) => ({ ...i, remaining: Number(i.remaining_amount), days: diffInDays(i.due_date, today) }))
  +    // 'vencida' com vencimento hoje (fuso/relógio) entra na 1ª faixa em vez de sumir dos buckets
  +    .map((i) => ({ ...i, remaining: Number(i.remaining_amount), days: Math.max(1, diffInDays(i.due_date, today)) }))
       .sort((a, b) => b.days - a.days)
  ```

- Teste que comprova:

  `src/features/reports/aggregate.test.ts` (acrescentar):

  ```ts
  it('vencida com due_date de hoje entra na 1ª faixa e os buckets somam o total', () => {
    const s = overdueSummary(
      [
        {
          id: 'i1',
          contract_id: 'c1',
          client_id: 'cl1',
          number: 1,
          due_date: '2026-03-10',
          remaining_amount: 100,
          status: 'vencida',
        },
      ],
      '2026-03-10',
    )
    expect(s.rows[0].days).toBe(1)
    expect(s.buckets[0]).toMatchObject({ count: 1, total: 100 })
    expect(s.buckets.reduce((n, b) => n + b.count, 0)).toBe(s.count)
    expect(s.buckets.reduce((n, b) => n + b.total, 0)).toBe(s.total)
  })
  ```

- Risco da mudança: baixo. Só classifica como "1–30 dias" o que já era vencido; nenhuma linha muda de faixa além das que antes não apareciam.

---

### [MÉDIA] Cota de IA é consumida antes de validar a conversa

- Arquivo(s): `supabase/functions/ai-assistant/index.ts:98-142`

- Problema: `ai_consume_quota` (linha 100) roda antes de verificar se `conversationId` existe e pertence ao usuário (linhas 116-124). Um cliente com um id antigo/ inválido (por exemplo, conversa apagada em outra aba, ou id de outro usuário) queima uma mensagem da cota e recebe 404 em seguida. A cota é o limite de custo por usuário/hora; erros de cliente não deveriam consumi-la. Como a criação de conversa nova (`else`, linhas 134-142) também está antes, movê-la para depois evita criar conversa vazia quando a cota estiver esgotada.

- Correção (diff):

  Reordenar: validar/carregar a conversa existente → redigir a mensagem → consumir a cota → criar conversa nova (se for o caso) → gravar a mensagem.

  ```diff
  --- a/supabase/functions/ai-assistant/index.ts
  +++ b/supabase/functions/ai-assistant/index.ts
  @@
  -  // --- Rate limit (mensagens do usuário na última hora) ---------------------
  -  // Cota persistente (ai_usage): excluir conversas não zera a contagem.
  -  const { data: allowed, error: quotaError } = await supabase.rpc('ai_consume_quota', {
  -    p_org: orgId,
  -    p_kind: 'assistant',
  -    p_limit_per_hour: rateLimitPerHour,
  -  })
  -  if (quotaError) return fail(500, 'db_error', 'Não foi possível verificar o limite de uso.')
  -  if (allowed !== true) {
  -    return fail(429, 'rate_limited', `Limite de ${rateLimitPerHour} mensagens por hora atingido. Tente novamente mais tarde.`)
  -  }
  -
  -  // --- Privacidade: remove CPF/telefone/e-mail da pergunta -------------------
  -  const redaction = redactPII(message)
  -  const safeMessage = redaction.text
  -
  -  // --- Conversa ---------------------------------------------------------------
  +  // --- Conversa existente: valida ANTES de consumir a cota -------------------
     let history: HistoryMessage[] = []
     if (conversationId) {
       const { data: conv } = await supabase
         .from('ai_conversations')
         .select('id')
         .eq('id', conversationId)
         .eq('organization_id', orgId)
         .eq('user_id', userId)
         .maybeSingle()
       if (!conv) return fail(404, 'conversation_not_found', 'Conversa não encontrada.')
       const { data: msgs, error: histError } = await supabase
         .from('ai_messages')
         .select('role, content')
         .eq('conversation_id', conversationId)
         .eq('organization_id', orgId)
         .order('created_at', { ascending: false })
         .limit(HISTORY_LIMIT)
       if (histError) return fail(500, 'db_error', 'Não foi possível carregar o histórico.')
       history = ((msgs ?? []) as HistoryMessage[]).reverse()
  -  } else {
  +  }
  +
  +  // --- Privacidade: remove CPF/telefone/e-mail da pergunta -------------------
  +  const redaction = redactPII(message)
  +  const safeMessage = redaction.text
  +
  +  // --- Rate limit (mensagens do usuário na última hora) ---------------------
  +  // Cota persistente (ai_usage): excluir conversas não zera a contagem.
  +  const { data: allowed, error: quotaError } = await supabase.rpc('ai_consume_quota', {
  +    p_org: orgId,
  +    p_kind: 'assistant',
  +    p_limit_per_hour: rateLimitPerHour,
  +  })
  +  if (quotaError) return fail(500, 'db_error', 'Não foi possível verificar o limite de uso.')
  +  if (allowed !== true) {
  +    return fail(429, 'rate_limited', `Limite de ${rateLimitPerHour} mensagens por hora atingido. Tente novamente mais tarde.`)
  +  }
  +
  +  // --- Nova conversa: só depois de a cota ser aprovada -----------------------
  +  if (!conversationId) {
       const { data: conv, error: convError } = await supabase
         .from('ai_conversations')
         .insert({ organization_id: orgId, user_id: userId, title: conversationTitle(safeMessage) })
         .select('id')
         .single()
       if (convError || !conv) return fail(500, 'db_error', 'Não foi possível criar a conversa.')
       conversationId = conv.id as string
     }
  ```

- Teste que comprova: `index.ts` é Deno e não é importável pelo vitest (tem `Deno.serve` no topo), então o teste é de integração, executado com a função local (`supabase functions serve`) e um usuário real:

  ```bash
  # 1) cota inicial
  psql "$DB_URL" -c "select count(*) from ai_usage where user_id = '<USER_ID>' and kind = 'assistant';"
  # 2) chamada com conversa inexistente (id aleatório válido)
  curl -s -X POST "http://127.0.0.1:54321/functions/v1/ai-assistant" \
    -H "Authorization: Bearer <JWT>" -H "Content-Type: application/json" \
    -d '{"organization_id":"<ORG_ID>","conversation_id":"00000000-0000-4000-8000-000000000000","message":"oi"}'
  # esperado: 404 {"code":"conversation_not_found"}
  # 3) a contagem em ai_usage NÃO deve ter aumentado
  ```

- Risco da mudança: baixo. A ordem relativa entre validação de conversa e cota muda apenas para requisições inválidas; o fluxo feliz (conversa válida ou nova) continua igual, e a criação de conversa nova passa a acontecer somente após a cota, o que evita lixo no banco.

---

## Otimizações de desempenho e custo

Itens reais, mas que exigem teste de integração/consulta e por isso ficam fora das propostas principais:

1. **Busca de contratos limitada a 300 clientes** (`src/features/contracts/api.ts:121-131`). `ilike` em `clients` com `.limit(300)` faz com que contratos de clientes além dos 300 primeiros (ordem indefinida) desapareçam ao buscar por nome. Além disso, `fetchClientNames` faz uma segunda consulta por página. Sugestão: expor `client_name` em `contract_overview` (nova migration, `join clients`) e filtrar direto na view (`.ilike('client_name', ...)`), removendo o `.limit(300)` e a consulta extra. Ganho: correção + menos uma ida ao banco por página.
2. **Recebíveis truncados em 500** (`src/features/contracts/api.ts:169-177`). `.limit(500)` sem paginação esconde parcelas de escritórios com mais de 500 recebíveis em aberto. Sugestão: reutilizar `fetchAllRows` com `.order('due_date').order('id')` e `.range(f, t)` (a função já existe no mesmo arquivo).
3. **Kanban truncado em 1000** (`src/features/workflows/api.ts:36`). `useBoardDemands` usa `.limit(1000)`; acima disso, cards somem sem aviso. Sugestão: paginar por etapa (uma consulta por coluna) ou exibir aviso quando `count > 1000`.
4. **Exportações truncadas em 5000** (`src/features/clients/ExportClients.tsx`, `src/features/demands/ExportDemands.tsx`). `.limit(5000)` corta silenciosamente o CSV. Sugestão: `fetchAllRows` com `.order('id')`, como já é feito em `reports/api.ts`.
5. **N+1 em `useReceivables`**: depois de buscar as parcelas, há uma consulta em blocos de 200 para contratos e outra para nomes de clientes. Se a view passar a expor `contract_type`/`installments_count`/`client_name`, o fluxo vira uma consulta só.
6. **Bundle**: `ContractDetailPage` importa `ProgressBar` de `ContractsPage` (`ContractDetailPage.tsx:33`), puxando o módulo da listagem para o chunk de detalhe. Mover `ProgressBar` para `src/components/ui` reduz o chunk (impacto pequeno, mas é uma dependência cruzada evitável).

## Itens analisados sem problema

- **Parcelas de rascunho nos recebíveis/dashboard**: já tratadas. A view 007 cria o status `'rascunho'`, `useReceivables` filtra o contrato (`contracts/api.ts:193`) e `useFinanceSummary` ignora rascunhos (`contracts/api.ts:88-100`). O problema real é só a UI de pagamento (proposta 1).
- **`computeInstallments` com `baseCents <= 0`**: retorna `[]`, coerente com `amount > 0` no banco; não é bug.
- **`normalizeBrPhone`** (`messages/whatsapp.ts`): DDDs válidos, tratamento de `+55`/`0` e regra do 9 conferem; não encontrei entrada que gere link inválido.
- **`variables.ts`**: `fillTemplate` usa função de substituição (não interpreta `$&`), `VAR_RE` é global mas `matchAll`/`replace` não compartilham estado mutável; sem bug.
- **`dedupe.ts`**: Jaro-Winkler, conflito de CPF e precedência das regras estão cobertos por testes e coerentes com os comentários.
- **`parseClientSearch`**: heurística de CPF (dígitos + `. - espaço`) e `escapeLike` no nome estão corretas; CPF nunca contém `/`.
- **`reports/api.ts` `.or(...)` com timestamps entre aspas**: sintaxe válida do PostgREST; descartado.
- **Trigger `demands_before_write`** (`002:87-119`): concluir manualmente (`status='concluida'`) sem mudar de etapa mantém a etapa não-final. O formulário permite isso (`DemandFormModal.tsx:220`), mas tratei como comportamento intencional (concluir sem mover o card); não proponho mudança para não alterar regra de negócio sem confirmação.
- **Permissões**: `src/lib/permissions.ts` e `ROLE_CAPABILITIES` batem com as políticas da migration 003 e com o que a UI esconde/exibe.
- **Estados de carregamento/vazio/erro**: `States.tsx`, `TableSkeleton` e as páginas dos módulos cobrem os três estados; não achei tela sem tratamento.
- **`useOpenFromParam`, `Pagination` e `Table`**: comportamento consistente; `Pagination` retorna `null` quando não há mais de uma página, o que é intencional.

FIM DO RELATÓRIO DEEPSEEK
