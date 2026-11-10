import { useState, type FormEvent } from 'react'
import { formatCurrency, formatDate, todayISO } from '@/lib/format'
import { INSTALLMENT_STATUS, PAYMENT_METHOD, toOptions } from '@/lib/constants'
import { Button, InlineError, Input, Modal, Select, Spinner, Textarea, useToast } from '@/components/ui'
import type { PaymentMethod } from '@/types/database'
import { useCreatePayment, useInstallments } from './api'
import { formatMoneyInput, nextOpenInstallment, parseMoneyInput } from './installments'

export interface PaymentModalProps {
  open: boolean
  onClose: () => void
  contractId: string | null
  /** Parcela pré-selecionada; padrão = próxima em aberto */
  installmentId?: string | null
  /** Forma de pagamento padrão (a do contrato) */
  defaultMethod?: PaymentMethod
  /** Rótulo de contexto (ex.: nome do cliente) */
  subtitle?: string
}

/** Registro de pagamento de uma parcela. Usado na lista de recebimentos e no detalhe do contrato. */
export function PaymentModal(props: PaymentModalProps) {
  // Monta só quando aberto: o formulário é reiniciado a cada abertura.
  if (!props.open || !props.contractId) return null
  return <PaymentForm key={`${props.contractId}-${props.installmentId ?? ''}`} {...props} />
}

function PaymentForm({ open, onClose, contractId, installmentId, defaultMethod = 'pix', subtitle }: PaymentModalProps) {
  const toast = useToast()
  const installments = useInstallments(contractId)
  const create = useCreatePayment()
  // null = ainda não escolhido pelo usuário → usa o padrão calculado
  const [chosen, setChosen] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState<string | null>(null)
  const [paidAt, setPaidAt] = useState(todayISO())
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<{ installment?: string; amount?: string; paidAt?: string }>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  const all = installments.data ?? []
  const open_list = all.filter((i) => i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  const fallback = (installmentId && open_list.find((i) => i.id === installmentId)) || nextOpenInstallment(all)
  const selected = chosen ?? fallback?.id ?? ''
  const current = all.find((i) => i.id === selected)
  const amount = amountInput ?? (current ? formatMoneyInput(current.remaining_amount) : '')
  const value = parseMoneyInput(amount)

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const e: typeof errors = {}
    if (!current) e.installment = 'Selecione a parcela.'
    if (!Number.isFinite(value) || value <= 0) e.amount = 'Informe um valor maior que zero.'
    if (!paidAt) e.paidAt = 'Informe a data do pagamento.'
    else if (paidAt > todayISO()) e.paidAt = 'A data do pagamento não pode estar no futuro.'
    setErrors(e)
    if (Object.keys(e).length || !current || !contractId) return
    setSubmitError(null)
    try {
      await create.mutateAsync({
        contract_id: contractId,
        installment_id: current.id,
        amount: value,
        paid_at: paidAt,
        method,
        notes: notes.trim() || null,
      })
      toast.show(`Pagamento de ${formatCurrency(value)} registrado.`)
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível registrar o pagamento.')
    }
  }

  const overpay = current && Number.isFinite(value) && value > current.remaining_amount + 0.004

  return (
    <Modal
      open={open}
      onClose={create.isPending ? () => {} : onClose}
      dirty={create.isPending || amountInput !== null || notes !== ''}
      title="Registrar pagamento"
      description={subtitle}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="payment-form" loading={create.isPending} disabled={!open_list.length}>
            Registrar
          </Button>
        </>
      }
    >
      {installments.isLoading ? (
        <Spinner />
      ) : installments.isError ? (
        <InlineError message={(installments.error as Error).message} />
      ) : !open_list.length ? (
        <p className="text-[13.5px] text-ink-muted">Não há parcelas em aberto neste contrato.</p>
      ) : (
        <form id="payment-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Parcela"
            required
            wrapperClassName="sm:col-span-2"
            value={selected}
            onChange={(ev) => {
              setChosen(ev.target.value)
              setAmountInput(null) // volta ao restante da nova parcela
              setErrors((x) => ({ ...x, installment: undefined }))
            }}
            options={open_list.map((i) => ({
              value: i.id,
              label: `${i.number}/${installments.data!.length} · vence ${formatDate(i.due_date)} · restante ${formatCurrency(i.remaining_amount)} (${INSTALLMENT_STATUS[i.status].label.toLowerCase()})`,
            }))}
            error={errors.installment}
          />
          <Input
            label="Valor recebido"
            required
            inputMode="decimal"
            leading={<span className="text-[12.5px]">R$</span>}
            value={amount}
            onChange={(ev) => {
              setAmountInput(ev.target.value)
              setErrors((x) => ({ ...x, amount: undefined }))
            }}
            onBlur={() => Number.isFinite(value) && value > 0 && setAmountInput(formatMoneyInput(value))}
            error={errors.amount}
            hint={overpay ? `Acima do restante da parcela (${formatCurrency(current!.remaining_amount)}).` : current ? `Restante: ${formatCurrency(current.remaining_amount)}` : undefined}
          />
          <Input
            label="Data do pagamento"
            required
            type="date"
            max={todayISO()}
            value={paidAt}
            onChange={(ev) => {
              setPaidAt(ev.target.value)
              setErrors((x) => ({ ...x, paidAt: undefined }))
            }}
            error={errors.paidAt}
          />
          <Select
            label="Forma de pagamento"
            value={method}
            onChange={(ev) => setMethod(ev.target.value as PaymentMethod)}
            options={toOptions(PAYMENT_METHOD)}
          />
          <div className="hidden sm:block" />
          <Textarea
            label="Observação"
            wrapperClassName="sm:col-span-2"
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            placeholder="Ex.: comprovante recebido por WhatsApp"
          />
          {submitError && (
            <div className="sm:col-span-2">
              <InlineError message={submitError} />
            </div>
          )}
        </form>
      )}
    </Modal>
  )
}
