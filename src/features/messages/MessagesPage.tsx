import { useMemo, useState } from 'react'
import { Copy, MessageSquareText, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { ClientPicker } from '@/components/ClientPicker'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SearchInput,
  Skeleton,
  useToast,
} from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { DEFAULT_TEMPLATES } from './defaultTemplates'
import { useDeleteMessageTemplate, useMessageTemplates } from './api'
import { MessageComposerModal } from './MessageComposerModal'
import { TemplateFormModal, type TemplateDraft } from './TemplateFormModal'
import { VariableText } from './VariableText'
import { MESSAGE_VARIABLES } from './variables'
import type { MessageTemplate } from './types'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Central de mensagens: biblioteca de modelos (padrão + do escritório). Rota /mensagens. */
export function MessagesPage() {
  const { role } = useOrg()
  const canManage = role === 'admin' || role === 'advogado'
  const toast = useToast()
  const q = useMessageTemplates()
  const del = useDeleteMessageTemplate()

  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_TEMPLATES[0].id)
  const [form, setForm] = useState<TemplateDraft | null>(null)
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null)
  const [pickClient, setPickClient] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [composeFor, setComposeFor] = useState<string | null>(null)

  const all: MessageTemplate[] = useMemo(
    () => [
      ...DEFAULT_TEMPLATES,
      ...(q.data ?? []).map<MessageTemplate>((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, kind: 'escritorio' })),
    ],
    [q.data],
  )
  const filtered = all.filter((t) => !search.trim() || norm(`${t.name} ${t.body}`).includes(norm(search.trim())))
  const selected = all.find((t) => t.id === selectedId) ?? all[0]

  const duplicate = (t: MessageTemplate) =>
    setForm({ name: `${t.name} (cópia)`.slice(0, 80), subject: t.subject ?? '', body: t.body })

  return (
    <div>
      <PageHeader
        title="Mensagens"
        description="Modelos para WhatsApp e e-mail com os dados do cliente preenchidos. Nada é enviado automaticamente."
        actions={
          <>
            {canManage && (
              <Button icon={<Plus className="size-4" />} onClick={() => setForm({ name: '', subject: '', body: '' })}>
                Novo modelo
              </Button>
            )}
            <Button variant="primary" icon={<Send className="size-4" />} onClick={() => setPickClient(true)}>
              Escrever mensagem
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-line p-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Buscar modelo…" />
          </div>
          {q.isError && <p className="px-4 pt-3 text-label text-red-600">Não foi possível carregar os modelos do escritório.</p>}
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto scrollbar-thin" aria-label="Modelos">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  aria-current={t.id === selected?.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors',
                    t.id === selected?.id ? 'bg-accent-50/70' : 'hover:bg-navy-50/60',
                  )}
                >
                  <MessageSquareText className={cn('mt-0.5 size-4 shrink-0', t.id === selected?.id ? 'text-accent-600' : 'text-ink-subtle')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-body font-medium text-ink">{t.name}</span>
                      {t.kind === 'escritorio' && <Badge tone="blue">Escritório</Badge>}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-caption text-ink-muted">
                      {t.description ?? t.body.replace(/\s+/g, ' ').slice(0, 90)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {q.isLoading &&
              Array.from({ length: 2 }).map((_, i) => (
                <li key={`sk${i}`} className="px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                </li>
              ))}
          </ul>
          {!filtered.length && !q.isLoading && (
            <EmptyState title="Nenhum modelo encontrado" description="Tente outro termo de busca." className="py-8" />
          )}
        </Card>

        <div className="space-y-4">
          {selected ? (
            <Card>
              <CardHeader
                title={selected.name}
                description={selected.kind === 'padrao' ? 'Modelo padrão do JurisFlow' : 'Modelo do escritório'}
                action={
                  <div className="flex gap-1.5">
                    {canManage && (
                      <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => duplicate(selected)}>
                        {selected.kind === 'padrao' ? 'Duplicar e personalizar' : 'Duplicar'}
                      </Button>
                    )}
                    {canManage && selected.kind === 'escritorio' && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Editar modelo"
                          onClick={() => setForm({ id: selected.id, name: selected.name, subject: selected.subject ?? '', body: selected.body })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="Excluir modelo" onClick={() => setDeleting(selected)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    )}
                  </div>
                }
              />
              <CardBody>
                {selected.subject && (
                  <p className="mb-3 text-label text-ink-muted">
                    <span className="font-medium text-ink">Assunto: </span>
                    <VariableText text={selected.subject} />
                  </p>
                )}
                <div className="whitespace-pre-wrap rounded-lg border border-line bg-canvas/50 p-4 text-body leading-relaxed text-ink">
                  <VariableText text={selected.body} />
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <ErrorState message="Modelo não encontrado." />
            </Card>
          )}

          <Card>
            <CardHeader title="Variáveis disponíveis" description="Preenchidas com os dados reais ao escrever para um cliente." />
            <CardBody className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {MESSAGE_VARIABLES.map((v) => (
                <div key={v.name} className="flex items-baseline justify-between gap-3 text-label">
                  <span className="font-medium text-ink">{v.label}</span>
                  <span className="truncate text-right text-ink-muted">Ex.: {v.example.split('\n')[0]}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      <TemplateFormModal
        open={!!form}
        onClose={() => setForm(null)}
        initial={form}
        onSaved={(id) => {
          setSelectedId(id)
          toast.show('Modelo salvo.')
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir modelo"
        description={`O modelo "${deleting?.name ?? ''}" será excluído para todo o escritório.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!deleting) return
          await del.mutateAsync(deleting.id)
          setSelectedId(DEFAULT_TEMPLATES[0].id)
          toast.show('Modelo excluído.')
        }}
      />

      <Modal
        open={pickClient}
        onClose={() => setPickClient(false)}
        title="Escrever mensagem"
        description={`Modelo: ${selected?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setPickClient(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!clientId}
              onClick={() => {
                setPickClient(false)
                setComposeFor(clientId)
              }}
            >
              Continuar
            </Button>
          </>
        }
      >
        <ClientPicker value={clientId} onChange={(id) => setClientId(id)} label="Para qual cliente?" required />
      </Modal>

      {composeFor && (
        <MessageComposerModal
          open
          onClose={() => setComposeFor(null)}
          clientId={composeFor}
          initialTemplateId={selected?.id}
        />
      )}
    </div>
  )
}
