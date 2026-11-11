// Botão reutilizável de exportação para CSV (gerado no navegador).
//
// LGPD: colunas sensíveis (CPF, telefone, e-mail, nascimento, endereço) só entram
// quando o usuário é ADMINISTRADOR, a tela permite (`allowSensitive`) e ele marca
// "Incluir dados pessoais" após ler o aviso de responsabilidade.
// Auditoria: após gerar o CSV, registra a exportação via RPC log_export (activity_logs).
// Falha no registro não impede o download (apenas console.warn).
//
// Dados: recebe `rows` prontos ou `loadRows` (busca sob demanda, só ao confirmar a
// exportação — evita carregar tudo assim que a página monta).
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, ShieldAlert } from 'lucide-react'
import { Button, Checkbox, Modal, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { downloadCSV, type CSVValue } from '@/lib/csv'
import { supabase } from '@/lib/supabase'

export interface ExportColumn<T> {
  /** chave da propriedade (também usada para detectar campos sensíveis) */
  key: string
  header: string
  /** força a marcação como dado pessoal */
  sensitive?: boolean
  value?: (row: T) => CSVValue
}

const SENSITIVE_KEY = /(cpf|phone|telefone|celular|whats|email|e-mail|birth|nascimento|address|endereco|endereço)/i

export const isSensitiveColumn = <T,>(c: ExportColumn<T>) => c.sensitive ?? SENSITIVE_KEY.test(c.key)

export function buildExportRows<T>(rows: T[], columns: ExportColumn<T>[], includeSensitive: boolean): CSVValue[][] {
  const cols = columns.filter((c) => includeSensitive || !isSensitiveColumn(c))
  return [
    cols.map((c) => c.header),
    ...rows.map((r) => cols.map((c) => (c.value ? c.value(r) : ((r as Record<string, unknown>)[c.key] as CSVValue)))),
  ]
}

interface BaseProps<T> {
  filename: string
  /** recurso para o log de auditoria (^[a-z_]{2,40}$), ex.: 'clients', 'demands', 'data_quality' */
  resource: string
  columns: ExportColumn<T>[]
  allowSensitive?: boolean
  label?: string
  size?: 'sm' | 'md'
}

type Props<T> = BaseProps<T> & (
  | { rows: T[]; loadRows?: never }
  | { loadRows: () => Promise<T[]>; rows?: never }
)

export function ExportButton<T>(props: Props<T>) {
  const { filename, resource, columns, allowSensitive = false, label = 'Exportar', size = 'sm' } = props
  const loadRows = props.loadRows
  const rows = props.rows
  const { role, orgId } = useOrg()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [include, setInclude] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hasSensitive = columns.some(isSensitiveColumn)
  const canSensitive = allowSensitive && role === 'admin' && hasSensitive
  const sensitiveNote = hasSensitive && !canSensitive

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !wrapRef.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const exportNow = async (withSensitive: boolean) => {
    const sensitive = withSensitive && hasSensitive
    setOpen(false)
    setConfirm(false)
    setInclude(false)

    let data = rows ?? []
    if (loadRows) {
      setLoading(true)
      try {
        data = await loadRows()
      } catch (err) {
        toast.show(err instanceof Error ? err.message : String(err), 'error')
        return
      } finally {
        setLoading(false)
      }
      if (!data.length) {
        toast.show('Nada para exportar.', 'error')
        return
      }
    }

    downloadCSV(filename, buildExportRows(data, columns, sensitive))
    void supabase
      .rpc('log_export', { p_org: orgId, p_resource: resource, p_row_count: data.length, p_sensitive: sensitive })
      .then(({ error }) => {
        if (error) console.warn('[export] não foi possível registrar a exportação:', error.message)
      })
  }

  const onExportClick = () => {
    if (canSensitive) {
      setOpen(false)
      setConfirm(true)
    } else void exportNow(false)
  }

  const menuHint = loadRows
    ? sensitiveNote
      ? 'sem dados pessoais'
      : ''
    : `${(rows?.length ?? 0).toLocaleString('pt-BR')} linha(s)${sensitiveNote ? ' · sem dados pessoais' : ''}`

  return (
    <div ref={wrapRef} className="relative">
      <Button
        size={size}
        icon={<Download className="size-3.5" />}
        loading={loading}
        disabled={loading || (!loadRows && !rows?.length)}
        aria-busy={loading || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {loading ? 'Preparando…' : label}
        {!loading && <ChevronDown className="size-3.5 opacity-60" />}
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 rounded-lg bg-surface p-1 shadow-[var(--shadow-pop)]">
          <button
            role="menuitem"
            autoFocus
            onClick={onExportClick}
            className="flex w-full flex-col items-start rounded-md px-2.5 py-2 text-left text-[13px] text-ink hover:bg-navy-50 focus:bg-navy-50 focus:outline-none"
          >
            Exportar CSV
            {menuHint && <span className="text-[11.5px] text-ink-subtle">{menuHint}</span>}
          </button>
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Exportar CSV"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancelar</Button>
            <Button variant="primary" data-autofocus onClick={() => exportNow(include)}>
              {include ? 'Exportar com dados pessoais' : 'Exportar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[13px] text-ink-muted">
          <p>
            Por padrão o arquivo sai <strong className="font-medium text-ink">sem dados pessoais</strong> (CPF, telefone, e-mail, nascimento e
            endereço).
          </p>
          <div className="flex gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p className="text-[12.5px] leading-relaxed">
              Ao incluir dados pessoais, você se torna responsável pela guarda deste arquivo conforme a LGPD: use apenas para a finalidade do
              atendimento, não compartilhe por canais inseguros e apague-o quando não for mais necessário.
            </p>
          </div>
          <Checkbox checked={include} onChange={(e) => setInclude(e.target.checked)} label="Incluir dados pessoais" />
        </div>
      </Modal>
    </div>
  )
}
