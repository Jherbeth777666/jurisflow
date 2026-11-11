# JurisFlow AI

SaaS de gestão operacional para pequenos escritórios de advocacia (previdenciário, trabalhista, administrativo). React 19 + TypeScript + Vite + Tailwind v4, TanStack Query, Vitest; Supabase (Postgres com RLS multiescritório, Auth, Edge Functions em Deno); deploy previsto no Netlify.

Leia primeiro: `RESUMO-JURISFLOW.md` (estado atual e próximos passos), `docs/ARQUITETURA.md`, `docs/CONVENCOES.md`.

## Comandos

- Instalar: `npm ci`
- Rodar local (tudo automático): `preview_start` com `jurisflow` (`.claude/launch.json`) = `npm run local`, que abre o Docker se preciso, sobe o Supabase, aplica migrations, gera `.env.local`, carrega a demo (`scripts/preparar.ps1`, sem interação) e sobe o site na porta 5173. Parar o banco: `npm run local:parar`. Só o site: `npm run dev`.
- Testes: `npm test` (Vitest)
- Tipos: `npm run typecheck`
- Lint: `npm run lint` (oxlint)
- Build: `npm run build`
- Testes de banco (Supabase local via Docker): `npm run test:db`
- Edge Functions: `supabase/functions/` (`ai-assistant`, `ai-import`, `ai-compose`); publicar com `supabase functions deploy <nome>`

## Convenções

- Isolamento por escritório garantido no banco (RLS + chaves estrangeiras compostas), nunca só na tela.
- A IA não executa SQL livre; nomes de clientes viram códigos e CPF/telefone/e-mail são removidos antes do provedor.
- Sem armazenamento de documentos no MVP: só dados cadastrais e operacionais.
- Segredos nunca no código nem no chat: `.env.local` (só URL e anon key) e `supabase secrets` para chaves de IA.

## Equipe multiagente

Este projeto fica fora de `IA SPEED`, então as regras gerais daquela pasta não carregam aqui. Valem as mesmas:
- Claude orquestra; trabalho pesado vai para `~/.claude/equipe/deepseek.sh` (código, testes) e `~/.claude/equipe/gemini.sh` (contexto, auditoria, somente leitura).
- Fluxos: `/entregar <tarefa>`, `/roteiro item 1; item 2`, `/auditar`.
- Checagens locais sem tokens: `~/.claude/equipe/estagio0.sh`, `~/.claude/equipe/conferir.sh`, `~/.claude/equipe/navegador.sh <rotas>`.
- Saídas detalhadas dos agentes em `.ai_workspace/` (fora do git); histórico em `.ai_workspace/historico.md`.
- Os scripts antigos em `scripts/agentes/` (`rodar-agentes.ps1`) gravam em `docs/agentes/resultados/`.
