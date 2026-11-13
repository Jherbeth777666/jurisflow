import { useState, type FormEvent } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button, Input, InlineError, Modal, Select, Textarea, useToast } from '@/components/ui'
import { CLIENT_STATUS, toOptions } from '@/lib/constants'
import { formatCPF, formatPhone, todayISO } from '@/lib/format'
import type { Client, ClientStatus } from '@/types/database'
import { useSaveClient } from './api'
import {
  clientToForm,
  emptyClientForm,
  validateClientField,
  validateClientForm,
  type ClientFormErrors,
  type ClientFormValues,
} from './logic'

interface ClientFormModalProps {
  open: boolean
  onClose: () => void
  /** Cliente existente para edição; ausente = criação */
  client?: Client | null
  onSaved?: (client: Client) => void
}

/** Monta o formulário só quando aberto: o estado inicial vem do cliente a cada abertura. */
export function ClientFormModal(props: ClientFormModalProps) {
  return props.open ? <ClientFormModalInner key={props.client?.id ?? 'new'} {...props} /> : null
}

function ClientFormModalInner({ open, onClose, client, onSaved }: ClientFormModalProps) {
  const toast = useToast()
  const save = useSaveClient()
  const [values, setValues] = useState<ClientFormValues>(() => (client ? clientToForm(client) : emptyClientForm))
  const [errors, setErrors] = useState<ClientFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = <K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    // Limpa o erro do campo enquanto o usuário corrige; revalida no blur.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const blur = (key: keyof ClientFormValues) => setErrors((e) => ({ ...e, [key]: validateClientField(key, values) }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const errs = validateClientForm(values)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    try {
      const saved = await save.mutateAsync({ id: client?.id, values })
      toast.show(client ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível salvar.'
      if (msg.includes('CPF')) setErrors((x) => ({ ...x, cpf: msg }))
      else setFormError(msg)
    }
  }

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title={client ? 'Editar cliente' : 'Novo cliente'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="client-form" loading={save.isPending}>
            {client ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="flex items-start gap-2 rounded-md bg-navy-50 px-3 py-2 text-label text-ink-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-500" />
          <span>
            LGPD: colete apenas o necessário para o atendimento. Campos opcionais podem ficar em branco e as observações não devem conter
            dados sensíveis (saúde, religião etc.) sem necessidade.
          </span>
        </div>

        <Input
          label="Nome completo"
          required
          maxLength={160}
          autoComplete="off"
          value={values.full_name}
          onChange={(e) => set('full_name', e.target.value)}
          onBlur={() => blur('full_name')}
          error={errors.full_name}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="CPF"
            inputMode="numeric"
            placeholder="000.000.000-00"
            hint="Recomendado — evita cadastros duplicados."
            value={formatCPF(values.cpf)}
            onChange={(e) => set('cpf', e.target.value.replace(/\D/g, '').slice(0, 11))}
            onBlur={() => blur('cpf')}
            error={errors.cpf}
          />
          <Input
            label="Telefone"
            inputMode="tel"
            placeholder="(00) 00000-0000"
            value={formatPhone(values.phone)}
            onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 13))}
            onBlur={() => blur('phone')}
            error={errors.phone}
          />
          <Input
            label="E-mail"
            type="email"
            autoComplete="off"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            onBlur={() => blur('email')}
            error={errors.email}
          />
          <Input
            label="Data de nascimento"
            type="date"
            hint="Opcional"
            max={todayISO()}
            value={values.birth_date}
            onChange={(e) => set('birth_date', e.target.value)}
            onBlur={() => blur('birth_date')}
            error={errors.birth_date}
          />
        </div>

        <Input
          label="Endereço"
          hint="Opcional"
          maxLength={300}
          value={values.address}
          onChange={(e) => set('address', e.target.value)}
          onBlur={() => blur('address')}
          error={errors.address}
        />

        <Select
          label="Status"
          options={toOptions(CLIENT_STATUS)}
          value={values.status}
          onChange={(e) => set('status', e.target.value as ClientStatus)}
          wrapperClassName="sm:max-w-[50%] sm:pr-2"
        />

        <Textarea
          label="Observações administrativas"
          rows={3}
          maxLength={4000}
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          onBlur={() => blur('notes')}
          error={errors.notes}
        />

        <InlineError message={formError} />
      </form>
    </Modal>
  )
}
