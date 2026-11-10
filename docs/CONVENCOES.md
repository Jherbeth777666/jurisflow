# Convenções de código — JurisFlow AI

Leia antes de alterar qualquer módulo.

## Estrutura
```
src/
  components/ui/        Kit de UI (Button, Input, Select, Textarea, Checkbox, Modal, ConfirmDialog,
                        Badge/StatusBadge/CategoryTag, Card/CardHeader/CardBody, Table/THead/TH/TBody/TR/TD,
                        Pagination, PageHeader, Tabs, SearchInput, Avatar, StatCard, Spinner, Skeleton,
                        TableSkeleton, EmptyState, ErrorState, InlineError, useToast)  → import de '@/components/ui'
  components/           ClientPicker (busca de cliente), ActivityFeed (histórico via activity_logs)
  components/layout/    AppLayout (menu lateral)
  contexts/AuthContext  useAuth() / useOrg() → { orgId, userId, role, can(perm), organization, profile }
  hooks/useOrgData.ts   qk (chaves de cache), useMembers, useMemberNames, useCategories (com etapas), useClientLookup
  lib/                  supabase (cliente, friendlyError, unwrap), format (moeda/CPF/datas), constants (rótulos+tons),
                        permissions (can), cn
  types/database.ts     Tipos de todas as tabelas/views/RPCs
  features/<módulo>/    Páginas, modais e api.ts de cada módulo
supabase/migrations/    SQL versionado (001 schema, 002 regras/RPC/views, 003 RLS)
supabase/tests/         Testes SQL (*_test.sql) executados por run_local.sh
```

## Regras
1. **Sempre filtre por `organization_id = orgId`** nas consultas (a RLS também filtra — defesa em profundidade) e envie `organization_id: orgId` em inserts.
2. Dados via **@tanstack/react-query**. Use as chaves de `qk` (prefixadas por orgId). Após mutações, invalide as chaves afetadas — inclusive `qk.dashboard(orgId)`.
3. Erros: `unwrap(await supabase...)` lança `Error` com mensagem em português (`friendlyError`). Mostre com `ErrorState`, `InlineError` ou `useToast().show(msg, 'error')`.
4. Toda tela tem: carregamento (`TableSkeleton`/`Spinner`), erro (`ErrorState` com retry), vazio (`EmptyState` com ação), e confirmação (`ConfirmDialog`) para ações destrutivas.
5. Permissões na UI via `can('...')` de `useOrg()` — apenas para esconder/desabilitar; quem garante é a RLS.
6. Datas `date` são strings `'YYYY-MM-DD'`: use `formatDate`, `todayISO`, `addDaysISO`, `diffInDays` de `lib/format` (nunca `new Date('YYYY-MM-DD')`, que erra o dia em UTC-3).
7. Valores monetários: `formatCurrency`; entrada com `parseCurrency`. Numéricos do Postgres podem chegar como string → `Number(x)`.
8. CPF/telefone são gravados **só com dígitos** (`onlyDigits`); exiba com `formatCPF`/`formatPhone`; em listas use `maskCPF`.
9. Tudo em **português brasileiro**. Nada de botões sem função, nada de dados fictícios apresentados como reais.
10. Estilo: tokens do `index.css` (`bg-canvas`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-line`, `navy-*`, `accent-*`). Cards discretos, tabelas densas, sem gradientes. Ícones `lucide-react` com `size-4`.
11. Layout responsivo: tabelas com `overflow-x-auto` (já no `Table`), filtros empilham em telas pequenas.
12. TypeScript estrito; sem `any` (use os tipos de `types/database.ts`).

## Regras do banco que afetam a UI
- `demands.stage_id` nulo → o banco escolhe a 1ª etapa da categoria. Mover para etapa `is_final` marca a demanda como `concluida` automaticamente; `stage_changed_at` é atualizado a cada mudança de etapa.
- Mudar a categoria de uma demanda sem trocar a etapa → volta para a 1ª etapa da nova categoria.
- Inserir contrato gera parcelas automaticamente (`installments`). Alterar valor/parcelas/1º vencimento só é permitido sem pagamentos.
- Pagamento deve referenciar `installment_id` da mesma `contract_id`. Status `quitado/ativo` é recalculado automaticamente.
- Views: `contract_overview` (recebido, saldo, parcelas vencidas, próximo vencimento) e `installment_overview` (status por parcela).
- RPCs: `dashboard_metrics(p_org)`, `create_organization(p_name)`, convites com consentimento `my_pending_invitations()`, `accept_invitation(p_id)`, `decline_invitation(p_id)`, `leave_organization(p_org)` (`accept_pending_invitations()` está obsoleta e sempre retorna 0), `anonymize_client(p_client)`, `reorder_workflow_stages(p_category, p_stage_ids)`, `delete_workflow_stage(p_stage, p_move_to)`.
- `activity_logs` é preenchido por triggers; para clientes só registra os NOMES dos campos alterados.
- Clientes com demandas/contratos não podem ser excluídos (FK restrict) → oferecer **anonimizar** (admin).

## Regras adicionadas na auditoria (migration 010 e frontend)
- **Grants explícitos:** tabelas e funções nascem fechadas. Toda RPC nova precisa de `grant execute ... to authenticated` explícito na migration; funções internas/trigger não recebem EXECUTE.
- **Testes do banco** usam o stub com os *default privileges* reais do Supabase — um grant esquecido aparece nos testes.
- **Pagamentos:** bloqueados em contrato `rascunho`, acima do saldo do contrato ou da parcela; contrato com pagamentos não troca de cliente.
- **Datas de sistema** (`created_at`, `stage_changed_at`, `closed_at`, `completed_at`) são definidas pelo banco; não envie esses campos.
- **Status × etapa:** reabrir demanda em etapa final volta para a etapa anterior; concluir em etapa não final vai para a etapa final.
- **"Parada há N dias":** sempre `daysSince` / `isStalledSince` / `STALLED_DAYS` de `lib/format` (dias de calendário).
- **Modal:** passe `dirty` em formulários para não perder dados ao clicar fora. **Tabs:** use `idPrefix` e ligue os painéis por `aria-controls`.
- **Paginação:** use `usePageClamp` em listas paginadas.
- **IA:** resultados de ferramentas vão num envelope de dados não confiáveis, sem URLs; histórico limitado a 8000 caracteres; prazo de 45 s; cota por hora (máx. 200) e teto mensal por escritório (`AI_MONTHLY_ORG_LIMIT`).
