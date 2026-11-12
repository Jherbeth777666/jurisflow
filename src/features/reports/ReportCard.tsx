import type { ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'
import { Button, Card, CardHeader, ErrorState, TableSkeleton } from '@/components/ui'
import { cn } from '@/lib/cn'

export function ReportCard({
  id,
  title,
  description,
  loading,
  error,
  onRetry,
  canExport,
  onExport,
  onPrint,
  hidden,
  className,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  canExport: boolean
  onExport: () => void
  onPrint: () => void
  hidden: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('report-card h-fit', className)} data-print-hidden={hidden ? 'true' : undefined} id={`relatorio-${id}`}>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="report-no-print flex gap-1">
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={onExport} disabled={!canExport || loading} title="Exportar CSV">
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
            <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={onPrint} disabled={loading} title="Imprimir">
              <span className="hidden sm:inline">Imprimir</span>
            </Button>
          </div>
        }
      />
      {error ? <ErrorState message={error} onRetry={onRetry} /> : loading ? <TableSkeleton rows={4} cols={3} /> : children}
    </Card>
  )
}
