import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { InlineError } from './States'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<unknown> | void
  title: string
  description: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
}

/** Confirmação obrigatória para ações destrutivas. Mostra erro sem fechar. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirmar', tone = 'danger' }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handle = async () => {
    setLoading(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      size="sm"
      footer={
        <>
          {/* Padrão do produto: a ação de confirmar vem primeiro (docs/DESIGN.md). */}
          <Button variant={tone} onClick={handle} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
          <Button onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-muted">{description}</p>
      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}
    </Modal>
  )
}
