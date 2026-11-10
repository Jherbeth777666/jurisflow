# JurisFlow AI

Plataforma SaaS de gestão operacional para pequenos escritórios de advocacia (2 a 5 pessoas), com foco em demandas
previdenciárias, trabalhistas e administrativas. Substitui planilhas, Trello e controles no WhatsApp por um painel único:
clientes, demandas com fluxos em Kanban, tarefas e prazos, contratos e honorários, relatórios e um assistente de IA que
consulta apenas dados autorizados.

> **MVP sem armazenamento de documentos.** O sistema trabalha só com dados cadastrais e operacionais.
> Os alertas de tarefas são auxiliares de organização e **não substituem o controle oficial de prazos processuais**.

## Stack
- **Frontend:** React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · TanStack Query · Recharts · dnd-kit · Lucide
- **Backend:** Supabase (PostgreSQL 15+, Auth, Row Level Security, Edge Functions em Deno)
- **IA:** Edge Function `ai-assistant` com provedores plugáveis (Anthropic ou API compatível com OpenAI)
- **Hospedagem:** Netlify (frontend) + Supabase

## Funcionalidades
| Módulo | Destaques |
|---|---|
| **Visão geral** | 8 indicadores reais, 5 gráficos, tarefas prioritárias, demandas paradas, atividades recentes |
| **Clientes** | Busca por nome/CPF, CPF mascarado em listas, histórico de atendimentos, anonimização (LGPD), exportação CSV |
| **Demandas** | Filtros compartilháveis por URL, "parada há X dias", etapas, checklist de pendências, histórico de alterações |
| **Fluxos de trabalho** | Kanban com arrastar e soltar (e teclado), etapas e categorias configuráveis, modelos de checklist |
| **Tarefas** | Alertas de vencidas / hoje / próximos 7 dias, "minhas tarefas", agrupamento por prazo |
| **Contratos e honorários** | Parcelas automáticas, registro e estorno de pagamentos, saldo, vencidas, próximos recebimentos |
| **Assistente IA** | Perguntas em linguagem natural sobre o escritório, ferramentas whitelisted, nomes pseudonimizados |
| **Mensagens** | Modelos de WhatsApp/e-mail com variáveis (cobrança de documentos, andamento, parcela), "Ajustar com IA" |
| **Importar planilha** | CSV/Excel lido no navegador, mapeamento de colunas com IA, padronização, deduplicação, prévia |
| **Saúde do cadastro** | Pontuação da base, possíveis duplicados, cadastros incompletos, clientes sem movimentação |
| **Busca global** | `Ctrl+K` / `⌘K` para encontrar clientes, demandas e tarefas e executar ações rápidas |
| **Relatórios** | Por período, categoria e responsável; tempo médio de conclusão; financeiro; CSV e impressão |
| **Configurações** | Perfil, escritório, equipe e convites, papéis, privacidade e portabilidade de dados |

Detalhes e decisões em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Convenções de código em [`docs/CONVENCOES.md`](docs/CONVENCOES.md).

## Estrutura
```
src/
  features/        dashboard · clients · demands · workflows · tasks · contracts · assistant · reports · settings
  components/      ui/ (kit de componentes) · layout/ · ClientPicker · ActivityFeed
  contexts/        AuthContext (sessão, escritório atual, papel, permissões)
  hooks/           useOrgData (membros, categorias/etapas, busca de clientes, chaves de cache)
  lib/             supabase · format (BRL, CPF, datas) · constants · permissions
supabase/
  migrations/      SQL versionado: schema, regras de negócio, RLS, ferramentas da IA
  functions/       ai-assistant (Edge Function)
  tests/           testes SQL de RLS/multiempresa e regras de negócio + runner local
  seed/            dados de demonstração (somente ambiente demo)
```

## Rodar no seu computador (Windows) — jeito rápido
Pré-requisitos: [Node.js LTS](https://nodejs.org) e [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Dê **duplo clique em `INICIAR-JURISFLOW.bat`**. Ele abre o Docker, instala as dependências, sobe o Supabase local,
   cria um escritório de demonstração com dados fictícios e abre o site em `http://localhost:5173`.
2. Entre com **demo@jurisflow.local** / **Demo@2026** (ou crie sua própria conta).
3. Para ligar o Assistente IA: copie `supabase/functions/.env.example` para `supabase/functions/.env`, preencha a chave
   (Gemini tem plano gratuito) e rode o `.bat` de novo.
4. Para parar: feche a janela e dê duplo clique em `PARAR-JURISFLOW.bat` (os dados ficam salvos).

## Instalação

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Instale a CLI (`npm i -g supabase`) e vincule: `supabase link --project-ref SEU_REF`.
3. Aplique as migrations: `supabase db push`.
4. Em **Authentication → Providers → Email**, mantenha a confirmação de e-mail ativada (o aceite de convites exige e-mail confirmado).
5. Em **Authentication → URL Configuration**, defina a *Site URL* (ex.: `https://seu-app.netlify.app`) e adicione
   `https://seu-app.netlify.app/redefinir-senha` às *Redirect URLs*.

### 2. Inteligência artificial (opcional, mas recomendado)
Três Edge Functions usam IA: `ai-assistant` (chat), `ai-import` (mapeamento de planilhas) e `ai-compose` (ajuste de mensagens).
Escolha um provedor — Gemini, DeepSeek, Groq, Anthropic ou qualquer API compatível com OpenAI:
```bash
# Gemini (Google) como principal e DeepSeek como reserva automática
supabase secrets set AI_PROVIDER=gemini GEMINI_API_KEY=... \
  AI_FALLBACK_PROVIDER=deepseek DEEPSEEK_API_KEY=... \
  ALLOWED_ORIGINS=https://seu-app.netlify.app

# outras opções: AI_PROVIDER=deepseek | groq | anthropic | openai | openai_compatible (+ OPENAI_BASE_URL), AI_MODEL=...

supabase functions deploy ai-assistant
supabase functions deploy ai-import
supabase functions deploy ai-compose
```
Sem chave configurada, o restante do sistema funciona normalmente e a tela do assistente informa que ele não está configurado.
Veja [`supabase/functions/ai-assistant/README.md`](supabase/functions/ai-assistant/README.md).

### 3. Frontend local
```bash
cp .env.example .env.local     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```
Crie uma conta, confirme o e-mail e crie o escritório — categorias e fluxos iniciais são gerados automaticamente.

### 4. Deploy no Netlify
Conecte o repositório; o `netlify.toml` já define build (`npm run build`), pasta `dist`, redirecionamento SPA e cabeçalhos
de segurança. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em *Site settings → Environment variables*.

### Dados de demonstração
Somente para ambiente de demonstração: edite o `organization_id` no topo de `supabase/seed/demo_seed.sql` e execute-o no
SQL Editor. O escritório é marcado como demonstração (selo visível no menu) e todos os registros têm nomes fictícios.

## Testes
```bash
npm run typecheck   # TypeScript estrito
npm test            # Vitest — 300 testes: utilitários, parcelas, prazos, relatórios, importação, deduplicação,
                    #   mensagens, busca, IA (pseudonimização, redação de PII, whitelist, provedores, fallback)
npm run test:db     # PostgreSQL local: aplica as migrations e roda ~430 verificações de RLS/multiempresa,
                    #   papéis, regras de negócio, checklists e ferramentas da IA
```
`test:db` precisa de um PostgreSQL 15+ acessível via `psql` (variáveis `PG*`). Ele cria um banco temporário com um stub
mínimo do `auth` do Supabase — use apenas em desenvolvimento.

## Segurança e LGPD (resumo)
- Isolamento por escritório garantido no banco (RLS + chaves estrangeiras compostas), não no frontend.
- Perfis Administrador, Advogado e Assistente com permissões distintas (matriz em `docs/ARQUITETURA.md`).
- Chaves de IA apenas no servidor; o modelo não executa SQL — usa ferramentas whitelisted sob a RLS do usuário.
- Cota de uso da IA por usuário registrada no banco (não pode ser apagada pelo usuário), protegendo o custo com o provedor.
- Nomes são pseudonimizados antes de ir ao provedor de IA; CPF/telefone/e-mail não são enviados.
- Logs de auditoria sem valores de dados pessoais; CPF mascarado em listagens.
- Correção (edição), anonimização (inclusive nos textos livres de demandas e tarefas) e exportação dos dados de um
  cliente (portabilidade) disponíveis para o administrador. Toda exportação CSV/JSON fica registrada na auditoria.
- Planilhas importadas são lidas no navegador e descartadas; a IA vê só títulos de colunas e exemplos mascarados.
- **Mantenha a confirmação de e-mail ligada no Supabase**: o aceite automático de convites depende dela.

## Roadmap sugerido (pós-MVP)
Envio de convites por e-mail · notificações automáticas de tarefas · integração oficial com a API do WhatsApp Business ·
RAG sobre base de conhecimento do escritório · armazenamento de documentos com criptografia e política de retenção.
