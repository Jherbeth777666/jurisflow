# JurisFlow AI — Resumo do projeto (o que foi feito e próximos passos)

## 1. Contexto
SaaS de gestão operacional para pequenos escritórios de advocacia (2 a 5 pessoas), com foco em demandas
previdenciárias (salário-maternidade, aposentadoria, incapacidade, pesca), trabalhistas e administrativas.
Substitui Excel, Trello e controles no WhatsApp. **MVP sem armazenamento de documentos** — só dados cadastrais e operacionais.

## 2. Tecnologia
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router + TanStack Query + Recharts + dnd-kit + Lucide
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security, Edge Functions em Deno). Sem servidor próprio.
- **IA:** 3 Edge Functions com provedores plugáveis: Gemini, DeepSeek, Groq, Anthropic (Claude) ou qualquer API compatível com OpenAI, com provedor reserva automático.
- **Hospedagem prevista:** Netlify (site) + Supabase (banco/autenticação).

## 3. O que foi feito

### Módulos
| Módulo | O que tem |
|---|---|
| Visão geral | 8 indicadores com dados reais do banco, 5 gráficos (por categoria, por situação, evolução mensal, produtividade da equipe, receitas), tarefas prioritárias, demandas paradas, atividades recentes |
| Clientes | Cadastro com validação de CPF/telefone, busca por nome ou CPF, CPF mascarado nas listas, histórico de atendimentos, anonimização (LGPD), exportação CSV |
| Demandas | Categorias, etapas, prioridade, responsável, próxima atividade, "parada há X dias", filtros compartilháveis por link, histórico de alterações |
| Fluxos de trabalho | Kanban com arrastar e soltar (também por teclado), etapas e categorias personalizáveis, etapas marcadas como "conclusão" ou "aguardando documentos" |
| Checklist de documentos | Lista de pendências por demanda (só texto, sem arquivos), modelos por tipo de benefício, botão "Cobrar pendências" |
| Tarefas | Alertas de vencidas / hoje / próximos 7 dias, "minhas tarefas", agrupamento por prazo |
| Contratos e honorários | Parcelas geradas automaticamente, registro e estorno de pagamentos, saldo, parcelas vencidas, próximos recebimentos |
| Mensagens | Modelos de WhatsApp/e-mail com variáveis (cobrança de documentos, andamento, lembrete de parcela, boas-vindas); abre o WhatsApp com o texto pronto; "Ajustar com IA" |
| Assistente IA | Chat que responde perguntas sobre o escritório ("quais demandas estão paradas há 15 dias?", "resumo da semana") usando somente funções pré-aprovadas do banco |
| Importar planilha | CSV/Excel lido no navegador, mapeamento de colunas com IA, padronização de CPF/telefone/datas, detecção de duplicados, prévia antes de gravar |
| Saúde do cadastro | Nota da base, possíveis duplicados, cadastros incompletos, clientes sem movimentação |
| Busca global | Ctrl+K para achar clientes, demandas e tarefas e executar ações rápidas |
| Relatórios | Por período, categoria e responsável; tempo médio de conclusão; financeiro; exportação CSV e impressão |
| Configurações | Perfil, escritório, equipe e convites, papéis, privacidade/LGPD e exportação dos dados de um cliente |

### Segurança e LGPD
- Cada escritório só enxerga os próprios dados — garantido no banco (RLS + chaves estrangeiras compostas por escritório), não na tela.
- Perfis: Administrador, Advogado e Assistente, com permissões diferentes.
- A IA nunca executa SQL livre; o escritório consultado vem sempre do usuário logado.
- Nomes de clientes são trocados por códigos antes de ir ao provedor de IA; CPF, telefone e e-mail são removidos.
- Logs de auditoria sem dados pessoais; exportações ficam registradas.
- Anonimização remove o nome do cliente também de textos livres, histórico e conversas com a IA.
- Limite de uso da IA por usuário registrado no banco (não dá para burlar apagando conversas).
- Auditoria interna encontrou e corrigiu 5 falhas reais (ex.: falsificação do e-mail do perfil; ex-admin reconvidado voltava como admin) e uma revisão independente corrigiu mais uma.

### Testes
- TypeScript estrito sem erros; 300 testes automatizados (Vitest).
- ~430 verificações no banco: isolamento entre escritórios, permissões por perfil, regras de negócio, funções de IA.
- Build de produção e checagem das funções em Deno passando.

### Rodando localmente (Windows)
- `INICIAR-JURISFLOW.bat`: abre o Docker, sobe o Supabase local, aplica o banco, cria um escritório de demonstração (25 clientes, 40 demandas, 60 tarefas, 12 contratos fictícios) e abre o site em http://localhost:5173.
- `CONFIGURAR-IA.bat`: pede a chave do provedor de IA e liga o assistente.
- `PUBLICAR.bat`: publica no Supabase na nuvem + Netlify (pede os logins do usuário).
- `PARAR-JURISFLOW.bat`: desliga mantendo os dados.

## 4. Limitações atuais
- A chamada de ferramentas da IA foi testada com respostas simuladas, ainda não com as APIs reais.
- O script de publicação ainda não foi executado contra contas reais.
- Não há envio automático de e-mail/WhatsApp (convites e mensagens são enviados manualmente pelo usuário).
- Não substitui o controle oficial de prazos processuais.

## 5. Melhorias propostas (próximos passos)

**Prioridade alta — uso diário da equipe**
1. **Resumo diário automático**: e-mail (ou WhatsApp) toda manhã com tarefas do dia, prazos e demandas paradas de cada pessoa.
2. **Agenda de atendimentos e perícias**: calendário do escritório (consultas, perícias do INSS, audiências), sincronizado com o Google Agenda, com lembrete ao cliente.
3. **Prazo de exigência do INSS**: ao registrar uma exigência, criar a tarefa com 30 dias contados e alerta antes do vencimento.
4. **Instalável no celular (PWA)**.

**Prioridade média — clientes e produtividade**
5. **Link de acompanhamento para o cliente**: página segura mostrando a etapa do caso e os documentos pendentes.
6. **Gerador de documentos**: procuração, contrato de honorários, declaração de hipossuficiência e recibo, preenchidos com os dados do cliente e baixados em Word/PDF (gerados na hora, sem armazenar).
7. **Cobrança por Pix**: QR Code Pix da parcela enviado junto com o lembrete de pagamento, sem integração bancária.

**Diferenciais**
8. **Consulta de processos judiciais** pela API pública do CNJ (DataJud), avisando movimentações novas.
9. **Controle de RPV/precatórios** com cálculo dos honorários de êxito sobre os atrasados.
10. **Origem dos clientes** (indicação, Instagram, sindicato, colônia de pescadores) com relatório de canais.

**Ajustes menores**
- Modo escuro; comentários internos com menção (@colega); foto/cor por membro da equipe; backup exportável do escritório.

**Sugestão de ordem**: agenda com perícias → resumo diário → link de acompanhamento para o cliente.
Observação: envio automático por WhatsApp exige a API oficial do WhatsApp Business (paga); por e-mail é gratuito.
