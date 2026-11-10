# Arquitetura — JurisFlow AI (MVP)

## Visão geral

```
┌──────────────────────────┐        HTTPS (JWT do usuário)        ┌──────────────────────────────┐
│  Frontend (Netlify)      │ ───────────────────────────────────▶ │  Supabase                    │
│  React + TS + Vite       │   PostgREST / RPC (anon key + JWT)   │  ├─ Auth (e-mail/senha)      │
│  Tailwind v4, Recharts,  │                                       │  ├─ PostgreSQL + RLS         │
│  React Query, dnd-kit    │ ──── functions.invoke('ai-assistant') │  │   (isolamento por escritório)
└──────────────────────────┘                                       │  └─ Edge Function ai-assistant│
                                                                   │        │ ferramentas = RPCs   │
                                                                   │        │ SECURITY INVOKER     │
                                                                   └────────┼─────────────────────┘
                                                                            ▼
                                                                   Provedor LLM (Gemini / DeepSeek / Groq / Anthropic / OpenAI-compat.)
                                                                   recebe só dados pseudonimizados
```

Sem backend próprio: toda regra crítica vive no banco (constraints, FKs compostas, triggers e RLS) e a única
lógica de servidor é a Edge Function do assistente, necessária para proteger a chave do provedor de IA.
Não há Python/FastAPI — não havia justificativa técnica.

## Decisões principais

| Decisão | Motivo |
|---|---|
| **FKs compostas `(organization_id, id)`** | O banco impede, por construção, que uma demanda aponte para cliente/etapa/responsável de outro escritório — independente do frontend ou da RLS. |
| **RLS em todas as tabelas** + funções `is_org_member` / `has_org_role` (SECURITY DEFINER, `search_path` fixo) | Isolamento multiempresa e papéis aplicados no Postgres; evita recursão de políticas. |
| **Trigger `prevent_org_change`** | Registro nunca muda de escritório depois de criado. |
| **Auditoria por trigger** (`activity_logs`) | Histórico de alterações confiável (não depende do cliente). Para clientes registra apenas *nomes* de campos alterados, nunca valores de CPF/telefone (LGPD — minimização). |
| **Etapas com flags `is_final` / `is_waiting_docs`** | Fluxos 100% personalizáveis sem quebrar indicadores ("aguardando documentos", conclusão automática). |
| **`stage_changed_at`** | Permite medir "demanda parada há X dias" com precisão (usado no Kanban, lista, dashboard e IA). |
| **Parcelas geradas no banco** + views `contract_overview` / `installment_overview` (`security_invoker`) | Valor recebido, saldo, vencidas e próximos recebimentos sempre consistentes; arredondamento exato (última parcela absorve o resto). |
| **`dashboard_metrics()` no banco** | Indicadores calculados com dados reais em uma ida ao servidor, respeitando RLS. |
| **Convites por e-mail sem envio** | O admin convida o e-mail; ao entrar com e-mail confirmado a pessoa vê o convite (`my_pending_invitations()`) e aceita ou recusa explicitamente (`accept_invitation`/`decline_invitation`, migration 010; validade de 14 dias). Sem serviço de e-mail no MVP — e a UI não finge que há. |
| **Anonimização em vez de exclusão** quando há vínculos | Atende pedidos de eliminação (LGPD) mantendo o histórico operacional/financeiro exigido para retenção. |
| **Assistente com ferramentas whitelisted** | O modelo nunca escreve SQL; escolhe uma ferramenta da lista, os argumentos são validados e o `organization_id` vem sempre da requisição autenticada. As RPCs são SECURITY INVOKER (RLS do usuário). |
| **Pseudonimização reversível** | Nomes de clientes/membros viram tokens ("Cliente C1") antes de ir ao provedor e são restaurados na resposta. CPF/telefone/e-mail digitados são removidos. |
| **Provedores de IA plugáveis** | `AI_PROVIDER=anthropic|openai` (qualquer API compatível com OpenAI). Chaves só em secrets da Edge Function. |
| **Checklist de pendências textual** | Controla documentos solicitados/recebidos sem armazenar arquivos (respeita a regra do MVP). Modelos por categoria são sugestões editáveis, não exigências legais. |
| **Mensagens via link `wa.me`/`mailto:`** | Nada é enviado automaticamente; a IA reescreve só o modelo com variáveis `{{...}}` — nomes e valores são preenchidos localmente. |
| **Importação no navegador** | A planilha nunca sai do computador; a IA recebe títulos e exemplos mascarados, e a resposta é validada contra a lista enviada. |
| **Fuso America/Sao_Paulo** | O Supabase roda em UTC; indicadores e ferramentas da IA calculam "hoje" no fuso do escritório. |
| **Code-splitting por rota** | Carregamento inicial leve (Recharts e dnd-kit só nas telas que usam). |

## Modelo de dados

```
organizations ─┬─ organization_members ── profiles (auth.users)
               ├─ organization_invitations
               ├─ clients ──┬─ demands ──┬─ tasks
               │            │            └─ (contracts.demand_id)
               │            └─ contracts ── installments ── payments
               ├─ demand_categories ── workflow_stages (demands.stage_id)
               ├─ activity_logs   (escrita só por triggers)
               ├─ ai_conversations ── ai_messages   (visíveis só ao próprio usuário)
               ├─ message_templates                 (modelos de WhatsApp/e-mail do escritório)
               └─ checklist_templates · demand_checklist_items
```

## Permissões por perfil

| Recurso | Administrador | Advogado | Assistente |
|---|:-:|:-:|:-:|
| Clientes — ver, criar, editar | ✔ | ✔ | ✔ |
| Clientes — excluir / anonimizar | ✔ | | |
| Demandas e tarefas — ver, criar, editar | ✔ | ✔ | ✔ |
| Demandas e tarefas — excluir | ✔ | ✔ | |
| Fluxos e categorias — configurar | ✔ | ✔ | só leitura |
| Contratos — criar/editar | ✔ | ✔ | só leitura |
| Pagamentos — registrar | ✔ | ✔ | ✔ |
| Pagamentos — estornar | ✔ | ✔ | |
| Resumo financeiro no assistente | ✔ | ✔ | |
| Equipe, convites e dados do escritório | ✔ | | |
| Conversas com o assistente | apenas as próprias | apenas as próprias | apenas as próprias |

## Preparação para RAG (futuro)
A Edge Function expõe um ponto de extensão (`ContextRetriever`) para recuperar contexto adicional. Quando houver
base de conhecimento (ex.: modelos de textos do escritório), basta implementar o retriever com `pgvector`, respeitando
`organization_id` na consulta. Nenhum pipeline documental foi criado nesta versão.

## Fora do escopo do MVP (intencional)
Armazenamento/upload de documentos, OCR, Google Drive, emissão de notas fiscais, integração bancária,
envio de e-mails/WhatsApp, controle oficial de prazos processuais.
