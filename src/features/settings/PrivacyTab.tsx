import { useState, type ReactNode } from 'react'
import { Download, FileX2, Lock, PencilLine, ShieldCheck, Sparkles, ScrollText, Building2 } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, InlineError, useToast } from '@/components/ui'
import { ClientPicker } from '@/components/ClientPicker'
import { useOrg } from '@/contexts/AuthContext'
import { downloadJSON, fetchClientExport, logClientExport } from './api'
import { exportFileName } from './logic'

export function PrivacyTab() {
  const { can } = useOrg()
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Como os dados são tratados" description="Resumo das medidas técnicas adotadas pelo JurisFlow AI." />
        <CardBody>
          <ul className="grid gap-4 md:grid-cols-2">
            <Item icon={<FileX2 className="size-4" />} title="Sem armazenamento de documentos">
              O sistema não guarda arquivos (RG, CNIS, certidões, petições). Registramos apenas o andamento: etapas, tarefas e quais
              documentos estão pendentes.
            </Item>
            <Item icon={<Building2 className="size-4" />} title="Isolamento por escritório">
              Cada escritório enxerga exclusivamente os próprios dados. A separação é garantida no banco de dados (Row Level Security e
              chaves estrangeiras por escritório), mesmo que a interface falhe.
            </Item>
            <Item icon={<Lock className="size-4" />} title="Acesso por papel">
              Administradores, advogados e assistentes têm permissões diferentes (veja a aba Equipe). Membros desativados perdem o acesso
              imediatamente.
            </Item>
            <Item icon={<Sparkles className="size-4" />} title="Assistente de IA com pseudonimização">
              O assistente consulta indicadores e listas do escritório sem enviar CPF, telefone, e-mail ou endereço ao provedor de IA. O
              histórico de conversas é visível somente para o próprio usuário.
            </Item>
            <Item icon={<ScrollText className="size-4" />} title="Logs sem dados pessoais">
              O histórico de atividades registra quem alterou o quê e quando. Para clientes, guarda apenas o nome do campo alterado (ex.:
              “telefone”), nunca o valor.
            </Item>
            <Item icon={<ShieldCheck className="size-4" />} title="Minimização">
              Em listagens o CPF aparece mascarado (***.456.789-**). Colete apenas os dados necessários ao atendimento.
            </Item>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Direitos do titular (LGPD, art. 18)" />
        <CardBody className="flex flex-col gap-4 text-[13px] text-ink-muted">
          <div className="flex gap-3">
            <PencilLine className="mt-0.5 size-4 shrink-0 text-navy-500" />
            <div>
              <p className="font-medium text-ink">Correção</p>
              <p>Qualquer membro pode corrigir dados incompletos ou desatualizados em Clientes → ficha do cliente → Editar.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <FileX2 className="mt-0.5 size-4 shrink-0 text-navy-500" />
            <div>
              <p className="font-medium text-ink">Eliminação</p>
              <p>
                O administrador pode <strong className="text-ink">anonimizar</strong> o cliente na ficha (botão “Anonimizar”): nome, CPF,
                telefone, e-mail, nascimento, endereço e observações são apagados de forma irreversível, mantendo apenas o histórico
                operacional e financeiro sem identificação. Antes de atender um pedido de eliminação, verifique os prazos legais de
                retenção aplicáveis (por exemplo, obrigações fiscais, guarda de registros profissionais e prazos prescricionais) — nesses
                casos os dados podem ser mantidos pelo período exigido. Clientes sem demandas nem contratos podem ser excluídos.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {can('clients.anonymize') ? (
        <ExportCard />
      ) : (
        <Card>
          <CardHeader title="Portabilidade (exportação de dados)" />
          <CardBody className="text-[13px] text-ink-muted">Somente administradores podem exportar os dados de um cliente.</CardBody>
        </Card>
      )}
    </div>
  )
}

function ExportCard() {
  const { orgId, organization } = useOrg()
  const toast = useToast()
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchClientExport(orgId, organization.name, clientId)
      downloadJSON(data, exportFileName(clientName || data.titular.full_name))
      const totalRows =
        1 +
        data.demandas.length +
        data.tarefas.length +
        data.contratos.length +
        data.demandas.reduce((n, d) => n + d.checklist.length, 0) +
        data.contratos.reduce((n, c) => n + c.parcelas.length + c.pagamentos.length, 0)
      void logClientExport(orgId, clientId, totalRows)
      toast.show('Arquivo de exportação gerado.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível exportar os dados.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Portabilidade (exportação de dados)"
        description="Gera um arquivo JSON com o cadastro do cliente, demandas, checklist de documentos, tarefas, contratos, parcelas e pagamentos."
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <ClientPicker
              value={clientId}
              onChange={(id, name) => {
                setClientId(id)
                setClientName(name ?? '')
                setError(null)
              }}
            />
          </div>
          <Button variant="primary" icon={<Download className="size-4" />} onClick={run} loading={loading} disabled={!clientId}>
            Exportar JSON
          </Button>
        </div>
        <InlineError message={error} />
        <p className="text-[12px] text-ink-subtle">
          Entregue o arquivo somente ao próprio titular (ou representante legal), por canal seguro. O arquivo contém dados pessoais.
        </p>
      </CardBody>
    </Card>
  )
}

function Item({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-navy-50 text-navy-600">{icon}</span>
      <div>
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">{children}</p>
      </div>
    </li>
  )
}
