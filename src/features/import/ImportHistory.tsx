// "Importações recentes": histórico das últimas importações com Desfazer (admin ou quem importou, até 30 dias).
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Spinner, Table, TBody, TD, TH, THead, TR, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { qk, useMemberNames } from '@/hooks/useOrgData'
import { formatDateTime } from '@/lib/format'
import { fetchImportBatches, undoImportBatch, UNDO_WINDOW_DAYS, type ImportBatch, type UndoResult } from './api'

const DAY_MS = 86_400_000
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

/** Texto do aviso depois de desfazer: o que saiu, o que ficou por já estar em uso e o que foi restaurado. */
function undoMessage(r: UndoResult): string {
  const removed = [
    r.removed_clients > 0 ? plural(r.removed_clients, 'cliente', 'clientes') : null,
    r.removed_demands > 0 ? plural(r.removed_demands, 'demanda', 'demandas') : null,
  ].filter(Boolean)
  const parts: string[] = []
  if (removed.length === 2) parts.push(`${removed[0]} e ${removed[1]} removidos`)
  else if (removed.length === 1) {
    // Concordância: "1 cliente removido", "2 demandas removidas"
    const n = r.removed_clients + r.removed_demands
    const word = r.removed_clients > 0 ? (n === 1 ? 'removido' : 'removidos') : n === 1 ? 'removida' : 'removidas'
    parts.push(`${removed[0]} ${word}`)
  }
  else parts.push('Nada foi removido')
  const kept = r.skipped_clients + r.skipped_demands
  if (kept > 0) parts.push(`${kept.toLocaleString('pt-BR')} ${kept === 1 ? 'mantido por já estar' : 'mantidos por já estarem'} em uso`)
  if (r.restored_clients > 0) parts.push(`${plural(r.restored_clients, 'cliente', 'clientes')} com dados anteriores restaurados`)
  if (r.skipped_fields > 0) parts.push(`${plural(r.skipped_fields, 'campo mantido', 'campos mantidos')} por alteração posterior`)
  return `${parts.join('; ')}.`
}

function countsText(b: ImportBatch): string {
  return [
    plural(b.created_clients, 'cliente criado', 'clientes criados'),
    plural(b.updated_clients, 'atualizado', 'atualizados'),
    plural(b.created_demands, 'demanda', 'demandas'),
  ].join(' · ')
}

export function ImportHistory() {
  const { orgId, userId, role } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const names = useMemberNames()
  const [target, setTarget] = useState<ImportBatch | null>(null)
  const [now] = useState(() => Date.now())
  const batches = useQuery({ queryKey: ['import-batches', orgId], queryFn: () => fetchImportBatches(orgId) })

  const canUndo = (b: ImportBatch) =>
    !b.undone_at && now - new Date(b.created_at).getTime() <= UNDO_WINDOW_DAYS * DAY_MS && (role === 'admin' || b.created_by === userId)

  const confirm = async () => {
    if (!target) return
    const result = await undoImportBatch(target.id)
    toast.show(undoMessage(result))
    void qc.invalidateQueries({ queryKey: ['import-batches', orgId] })
    void qc.invalidateQueries({ queryKey: qk.clients(orgId) })
    void qc.invalidateQueries({ queryKey: qk.demands(orgId) })
    void qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
  }

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title="Importações recentes" description="As últimas 10 importações do escritório. Dá para desfazer por até 30 dias." />
      {batches.isLoading ? (
        <Spinner label="Carregando…" />
      ) : batches.isError ? (
        <ErrorState message={(batches.error as Error).message} onRetry={() => batches.refetch()} />
      ) : !batches.data?.length ? (
        <EmptyState title="Nenhuma importação ainda" description="As próximas importações aparecem aqui." />
      ) : (
        <Table label="Importações recentes">
          <THead>
            <tr>
              <TH>Data</TH>
              <TH>Arquivo</TH>
              <TH>Quem</TH>
              <TH>Resultado</TH>
              <TH className="w-28">
                <span className="sr-only">Ações</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {batches.data.map((b) => (
              <TR key={b.id}>
                <TD className="tabular whitespace-nowrap text-ink-muted">{formatDateTime(b.created_at)}</TD>
                <TD>
                  <span className="block max-w-[260px] truncate" title={b.file_name ?? undefined}>
                    {b.file_name ?? 'Sem nome'}
                  </span>
                </TD>
                <TD className="text-ink-muted">{names.map.get(b.created_by) ?? '—'}</TD>
                <TD>
                  {b.undone_at ? (
                    <span className="text-ink-muted">Desfeita em {formatDateTime(b.undone_at)}</span>
                  ) : (
                    <span className="text-ink-muted">{countsText(b)}</span>
                  )}
                </TD>
                <TD className="text-right">
                  {canUndo(b) && (
                    <Button size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => setTarget(b)}>
                      Desfazer
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={`Desfazer a importação de ${target?.file_name ?? 'planilha'}?`}
        description="Clientes e demandas criados por ela e ainda sem uso serão removidos. Dados complementados voltam ao valor anterior quando não foram alterados depois."
        confirmLabel="Desfazer importação"
        onConfirm={confirm}
      />
    </Card>
  )
}
