// Modelos padrão (embutidos no app — não ocupam o banco). Tom cordial e
// profissional, sem promessas de resultado jurídico. O escritório pode duplicar
// e personalizar qualquer um deles.
import type { MessageTemplate } from './types'

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'padrao:solicitacao-documentos',
    kind: 'padrao',
    name: 'Solicitação de documentos',
    description: 'Primeiro pedido dos documentos necessários para iniciar o trabalho.',
    subject: 'Documentos para o seu atendimento — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Tudo bem?

Aqui é do {{nome_escritorio}}. Para darmos andamento ao seu atendimento de {{categoria}}, precisamos dos seguintes documentos:

{{documentos_pendentes}}

Você pode enviá-los pelo canal combinado com o escritório ou trazê-los pessoalmente. Se tiver qualquer dúvida sobre algum item, é só nos chamar.

Atenciosamente,
{{responsavel}}`,
  },
  {
    id: 'padrao:lembrete-documentos',
    kind: 'padrao',
    name: 'Lembrete de documentos pendentes',
    description: 'Lembrete gentil quando ainda faltam itens do checklist.',
    subject: 'Lembrete: documentos pendentes — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Tudo bem?

Passando para lembrar que, para seguirmos com o seu atendimento de {{categoria}}, ainda estão pendentes:

{{documentos_pendentes}}

Assim que puder, nos envie pelo canal combinado. Se estiver com dificuldade para conseguir algum deles, conte para nós — podemos orientar.

Obrigado!
{{responsavel}} — {{nome_escritorio}}`,
  },
  {
    id: 'padrao:atualizacao-andamento',
    kind: 'padrao',
    name: 'Atualização de andamento',
    description: 'Informa a etapa atual e o próximo passo previsto.',
    subject: 'Atualização do seu atendimento — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Tudo bem?

Gostaríamos de atualizar você sobre o seu atendimento de {{categoria}}. No momento, ele está na etapa: {{etapa}}.

Próximo passo: {{proxima_atividade}}, previsto para {{data_proxima_atividade}}.

Seguimos acompanhando e avisaremos sobre novidades. Qualquer dúvida, estamos à disposição.

Atenciosamente,
{{responsavel}} — {{nome_escritorio}}`,
  },
  {
    id: 'padrao:confirmacao-atendimento',
    kind: 'padrao',
    name: 'Confirmação de atendimento',
    description: 'Confirma data e assunto de um atendimento ou agendamento.',
    subject: 'Confirmação de atendimento — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Tudo bem?

Confirmamos o seu atendimento com o {{nome_escritorio}}:

Assunto: {{proxima_atividade}}
Data: {{data_proxima_atividade}}
Responsável: {{responsavel}}

Se precisar remarcar, por favor nos avise com antecedência. Até breve!`,
  },
  {
    id: 'padrao:lembrete-parcela',
    kind: 'padrao',
    name: 'Lembrete de parcela de honorários',
    description: 'Lembrete cordial de vencimento de parcela.',
    subject: 'Lembrete de vencimento — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Tudo bem?

Este é um lembrete amigável: a parcela de honorários no valor de {{valor_parcela}} tem vencimento em {{vencimento_parcela}}.

Se o pagamento já foi feito, por favor desconsidere esta mensagem. Em caso de dúvida sobre valores ou formas de pagamento, estamos à disposição.

Atenciosamente,
{{nome_escritorio}}`,
  },
  {
    id: 'padrao:agradecimento-conclusao',
    kind: 'padrao',
    name: 'Agradecimento e conclusão',
    description: 'Encerramento cordial ao concluir o trabalho do escritório.',
    subject: 'Agradecimento — {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}!

Informamos que concluímos as atividades do escritório referentes ao seu atendimento de {{categoria}}.

Agradecemos muito a confiança no nosso trabalho. Se precisar de algo no futuro, ou se surgir qualquer dúvida, conte com a gente.

Um abraço,
{{responsavel}} — {{nome_escritorio}}`,
  },
  {
    id: 'padrao:boas-vindas',
    kind: 'padrao',
    name: 'Boas-vindas ao escritório',
    description: 'Primeiro contato após o cadastro do cliente.',
    subject: 'Boas-vindas ao {{nome_escritorio}}',
    body: `Olá, {{primeiro_nome}}! Seja bem-vindo(a) ao {{nome_escritorio}}.

Ficamos felizes em poder ajudar. A partir de agora, {{responsavel}} acompanhará o seu atendimento e manterá você informado(a) sobre cada etapa.

Sempre que tiver dúvidas, pode nos chamar por aqui. Salve este contato para facilitar a comunicação.

Atenciosamente,
{{nome_escritorio}}`,
  },
]

export const DEFAULT_TEMPLATE_IDS = {
  solicitacaoDocumentos: 'padrao:solicitacao-documentos',
  lembreteDocumentos: 'padrao:lembrete-documentos',
  atualizacao: 'padrao:atualizacao-andamento',
  confirmacao: 'padrao:confirmacao-atendimento',
  lembreteParcela: 'padrao:lembrete-parcela',
  conclusao: 'padrao:agradecimento-conclusao',
  boasVindas: 'padrao:boas-vindas',
} as const
