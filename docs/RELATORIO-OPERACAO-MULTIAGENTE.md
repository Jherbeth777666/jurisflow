# JurisFlow AI — Relatório da Operação Multiagente

Data: 10/11/2026 · Branch: `auditoria-multiagente` (27 commits, 118 arquivos, +6.203/−665 linhas) · Backup: tag `backup-antes-auditoria`
O site publicado (`main`) **não foi alterado**. Publicar depende de aprovação.

## Quem participou (de verdade)
| Papel | Executado por | Observação |
|---|---|---|
| CTO / orquestrador | Claude | divisão de tarefas, decisões, integração, testes finais |
| Auditor de segurança (red team) | subagente Claude independente | ataques reais em banco de teste |
| Auditor funcional / UX / desempenho | subagente Claude independente | medições reais de bundle e custo |
| Engenheiro de implementação — banco | subagente Claude | migration 010 + testes |
| Engenheiro de implementação — IA | subagente Claude | Edge Functions |
| Engenheiro de implementação — frontend | subagente Claude | 20 itens + convites |
| **DeepSeek** (`opencode/deepseek-v4.1-flash-free`) | OpenCode no PC do usuário | 6 propostas; não alterou arquivos |
| Revisor independente final ("Argon") | subagente Claude que não participou das correções | achou 1 regressão |

**Limitação registrada:** o Gemini/"Argon" não estava conectado ao OpenCode do usuário (só modelos gratuitos do OpenCode) e as APIs do Google e do DeepSeek são bloqueadas no ambiente do Claude. O papel de auditor crítico do Argon foi cumprido por um subagente Claude sem acesso ao trabalho dos implementadores.

---

## RELATÓRIO 1 — Auditoria independente
- **Segurança:** 18 achados (2 altos, 6 médios, 10 baixos). **Nenhum vazamento entre escritórios** — 15 tabelas/views e todas as RPCs resistiram a acesso cruzado.
- **Funcional/UX:** 13 bugs (2 altos), 8 problemas de UX/acessibilidade, medição de bundle e projeção de custos.
- **DeepSeek:** 6 propostas — **todas as 6 confirmadas** e corrigidas. Uma delas (pagamento em contrato rascunho) também foi achada pelo auditor Claude: **confirmação por dois agentes**.
- **Divergência registrada:** o tamanho do bundle reportado antes (~550 kB) estava errado — build sem variáveis de ambiente elimina o app. Medição correta: 301 kB gzip na primeira tela.

## RELATÓRIO 2 — Reparos executados (principais)
**Banco (migrations 010 e 011)**
- Permissões explícitas: tabelas e funções nascem fechadas; só o necessário é liberado (antes, um admin podia trocar o usuário de um membro no Supabase real).
- Convites com consentimento: aceitar/recusar, expiração de 14 dias, opção de sair do escritório (antes, convidar já colocava a pessoa dentro).
- Anonimização refeita: limites de palavra (não altera "Mariana" ao anonimizar "Ana"), CPF em qualquer formato, contratos, pagamentos, checklist, conversas da IA e logs.
- Pagamentos: bloqueados acima do saldo, em contrato rascunho; contrato com pagamentos não troca de cliente; alteração de pagamento agora é auditada.
- Datas de sistema protegidas; coerência status × etapa; limites em `log_export` e na cota da IA; teto mensal de IA por escritório; `dashboard_metrics` otimizado.
- Revisão final: anonimização falhava em cliente com contrato cancelado → corrigida (011).

**IA (Edge Functions)**
- Pseudonimização sem acento e por primeiro nome; clientes citados priorizados.
- Proteção contra instruções escondidas nos dados (envelope "dados não confiáveis", links removidos).
- Histórico limitado (40.133 → 4.167 caracteres no teste), prazo total de 45 s, modelo econômico padrão, teto mensal.
- Redação de RG, NB do INSS, telefones com espaço e e-mail disfarçado; ai-compose rejeita links/telefones novos.

**Frontend (22 commits)**
- Sem tela branca após nova versão; checklist não move a demanda para trás; números iguais entre dashboard, tarefas e contratos; paginação que não esvazia; anonimizados fora da lista; formulários não perdem dados ao clicar fora; menu mobile, Kanban e abas acessíveis; tela de convites e de escolha de escritório; recentes da busca sem nomes de clientes.

## RELATÓRIO 3 — Testes (resultados reais, execução final)
| Verificação | Antes | Depois |
|---|---|---|
| TypeScript (`tsc -b`) | 0 erros | 0 erros |
| Vitest | 300 testes | **373 testes, todos passando** |
| Suítes SQL | 5 | **8 suítes passando** (rls 314 verificações, business_rules 125, hardening, review2, etc.) |
| Testes do banco com permissões reais do Supabase | não | **sim** (stub com default privileges) |
| `deno check` das 3 funções | ok | ok |
| Build de produção | ok | ok |

O teste de proteções novo foi conferido: **falha na versão antiga e passa na nova**.

## RELATÓRIO 4 — Segurança
Corrigidos: 2 altos, 6 médios e 8 baixos da auditoria + 1 regressão da revisão + 2 itens do DeepSeek.
**Riscos restantes (documentados):**
1. Cliente com nome muito curto ("Ana") também casa com "Ana Paula" nos textos ligados a ele.
2. O usuário pode inserir mensagens falsas no próprio histórico do assistente (impacto limitado pelo teto de histórico; correção definitiva exige gravação pela função com service role).
3. Busca de clientes citados na IA é aproximada — um nome pode escapar da pseudonimização (sugestão: RPC com `unaccent`).
4. Perfil assistente lê CPF e valores financeiros — **decisão de política**, não falha.
5. Confirmação de e-mail precisa ficar **ligada** no Supabase de produção.

## RELATÓRIO 5 — Inteligência artificial
- Provedores: Gemini, DeepSeek, Groq, Anthropic, OpenAI-compatível, com reserva automática.
- **Não validado com provedor real** — o ambiente bloqueia as APIs e não há chave configurada. Testes usam provedores simulados.
- Dados ao provedor: nomes pseudonimizados, CPF/telefone/e-mail/RG/NB removidos, só ferramentas pré-aprovadas, escritório sempre o do usuário.
- **RAG: não recomendado agora.** Toda informação útil é estruturada e já vem das ferramentas SQL; RAG só faria sentido com base de conhecimento textual do escritório (modelos de petição, procedimentos), que o MVP não tem.

## RELATÓRIO 6 — Desempenho e custos
- Primeira tela após login: **301 kB → 183 kB** (gzip). Gráficos carregados depois; bibliotecas em pacotes estáveis com cache de 1 ano.
- Dashboard: cadeias de 3 consultas sequenciais viraram 1.

| Escritórios | Supabase | Netlify | IA (Gemini Flash) | IA (Claude Sonnet) |
|---|---|---|---|---|
| 5 | US$ 25 | 0 | ~US$ 14 | ~US$ 120 |
| 20 | US$ 25 | 0 | ~US$ 56 | ~US$ 480 |
| 50 | US$ 25–30 | 0–19 | ~US$ 140 | ~US$ 1.200 |
| 100 | US$ 30–75 | 0–19 | ~US$ 280 | ~US$ 2.400 |
Premissas: 3 usuários e 660 mensagens de IA por escritório/mês. **A IA é o custo dominante** — use Gemini Flash ou DeepSeek; o teto mensal por escritório agora limita o pior caso.

## RELATÓRIO 7 — Roadmap
**Antes de clientes reais:** aplicar migrations 010/011 em produção · Supabase Pro (backup) · teste de ponta a ponta no ambiente real · chave de IA e teste com provedor real · e-mail transacional (convites/recuperação) · monitoramento de erros.
**Melhorias avaliadas (não implementadas, por decisão do protocolo):**
| Melhoria | Valor | Complexidade | Prioridade |
|---|---|---|---|
| Agenda de atendimentos e perícias | alto | média | 1 |
| Resumo diário por e-mail | alto | baixa | 2 |
| Link de acompanhamento do cliente | alto | média | 3 |
| PWA instalável | médio | baixa | 4 |
| Gerador de contratos/procurações | alto | média | 5 |
| Google Agenda | médio | média | 6 |
| Origem dos clientes | médio | baixa | 7 |
| RPV e precatórios | médio | média | 8 |
| DataJud | médio | alta | 9 |
| WhatsApp Business oficial | alto | alta (custo e aprovação Meta) | 10 |

## RELATÓRIO 8 — Notas (revisor independente)
| Área | Nota |
|---|---|
| Arquitetura | 8 |
| Segurança | 8 |
| Qualidade do código | 7,5 |
| Banco de dados | 8 |
| IA | 7 |
| UX/UI | 7,5 |
| Desempenho | 7,5 |
| Escalabilidade | 7 |
| Testes | 8 |
| Prontidão comercial | 7 |
