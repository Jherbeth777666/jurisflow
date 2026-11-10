# Edge Function `ai-assistant`

Chat do Assistente IA. O modelo **nunca executa SQL**: ele só pode chamar as ferramentas da whitelist
(`tools.ts`), que mapeiam para funções `ai_*` da migration `20261109000004_ai_tools.sql`. Essas funções rodam
com o **JWT do usuário** (RLS vale) e não devolvem CPF, telefone, e-mail, endereço, nascimento nem observações.
Antes de qualquer envio ao provedor, os nomes de clientes e membros viram tokens (`Cliente C1`, `Responsável R1`),
e CPF/CNPJ/telefone/e-mail digitados viram `[dado removido]`. Os nomes são restaurados só na resposta ao usuário.

## Variáveis de ambiente (secrets)

| Variável | Padrão | Uso |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic`, `openai`, `gemini`, `deepseek`, `groq` ou `openai_compatible` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `GROQ_API_KEY` | — | Chave do provedor escolhido (só no servidor) |
| `AI_MODEL` | por provedor (veja abaixo) | Sobrescreve o modelo do provedor principal |
| `OPENAI_BASE_URL` | por provedor | Sobrescreve a URL base (família OpenAI; obrigatória em `openai_compatible`) |
| `AI_FALLBACK_PROVIDER` | — | Provedor reserva, usado uma vez se o principal falhar com 5xx, 429 ou timeout (não em 4xx) |
| `AI_FALLBACK_MODEL` / `AI_FALLBACK_BASE_URL` | padrão do reserva | Overrides do reserva (`AI_MODEL` não se aplica a ele) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Origens CORS permitidas, separadas por vírgula (`*` é ignorado) |
| `AI_RATE_LIMIT_PER_HOUR` | `30` | Mensagens por usuário por hora |
| `AI_MONTHLY_ORG_LIMIT` | `3000` | Teto mensal de chamadas de IA por escritório (somando assistente, importação e ajuste de tom; vale nas 3 funções) |

Modelos padrão: anthropic `claude-haiku-5-5` (econômico; use `AI_MODEL` para um modelo maior) · openai `gpt-4.1-mini` · gemini `gemini-2.5-flash`
(`https://generativelanguage.googleapis.com/v1beta/openai`) · deepseek `deepseek-chat` (`https://api.deepseek.com/v1`) ·
groq `llama-3.3-70b-versatile` (`https://api.groq.com/openai/v1`).
Gemini, DeepSeek e Groq usam o adaptador OpenAI-compatível (`tools`/`tool_calls`), sem SDK.

**Custo:** as opções mais baratas são **Gemini Flash** (`AI_PROVIDER=gemini`, `gemini-2.5-flash`, com plano gratuito)
e **DeepSeek** (`AI_PROVIDER=deepseek`, `deepseek-chat`). No Anthropic, o padrão já é o Haiku. Para limitar gastos,
combine o limite por hora com o teto mensal por escritório (`AI_MONTHLY_ORG_LIMIT`); cada pergunta tem prazo total
de 45 s e o histórico/resultados enviados ao modelo são limitados (8 000 caracteres cada).

`SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetadas automaticamente pelo Supabase. A função **não** usa a service role key.

Sem a chave do provedor, a função responde **503** e a UI mostra "Assistente não configurado — veja o README".

## Deploy

```bash
supabase functions deploy ai-assistant

# Anthropic (padrão)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ALLOWED_ORIGINS=https://seu-app.netlify.app

# Gemini como principal e DeepSeek como reserva
supabase secrets set AI_PROVIDER=gemini GEMINI_API_KEY=AIza... \
  AI_FALLBACK_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-... \
  ALLOWED_ORIGINS=https://seu-app.netlify.app

# Só DeepSeek
supabase secrets set AI_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-...

# Outro endpoint compatível com OpenAI
supabase secrets set AI_PROVIDER=openai_compatible OPENAI_API_KEY=... \
  OPENAI_BASE_URL=https://meu-endpoint/v1 AI_MODEL=nome-do-modelo
```

Desenvolvimento local: `supabase functions serve ai-assistant --env-file supabase/.env.local`.

## Testes

```bash
npx vitest run supabase/functions          # módulos puros (pseudonimização, redação, ferramentas, provedores, laço)
deno check supabase/functions/ai-assistant/index.ts
TEST_DB=jf_ai_test ./supabase/tests/run_local.sh   # inclui supabase/tests/ai_tools_test.sql
```

## Limitações conhecidas

- A pseudonimização reconhece nomes **completos** como estão cadastrados (até 3.000 clientes e todos os membros).
  Apelidos ou só o primeiro nome digitados pelo usuário seguem para o provedor.
- Textos livres (títulos de demandas e tarefas) passam pela redação de CPF/telefone/e-mail e pela troca de nomes,
  mas outros dados escritos neles (ex.: um endereço) não são detectados.
- "Hoje" nas ferramentas é a data em America/Sao_Paulo. O `dashboard_metrics` usa a data do servidor (UTC), então perto
  da meia-noite os números podem diferir em um dia.
- RAG: só existe a interface `ContextRetriever` (`retrieval.ts`). Nada foi implementado.
