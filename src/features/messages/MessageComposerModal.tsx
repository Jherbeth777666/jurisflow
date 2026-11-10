import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Info, Mail, MessageCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Badge, Button, ErrorState, Input, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import { formatCurrency, formatDate, formatPhone } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useChecklistItems } from '@/features/checklist/api'
import { pendingLabels } from '@/features/checklist/logic'
import { DEFAULT_TEMPLATES } from './defaultTemplates'
import {
  ComposeError,
  adjustTemplateTone,
  isAiComposeMarkedUnavailable,
  useComposeContext,
  useMessageTemplates,
  useNextDemandTask,
} from './api'
import { TONE_LABELS, type ComposeTone, type MessageTemplate } from './types'
import { fillTemplate, firstName, formatPendingList, unresolvedVariables, validateRewrite, variableLabel, type VariableValues } from './variables'
import { buildMailtoLink, buildWhatsAppLink, normalizeBrPhone } from './whatsapp'

export interface MessageComposerModalProps {
  open: boolean
  onClose: () => void
  clientId: string
  demandId?: string | null
  /** Ex.: 'padrao:lembrete-documentos' (ver DEFAULT_TEMPLATE_IDS) ou id de modelo do escritório */
  initialTemplateId?: string
}

/**
 * Compositor de mensagens para WhatsApp/e-mail. Nada é enviado automaticamente:
 * os botões apenas abrem o WhatsApp/e-mail com o texto para o usuário revisar e enviar.
 */
export function MessageComposerModal(props: MessageComposerModalProps) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Enviar mensagem"
      description="Escolha um modelo, revise o texto e envie pelo WhatsApp ou e-mail."
      size="xl"
    >
      {props.open && <Composer {...props} />}
    </Modal>
  )
}

const OPEN_STATUSES = new Set(['em_andamento', 'aguardando_cliente', 'suspensa'])

function Composer({ clientId, demandId, initialTemplateId, onClose }: MessageComposerModalProps) {
  const { orgId, organization } = useOrg()
  const toast = useToast()
  const ctx = useComposeContext(clientId)
  const custom = useMessageTemplates()
  const cats = useCategories()
  const members = useMemberNames()

  const templates: MessageTemplate[] = useMemo(
    () => [
      ...DEFAULT_TEMPLATES,
      ...(custom.data ?? []).map<MessageTemplate>((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, kind: 'escritorio' })),
    ],
    [custom.data],
  )

  const [templateId, setTemplateId] = useState(initialTemplateId ?? DEFAULT_TEMPLATES[0].id)
  const template = templates.find((t) => t.id === templateId) ?? DEFAULT_TEMPLATES[0]

  // Demanda de referência: a informada, senão a aberta mais recente
  const [selectedDemand, setSelectedDemand] = useState<string | null>(demandId ?? null)
  useEffect(() => {
    if (selectedDemand || demandId || !ctx.data) return
    const open = ctx.data.demands.find((d) => OPEN_STATUSES.has(d.status))
    if (open) setSelectedDemand(open.id)
  }, [ctx.data, demandId, selectedDemand])
  const demand = ctx.data?.demands.find((d) => d.id === selectedDemand) ?? null

  const checklist = useChecklistItems(demand?.id ?? null)
  const nextTask = useNextDemandTask(demand?.id ?? null)

  const values: VariableValues = useMemo(() => {
    const category = demand ? cats.data?.find((c) => c.id === demand.category_id) : undefined
    const stage = demand ? category?.stages.find((s) => s.id === demand.stage_id) : undefined
    const inst = ctx.data?.nextInstallment
    const nextAction = demand?.next_action || nextTask.data?.title || null
    const nextDate = demand?.next_action ? demand.next_action_date : (nextTask.data?.due_date ?? demand?.next_action_date ?? null)
    return {
      primeiro_nome: firstName(ctx.data?.client.full_name),
      nome_escritorio: organization.name,
      categoria: category?.name,
      etapa: stage?.name,
      proxima_atividade: nextAction,
      data_proxima_atividade: nextDate ? formatDate(nextDate) : null,
      responsavel: demand?.responsible_id ? members.map.get(demand.responsible_id) : null,
      documentos_pendentes: formatPendingList(pendingLabels(checklist.data ?? [])),
      valor_parcela: inst ? formatCurrency(Number(inst.remaining_amount) || Number(inst.amount)) : null,
      vencimento_parcela: inst ? formatDate(inst.due_date) : null,
    }
  }, [demand, cats.data, ctx.data, nextTask.data, organization.name, members.map, checklist.data])

  // Fonte com variáveis (modelo original ou ajustado pela IA) → texto preenchido (editável)
  const [source, setSource] = useState(template.body)
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [dirty, setDirty] = useState(false)
  const [undo, setUndo] = useState<{ source: string; text: string } | null>(null)
  const valuesKey = JSON.stringify(values)

  useEffect(() => {
    setSource(template.body)
    setDirty(false)
    setUndo(null)
  }, [template.body])

  useEffect(() => {
    if (dirty) return
    setText(fillTemplate(source, values).text)
    setSubject(fillTemplate(template.subject ?? '', values).text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, valuesKey, template.subject, dirty])

  const missing = unresolvedVariables(text)
  const subjectMissing = unresolvedVariables(subject)

  // --- IA ----------------------------------------------------------------
  const [aiUnavailable, setAiUnavailable] = useState(isAiComposeMarkedUnavailable)
  const [aiBusy, setAiBusy] = useState<ComposeTone | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const adjust = async (tone: ComposeTone) => {
    setAiBusy(tone)
    setAiError(null)
    try {
      const raw = await adjustTemplateTone(orgId, source, tone)
      const check = validateRewrite(source, raw)
      if (!check.ok) {
        setAiError(check.error)
        return
      }
      setUndo({ source, text })
      setDirty(false)
      setSource(check.text)
      toast.show(`Texto ajustado: ${TONE_LABELS[tone].toLowerCase()}.`)
    } catch (e) {
      if (e instanceof ComposeError && e.code === 'not_configured') setAiUnavailable(true)
      else setAiError(e instanceof Error ? e.message : 'Não foi possível ajustar o texto.')
    } finally {
      setAiBusy(null)
    }
  }

  const doUndo = () => {
    if (!undo) return
    setSource(undo.source)
    setText(undo.text)
    setDirty(true)
    setUndo(null)
  }

  // --- Envio (sempre confirmado pelo usuário no app de destino) ------------
  const client = ctx.data?.client
  const phone = normalizeBrPhone(client?.phone)
  const waLink = buildWhatsAppLink(client?.phone, text)
  const mailLink = buildMailtoLink(client?.email, subject, text)
  const blocked = missing.length > 0 || !text.trim()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.show('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error')
    }
  }

  const openLink = (url: string | null) => {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (ctx.isError) return <ErrorState message={(ctx.error as Error).message} onRetry={() => ctx.refetch()} />
  if (ctx.isLoading || !client) return <ComposerSkeleton />
  if (client.anonymized_at) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-line bg-canvas px-3 py-3 text-[13px] text-ink-muted">
        <Info className="mt-0.5 size-4 shrink-0" /> Este cliente foi anonimizado e não possui dados de contato.
      </div>
    )
  }

  const demandOptions = (ctx.data?.demands ?? []).map((d) => ({
    value: d.id,
    label: `${d.title}${OPEN_STATUSES.has(d.status) ? '' : ' (encerrada)'}`,
  }))

  return (
    <div className="grid gap-5 md:grid-cols-[230px_1fr]">
      {/* Modelos */}
      <nav aria-label="Modelos de mensagem" className="md:border-r md:border-line md:pr-4">
        <TemplateGroup title="Modelos padrão" items={templates.filter((t) => t.kind === 'padrao')} active={template.id} onPick={setTemplateId} />
        {templates.some((t) => t.kind === 'escritorio') && (
          <TemplateGroup
            title="Do escritório"
            items={templates.filter((t) => t.kind === 'escritorio')}
            active={template.id}
            onPick={setTemplateId}
          />
        )}
        {custom.isError && <p className="mt-2 text-[12px] text-red-600">Não foi possível carregar os modelos do escritório.</p>}
      </nav>

      <div className="min-w-0 space-y-4">
        {/* Destinatário */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-muted">
          <span className="font-medium text-ink">{client.full_name}</span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" />
            {phone.ok ? formatPhone(phone.national) : <span className="text-amber-700">{phone.reason}</span>}
            {phone.ok && phone.kind === 'fixo' && <Badge tone="amber">parece fixo</Badge>}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mail className="size-3.5" />
            {client.email ?? <span className="text-ink-subtle">sem e-mail</span>}
          </span>
        </div>

        {demandOptions.length > 0 && (
          <Select
            label="Referente à demanda"
            value={selectedDemand ?? ''}
            onChange={(e) => setSelectedDemand(e.target.value || null)}
            options={demandOptions}
            placeholder="Nenhuma (mensagem geral)"
          />
        )}

        <Input
          label="Assunto (e-mail)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={160}
          error={subjectMissing.length ? `Sem dado para: ${subjectMissing.map(variableLabel).join(', ')}` : null}
        />

        <div>
          <Textarea
            label="Mensagem"
            rows={11}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setDirty(true)
            }}
            maxLength={4000}
          />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-subtle">
            <span className="tabular" aria-live="polite">
              {text.length} caracteres
            </span>
            {dirty && (
              <button
                type="button"
                className="text-accent-700 hover:underline"
                onClick={() => {
                  setDirty(false)
                  setUndo({ source, text })
                }}
              >
                Restaurar texto do modelo
              </button>
            )}
          </div>
        </div>

        {missing.length > 0 && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Sem dado cadastrado para: <strong>{missing.map(variableLabel).join(', ')}</strong>. Edite o texto e substitua os
              trechos entre {'{{ }}'} antes de enviar.
            </span>
          </div>
        )}

        {/* IA */}
        <div className="rounded-lg border border-line bg-canvas/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
              <Sparkles className="size-3.5 text-accent-600" /> Ajustar com IA
            </span>
            {(Object.keys(TONE_LABELS) as ComposeTone[]).map((tone) => (
              <Button
                key={tone}
                size="sm"
                variant="secondary"
                disabled={aiUnavailable || (aiBusy !== null && aiBusy !== tone)}
                loading={aiBusy === tone}
                onClick={() => adjust(tone)}
              >
                {TONE_LABELS[tone]}
              </Button>
            ))}
            {undo && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={doUndo}>
                Desfazer
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-subtle">
            {aiUnavailable
              ? 'Ajuste com IA indisponível: o provedor de IA não está configurado neste ambiente.'
              : 'A IA recebe apenas o modelo com as variáveis — sem nomes, valores ou datas do cliente.'}
            {dirty && !aiUnavailable && ' O ajuste parte do modelo e substitui suas edições manuais (é possível desfazer).'}
          </p>
          {aiError && <p className="mt-1 text-[12px] text-red-600" role="alert">{aiError}</p>}
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] text-ink-subtle">Nada é enviado automaticamente — você revisa e envia no app.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={copy} disabled={!text.trim()} icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                openLink(mailLink)
                onClose()
              }}
              disabled={blocked || !mailLink || subjectMissing.length > 0}
              title={!mailLink ? 'Cliente sem e-mail válido cadastrado' : blocked ? 'Resolva as variáveis sem dado' : undefined}
              icon={<Mail className="size-3.5" />}
            >
              Enviar por e-mail
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                openLink(waLink)
                onClose()
              }}
              disabled={blocked || !waLink}
              title={!waLink ? (phone.ok ? undefined : phone.reason) : blocked ? 'Resolva as variáveis sem dado' : undefined}
              icon={<MessageCircle className="size-3.5" />}
            >
              Abrir no WhatsApp
            </Button>
          </div>
        </div>
        {(!waLink || !mailLink) && (
          <p className="text-right text-[11.5px] text-ink-subtle">
            {!waLink && `WhatsApp indisponível: ${phone.ok ? 'texto vazio' : phone.reason} `}
            {!mailLink && 'E-mail indisponível: cliente sem e-mail válido.'}
          </p>
        )}
      </div>
    </div>
  )
}

function TemplateGroup({
  title,
  items,
  active,
  onPick,
}: {
  title: string
  items: MessageTemplate[]
  active: string
  onPick: (id: string) => void
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">{title}</p>
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {items.map((t) => (
          <li key={t.id} className="shrink-0">
            <button
              type="button"
              onClick={() => onPick(t.id)}
              aria-pressed={t.id === active}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                t.id === active ? 'bg-navy-900 text-white' : 'text-ink hover:bg-navy-50',
              )}
            >
              {t.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ComposerSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-[230px_1fr]" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    </div>
  )
}
