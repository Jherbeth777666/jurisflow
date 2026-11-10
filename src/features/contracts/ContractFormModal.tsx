import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { formatCurrency, formatDate, todayISO } from '@/lib/format'
import { CONTRACT_STATUS, CONTRACT_TYPE, DEMAND_STATUS, PAYMENT_METHOD, toOptions } from '@/lib/constants'
import { useOrg } from '@/contexts/AuthContext'
import { qk } from '@/hooks/useOrgData'
import { ClientPicker } from '@/components/ClientPicker'
import { Button, InlineError, Input, Modal, Select, Textarea, useToast } from '@/components/ui'
import type { Contract, ContractStatus, ContractType, Demand, PaymentMethod } from '@/types/database'
import { computeInstallments, formatMoneyInput, parseMoneyInput } from './installments'
import { useInvalidateFinance, usePaymentCount } from './api'

export interface ContractFormModalProps {
  open: boolean
  onClose: () => void
  contract?: Contract | null
  defaults?: Partial<Pick<Contract, 'client_id' | 'demand_id'>>
  onSaved?: (contract: Contract) => void
}

interface FormState {
  client_id: string | null
  demand_id: string
  contract_type: ContractType
  description: string
  amount: string
  payment_method: PaymentMethod
  installments_count: string
  first_due_date: string
  signed_at: string
  status: ContractStatus
  notes: string
}

type Errors = Partial<Record<keyof FormState, string>>

function initialState(contract?: Contract | null, defaults?: ContractFormModalProps['defaults']): FormState {
  if (contract) {
    return {
      client_id: contract.client_id,
      demand_id: contract.demand_id ?? '',
      contract_type: contract.contract_type,
      description: contract.description ?? '',
      amount: formatMoneyInput(Number(contract.total_amount)),
      payment_method: contract.payment_method,
      installments_count: String(contract.installments_count),
      first_due_date: contract.first_due_date,
      signed_at: contract.signed_at,
      status: contract.status,
      notes: contract.notes ?? '',
    }
  }
  return {
    client_id: defaults?.client_id ?? null,
    demand_id: defaults?.demand_id ?? '',
    contract_type: 'honorarios_fixos',
    description: '',
    amount: '',
    payment_method: 'pix',
    installments_count: '1',
    first_due_date: todayISO(),
    signed_at: todayISO(),
    status: 'ativo',
    notes: '',
  }
}

const EDITABLE_STATUS: ContractStatus[] = ['rascunho', 'ativo', 'cancelado']

export function ContractFormModal(props: ContractFormModalProps) {
  // Monta o formulário só quando aberto: o estado é reiniciado a cada abertura.
  if (!props.open) return null
  return <ContractForm key={props.contract?.id ?? 'novo'} {...props} />
}

function ContractForm({ open, onClose, contract, defaults, onSaved }: ContractFormModalProps) {
  const { orgId, userId } = useOrg()
  const toast = useToast()
  const invalidate = useInvalidateFinance()
  const isEdit = !!contract
  const [start] = useState<FormState>(() => initialState(contract, defaults))
  const [form, setForm] = useState<FormState>(start)
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const paymentCount = usePaymentCount(open && isEdit ? contract!.id : null)
  const locked = isEdit && (paymentCount.data ?? 0) > 0
  const statusLocked = isEdit && contract!.status === 'quitado'

  const demands = useQuery({
    queryKey: qk.demands(orgId, 'by-client', form.client_id),
    enabled: open && !!form.client_id,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('demands')
          .select('id, title, status')
          .eq('organization_id', orgId)
          .eq('client_id', form.client_id!)
          .order('opened_at', { ascending: false })
          .limit(100),
      ) as Pick<Demand, 'id' | 'title' | 'status'>[],
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const amount = parseMoneyInput(form.amount)
  const count = Number(form.installments_count)
  const preview = useMemo(() => computeInstallments(amount, count, form.first_due_date), [amount, count, form.first_due_date])

  const validate = (): Errors => {
    const e: Errors = {}
    if (!form.client_id) e.client_id = 'Selecione o cliente.'
    if (!Number.isFinite(amount) || amount <= 0) e.amount = 'Informe um valor maior que zero.'
    else if (amount >= 100_000_000) e.amount = 'Valor acima do limite permitido.'
    if (!Number.isInteger(count) || count < 1 || count > 120) e.installments_count = 'Entre 1 e 120 parcelas.'
    else if (Number.isFinite(amount) && amount > 0 && Math.floor(Math.round(amount * 100) / count) <= 0)
      e.installments_count = 'Cada parcela precisa ter pelo menos R$ 0,01.'
    if (!form.first_due_date) e.first_due_date = 'Informe o 1º vencimento.'
    if (!form.signed_at) e.signed_at = 'Informe a data de contratação.'
    if (form.description.length > 1000) e.description = 'Máximo de 1000 caracteres.'
    if (form.notes.length > 2000) e.notes = 'Máximo de 2000 caracteres.'
    return e
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    setSubmitError(null)
    try {
      const base = {
        client_id: form.client_id!,
        demand_id: form.demand_id || null,
        contract_type: form.contract_type,
        description: form.description.trim() || null,
        payment_method: form.payment_method,
        signed_at: form.signed_at,
        notes: form.notes.trim() || null,
        ...(statusLocked ? {} : { status: form.status }),
        ...(locked ? {} : { total_amount: amount, installments_count: count, first_due_date: form.first_due_date }),
      }
      let saved: Contract
      if (isEdit) {
        const rows = unwrap(
          await supabase.from('contracts').update(base).eq('organization_id', orgId).eq('id', contract!.id).select(),
        ) as Contract[]
        if (!rows.length) throw new Error('Você não tem permissão para editar este contrato.')
        saved = rows[0]
      } else {
        saved = unwrap(
          await supabase
            .from('contracts')
            .insert({ ...base, organization_id: orgId, created_by: userId })
            .select()
            .single(),
        ) as Contract
      }
      invalidate(saved.id)
      toast.show(isEdit ? 'Contrato atualizado.' : 'Contrato cadastrado e parcelas geradas.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível salvar o contrato.')
    } finally {
      setSaving(false)
    }
  }

  const statusOptions = (statusLocked ? (['quitado'] as ContractStatus[]) : EDITABLE_STATUS).map((s) => ({
    value: s,
    label: CONTRACT_STATUS[s].label,
  }))

  const demandOptions = (demands.data ?? []).map((d) => ({
    value: d.id,
    label: `${d.title}${d.status === 'concluida' || d.status === 'cancelada' ? ` (${DEMAND_STATUS[d.status].label.toLowerCase()})` : ''}`,
  }))
  // Mantém a demanda atual selecionável mesmo se não vier na lista
  if (form.demand_id && !demandOptions.some((o) => o.value === form.demand_id) && demands.isSuccess) {
    demandOptions.unshift({ value: form.demand_id, label: 'Demanda vinculada' })
  }

  const lastDue = preview.length ? preview[preview.length - 1].due_date : null
  const showAll = preview.length <= 8
  const visible = showAll ? preview : [...preview.slice(0, 3), ...preview.slice(-2)]

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      dirty={saving || JSON.stringify(form) !== JSON.stringify(start)}
      title={isEdit ? 'Editar contrato' : 'Novo contrato'}
      description="Honorários e condições de pagamento. As parcelas são geradas automaticamente."
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="contract-form" loading={saving}>
            {isEdit ? 'Salvar alterações' : 'Cadastrar contrato'}
          </Button>
        </>
      }
    >
      <form id="contract-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ClientPicker
            value={form.client_id}
            onChange={(id) => {
              setForm((f) => ({ ...f, client_id: id, demand_id: id === f.client_id ? f.demand_id : '' }))
              setErrors((e) => ({ ...e, client_id: undefined }))
            }}
            required
            error={errors.client_id}
          />
        </div>

        <Select
          label="Demanda relacionada"
          wrapperClassName="sm:col-span-2"
          value={form.demand_id}
          onChange={(e) => set('demand_id', e.target.value)}
          options={demandOptions}
          placeholder={!form.client_id ? 'Selecione primeiro o cliente' : demands.isLoading ? 'Carregando…' : 'Nenhuma (opcional)'}
          disabled={!form.client_id}
          hint={form.client_id && demands.isSuccess && !demands.data.length ? 'Este cliente ainda não tem demandas.' : undefined}
        />

        <Select
          label="Tipo de contrato"
          required
          value={form.contract_type}
          onChange={(e) => set('contract_type', e.target.value as ContractType)}
          options={toOptions(CONTRACT_TYPE)}
        />
        <Select
          label="Forma de pagamento"
          required
          value={form.payment_method}
          onChange={(e) => set('payment_method', e.target.value as PaymentMethod)}
          options={toOptions(PAYMENT_METHOD)}
        />

        <Textarea
          label="Descrição"
          wrapperClassName="sm:col-span-2"
          rows={2}
          maxLength={1000}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Ex.: honorários para requerimento de aposentadoria por idade"
          error={errors.description}
        />

        {locked && (
          <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Este contrato já possui {paymentCount.data} pagamento{paymentCount.data === 1 ? '' : 's'} registrado
              {paymentCount.data === 1 ? '' : 's'}. Valor, quantidade de parcelas e 1º vencimento não podem ser alterados — estorne os
              pagamentos antes, se precisar refazer o parcelamento.
            </span>
          </div>
        )}

        <Input
          label="Valor contratado"
          required
          inputMode="decimal"
          leading={<span className="text-[12.5px]">R$</span>}
          value={form.amount}
          onChange={(e) => set('amount', e.target.value)}
          onBlur={() => Number.isFinite(amount) && amount > 0 && set('amount', formatMoneyInput(amount))}
          placeholder="0,00"
          disabled={locked}
          error={errors.amount}
          hint={Number.isFinite(amount) && amount > 0 ? formatCurrency(amount) : undefined}
        />
        <Input
          label="Quantidade de parcelas"
          required
          type="number"
          min={1}
          max={120}
          step={1}
          value={form.installments_count}
          onChange={(e) => set('installments_count', e.target.value)}
          disabled={locked}
          error={errors.installments_count}
        />
        <Input
          label="1º vencimento"
          required
          type="date"
          value={form.first_due_date}
          onChange={(e) => set('first_due_date', e.target.value)}
          disabled={locked}
          error={errors.first_due_date}
        />
        <Input
          label="Data de contratação"
          required
          type="date"
          value={form.signed_at}
          onChange={(e) => set('signed_at', e.target.value)}
          error={errors.signed_at}
        />

        <Select
          label="Status"
          value={statusLocked ? 'quitado' : form.status}
          onChange={(e) => set('status', e.target.value as ContractStatus)}
          options={statusOptions}
          disabled={statusLocked}
          hint={statusLocked ? 'Definido automaticamente: todos os valores foram recebidos.' : '“Quitado” é definido automaticamente ao receber o total.'}
        />
        <div className="hidden sm:block" />

        {/* Prévia das parcelas */}
        <div className="sm:col-span-2 rounded-md border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-canvas/70 px-3 py-2">
            <span className="text-[12.5px] font-medium text-ink">Prévia das parcelas</span>
            {preview.length > 0 && (
              <span className="tabular text-[12px] text-ink-muted">
                {preview.length}× · {formatDate(preview[0].due_date)} a {formatDate(lastDue)}
              </span>
            )}
          </div>
          {preview.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-ink-subtle">Informe valor, parcelas e 1º vencimento para ver o cronograma.</p>
          ) : (
            <ul className="divide-y divide-line text-[12.5px]">
              {visible.map((p, idx) => (
                <li key={p.number}>
                  {!showAll && idx === 3 && (
                    <div className="px-3 py-1 text-center text-[11.5px] text-ink-subtle">… {preview.length - 5} parcelas intermediárias …</div>
                  )}
                  <div className="tabular flex items-center justify-between px-3 py-1.5">
                    <span className="text-ink-muted">
                      {p.number}/{preview.length} · {formatDate(p.due_date)}
                    </span>
                    <span className="font-medium text-ink">{formatCurrency(p.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isEdit && !locked && preview.length > 0 && (
            <p className="border-t border-line px-3 py-1.5 text-[11.5px] text-ink-subtle">
              Alterar valor, parcelas ou 1º vencimento recria o cronograma.
            </p>
          )}
        </div>

        <Textarea
          label="Observações"
          wrapperClassName="sm:col-span-2"
          rows={2}
          maxLength={2000}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          error={errors.notes}
        />

        {submitError && (
          <div className="sm:col-span-2">
            <InlineError message={submitError} />
          </div>
        )}
      </form>
    </Modal>
  )
}
