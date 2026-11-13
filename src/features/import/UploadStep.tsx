import { useRef, useState, type DragEvent } from 'react'
import { Download, FileSpreadsheet, Lock, Upload } from 'lucide-react'
import { Button, Card, InlineError } from '@/components/ui'
import { downloadCSV } from '@/lib/csv'
import { cn } from '@/lib/cn'
import { ACCEPT, MAX_ROWS, TEMPLATE_ROWS } from './readFile'

export function UploadStep({ onFile, loading, error }: { onFile: (f: File) => void; loading: boolean; error: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card className="p-5">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors',
            over ? 'border-accent-500 bg-accent-50/60' : 'border-line-strong bg-canvas/50',
          )}
        >
          <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-surface text-navy-600 shadow-[var(--shadow-card)]">
            <FileSpreadsheet className="size-5" />
          </div>
          <p className="text-body-lg font-medium text-ink">Arraste sua planilha aqui</p>
          <p className="mt-1 text-body-sm text-ink-muted">Excel (.xlsx) ou CSV · até 5 MB e {MAX_ROWS.toLocaleString('pt-BR')} linhas</p>
          <Button className="mt-4" variant="primary" icon={<Upload className="size-4" />} loading={loading} onClick={() => inputRef.current?.click()}>
            Escolher arquivo
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Escolher planilha"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {error && (
          <div className="mt-3">
            <InlineError message={error} />
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="p-4">
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-body-sm font-medium text-ink">Seu arquivo não sai deste computador</p>
              <p className="mt-1 text-label leading-relaxed text-ink-muted">
                A planilha é lida no próprio navegador e <strong className="font-medium text-ink">não é enviada nem armazenada</strong> em lugar
                nenhum. Só os registros que você confirmar na revisão são gravados no cadastro.
              </p>
              <p className="mt-2 text-label leading-relaxed text-ink-muted">
                Se você usar o mapeamento com IA, vão apenas os títulos das colunas e exemplos <em>mascarados</em> (ex.: “999.999.999-99”) —
                nunca nomes, CPFs ou telefones reais.
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-body-sm font-medium text-ink">Não tem uma planilha pronta?</p>
          <p className="mt-1 text-label text-ink-muted">Baixe o modelo, preencha no Excel e envie aqui. Qualquer ordem de colunas funciona.</p>
          <Button size="sm" className="mt-3" icon={<Download className="size-3.5" />} onClick={() => downloadCSV('modelo-importacao-clientes', TEMPLATE_ROWS)}>
            Baixar modelo (CSV)
          </Button>
        </Card>
      </div>
    </div>
  )
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Etapas da importação">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li key={s} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={cn(
                'tabular flex size-6 items-center justify-center rounded-full text-caption font-semibold',
                state === 'done' && 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                state === 'current' && 'bg-navy-900 text-white',
                state === 'todo' && 'bg-slate-100 text-ink-subtle',
              )}
            >
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className={cn('text-body-sm', state === 'current' ? 'font-medium text-ink' : 'text-ink-muted')}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 hidden h-px w-8 bg-line-strong sm:block" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}
