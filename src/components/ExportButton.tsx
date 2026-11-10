// Botão reutilizável de exportação para CSV (gerado no navegador).
//
// LGPD: colunas sensíveis (CPF, telefone, e-mail, nascimento, endereço) só entram
// quando o usuário é ADMINISTRADOR, a tela permite (`allowSensitive`) e ele marca
// "Incluir dados pessoais" após ler o aviso de responsabilidade.
// Auditoria: após gerar o CSV, registra a exportação via RPC log_export (activity_logs).
// Falha no registro não impede o download (apenas console.warn).
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, ShieldAlert } from 'lucide-react'
import { Button, Checkbox, Modal } from '@/components/ui'
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

interface Props<T> {
  filename: string
  /** recurso para o log de auditoria (^[a-z_]{2,40}$), ex.: 'clients', 'demands', 'data_quality' */
  resource: string
  rows: T[]
  columns: ExportColumn<T>[]
  allowSensitive?: boolean
  label?: string
  size?: 'sm' | 'md'
}

export function ExportButton<T>({ filename, resource, rows, columns, allowSensitive = false, label = 'Exportar', size = 'sm' }: Props<T>) {
  const { role, orgId } = useOrg()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [include, setInclude] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hasSensitive = columns.some(isSensitiveColumn)
  const canSensitive = allowSensitive && role === 'admin' && hasSensitive

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

  const exportNow = (withSensitive: boolean) => {
    const sensitive = withSensitive && hasSensitive
    downloadCSV(filename, buildExportRows(rows, columns, sensitive))
    void supabase
      .rpc('log_export', { p_org: orgId, p_resource: resource, p_row_count: rows.length, p_sensitive: sensitive })
      .then(({ error }) => {
        if (error) console.warn('[export] não foi possível registrar a exportação:', error.message)
      })
    setOpen(false)
    setConfirm(false)
    setInclude(false)
  }

  const onExportClick = () => {
    if (canSensitive) {
      setOpen(false)
      setConfirm(true)
    } else exportNow(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button
        size={size}
        icon={<Download className="size-3.5" />}
        disabled={!rows.length}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <ChevronDown className="size-3.5 opacity-60" />
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
            <span className="text-[11.5px] text-ink-subtle">
              {rows.length.toLocaleString('pt-BR')} linha(s){hasSensitive && !canSensitive ? ' · sem dados pessoais' : ''}
            </span>
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
