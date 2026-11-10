import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, PanelLeft, Plus, SendHorizontal, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Button, ConfirmDialog, ErrorState, Input, Modal, Spinner, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { aiNotConfiguredMessage } from '@/lib/aiStatus'
import { qk } from '@/hooks/useOrgData'
import { cn } from '@/lib/cn'
import {
  AssistantError,
  deleteConversation,
  listConversations,
  listMessages,
  renameConversation,
  sendAssistantMessage,
  type ConversationSummary,
} from './api'
import { ConversationList } from './ConversationList'
import { MessageBubble, ThinkingIndicator } from './MessageBubble'
import { MAX_MESSAGE_CHARS, PRIVACY_NOTICE, SUGGESTIONS, containsPersonalData } from './constants'

export function AssistantPage() {
  const { orgId, userId, role } = useOrg()
  const isAdmin = role === 'admin'
  const qc = useQueryClient()
  const toast = useToast()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  // ?q= vem da busca global ("Perguntar ao assistente"): pré-preenche o campo
  const [input, setInput] = useState(() => (params.get('q') ?? '').slice(0, 2000))
  useEffect(() => {
    if (params.has('q')) setParams((p) => { const n = new URLSearchParams(p); n.delete('q'); return n }, { replace: true })
  }, [params, setParams])
  const [pending, setPending] = useState<string | null>(null)
  const [sendError, setSendError] = useState<AssistantError | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [renaming, setRenaming] = useState<ConversationSummary | null>(null)
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const conversationsKey = qk.ai(orgId, 'conversations', userId)
  const conversations = useQuery({
    queryKey: conversationsKey,
    queryFn: () => listConversations(orgId, userId),
  })

  const messages = useQuery({
    queryKey: qk.ai(orgId, 'messages', selectedId),
    queryFn: () => listMessages(orgId, selectedId!),
    enabled: !!selectedId,
  })

  const send = useMutation({
    mutationFn: (text: string) => sendAssistantMessage({ organization_id: orgId, conversation_id: selectedId, message: text }),
    onMutate: (text) => {
      setPending(text)
      setSendError(null)
    },
    onSuccess: async (reply) => {
      setNotConfigured(false)
      // Carrega o histórico atualizado antes de trocar de conversa (evita "piscar").
      await qc
        .fetchQuery({
          queryKey: qk.ai(orgId, 'messages', reply.conversation_id),
          queryFn: () => listMessages(orgId, reply.conversation_id),
          staleTime: 0,
        })
        .catch(() => undefined)
      if (reply.conversation_id !== selectedId) setSelectedId(reply.conversation_id)
      await qc.invalidateQueries({ queryKey: conversationsKey })
      if (reply.redacted?.length) {
        toast.show('Removemos CPF, telefone ou e-mail da sua mensagem antes de enviá-la ao provedor de IA.')
      }
    },
    onError: async (err, text) => {
      const e = err instanceof AssistantError ? err : new AssistantError('unknown', 'Ocorreu um erro inesperado no assistente.')
      setSendError(e)
      if (e.kind === 'not_configured') setNotConfigured(true)
      if (e.conversationId) {
        // A pergunta já foi registrada (falha só na resposta do provedor).
        if (e.conversationId !== selectedId) setSelectedId(e.conversationId)
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.ai(orgId, 'messages', e.conversationId) }),
          qc.invalidateQueries({ queryKey: conversationsKey }),
        ])
      } else {
        setInput((cur) => cur || text)
      }
    },
    onSettled: () => setPending(null),
  })

  // rola para o fim quando chegam mensagens
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.data, pending, sendError])

  const submit = (text: string) => {
    const clean = text.trim()
    if (!clean || send.isPending) return
    if (clean.length > MAX_MESSAGE_CHARS) return
    setInput('')
    send.mutate(clean)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(input)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit(input)
    }
  }

  const startNew = () => {
    setSelectedId(null)
    setSendError(null)
    setListOpen(false)
    inputRef.current?.focus()
  }

  const select = (id: string) => {
    setSelectedId(id)
    setSendError(null)
    setListOpen(false)
  }

  const current = conversations.data?.find((c) => c.id === selectedId) ?? null
  const msgs = selectedId ? (messages.data ?? []) : []
  const isEmpty = !selectedId && !pending
  const tooLong = input.length > MAX_MESSAGE_CHARS
  const hasPII = containsPersonalData(input)

  const list = (
    <ConversationList
      conversations={conversations.data}
      loading={conversations.isLoading}
      error={conversations.error ? (conversations.error as Error).message : null}
      onRetry={() => conversations.refetch()}
      selectedId={selectedId}
      onSelect={select}
      onNew={startNew}
      onRename={setRenaming}
      onDelete={setDeleting}
    />
  )

  return (
    <div className="relative flex h-[calc(100dvh-5.5rem)] min-h-[480px] gap-4 lg:h-[calc(100dvh-3.5rem)]">
      {/* Lista de conversas: fixa no desktop, gaveta no mobile */}
      <aside className="hidden w-64 shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] lg:block">
        {list}
      </aside>
      {listOpen && (
        <div className="absolute inset-0 z-20 flex lg:hidden">
          <div className="absolute inset-0 rounded-[var(--radius-card)] bg-navy-950/30" onClick={() => setListOpen(false)} aria-hidden />
          <div className="relative w-72 max-w-[85%] overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-pop)]">
            {list}
          </div>
        </div>
      )}

      {/* Chat */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)]">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setListOpen(true)} aria-label="Abrir conversas">
            <PanelLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14.5px] font-semibold text-ink">{current?.title ?? 'Assistente IA'}</h1>
            <p className="truncate text-[12px] text-ink-muted">Consultas operacionais sobre o seu escritório</p>
          </div>
          {selectedId && (
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={startNew}>
              <span className="hidden sm:inline">Nova conversa</span>
              <span className="sm:hidden">Nova</span>
            </Button>
          )}
        </header>

        {notConfigured && (
          <div role="alert" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {isAdmin ? (
              <span>
                <strong className="font-semibold">{aiNotConfiguredMessage(true)}</strong> A chave fica nos segredos da Edge Function{' '}
                <code className="font-mono text-[12px]">ai-assistant</code>.
              </span>
            ) : (
              <span>
                <strong className="font-semibold">{aiNotConfiguredMessage(false)}</strong>
              </span>
            )}
          </div>
        )}

        <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
          {isEmpty ? (
            <div className="mx-auto flex max-w-xl flex-col items-center pt-6 text-center sm:pt-10">
              <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                <Sparkles className="size-5" />
              </div>
              <p className="text-[15px] font-semibold text-ink">Como posso ajudar hoje?</p>
              <p className="mt-1 max-w-md text-[13px] text-ink-muted">
                Pergunte sobre demandas, prazos, tarefas e o andamento do escritório. Também posso redigir mensagens administrativas.
              </p>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    disabled={send.isPending}
                    className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-[13px] text-ink transition-colors hover:border-accent-200 hover:bg-accent-50 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : selectedId && messages.isLoading ? (
            <Spinner label="Carregando conversa…" />
          ) : selectedId && messages.error ? (
            <ErrorState message={(messages.error as Error).message} onRetry={() => messages.refetch()} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {msgs.map((m) => (
                <MessageBubble key={m.id} role={m.role} content={m.content} toolsUsed={m.tools_used} />
              ))}
              {pending && (
                <>
                  <MessageBubble role="user" content={pending} />
                  <ThinkingIndicator />
                </>
              )}
            </div>
          )}

          {sendError && !send.isPending && (
            <div className="mx-auto mt-4 max-w-3xl">
              <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span className="flex-1">{sendError.kind === 'not_configured' ? aiNotConfiguredMessage(isAdmin) : sendError.message}</span>
                <button onClick={() => setSendError(null)} className="text-red-500 hover:text-red-700" aria-label="Fechar erro">
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <form onSubmit={onSubmit} className="border-t border-line px-3 pb-2.5 pt-3 sm:px-4">
          <div className="mx-auto max-w-3xl">
            <div
              className={cn(
                'flex items-end gap-2 rounded-lg border bg-surface px-2.5 py-2 transition-colors focus-within:ring-3',
                tooLong ? 'border-red-400 focus-within:ring-red-100' : 'border-line-strong focus-within:border-accent-500 focus-within:ring-accent-100',
              )}
            >
              <label htmlFor="assistant-input" className="sr-only">
                Mensagem para o assistente
              </label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Pergunte algo sobre o escritório…"
                className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-ink placeholder:text-ink-subtle focus:outline-none field-sizing-content"
                aria-invalid={tooLong || undefined}
                disabled={send.isPending}
              />
              <Button
                type="submit"
                variant="primary"
                size="icon"
                aria-label="Enviar mensagem"
                disabled={!input.trim() || tooLong || send.isPending}
                loading={send.isPending}
                icon={send.isPending ? undefined : <SendHorizontal className="size-4" />}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-[11.5px]">
              <p className="flex items-start gap-1.5 text-ink-subtle">
                <ShieldCheck className="mt-[1px] size-3.5 shrink-0" />
                <span>{PRIVACY_NOTICE}</span>
              </p>
              {(input.length > MAX_MESSAGE_CHARS * 0.8 || tooLong) && (
                <span className={tooLong ? 'text-red-600' : 'text-ink-subtle'}>
                  {input.length}/{MAX_MESSAGE_CHARS}
                </span>
              )}
            </div>
            {hasPII && (
              <p className="mt-1 text-[12px] text-amber-700" role="status">
                CPF, telefone e e-mail serão substituídos por “[dado removido]” antes do envio ao provedor de IA.
              </p>
            )}
          </div>
        </form>
      </section>

      <RenameModal conversation={renaming} onClose={() => setRenaming(null)} orgId={orgId} onDone={() => qc.invalidateQueries({ queryKey: conversationsKey })} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir conversa"
        description={`A conversa “${deleting?.title ?? ''}” e todas as suas mensagens serão excluídas permanentemente.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (!deleting) return
          await deleteConversation(orgId, deleting.id)
          if (deleting.id === selectedId) setSelectedId(null)
          qc.removeQueries({ queryKey: qk.ai(orgId, 'messages', deleting.id) })
          await qc.invalidateQueries({ queryKey: conversationsKey })
          toast.show('Conversa excluída.')
        }}
      />
    </div>
  )
}

function RenameModal({
  conversation,
  onClose,
  orgId,
  onDone,
}: {
  conversation: ConversationSummary | null
  onClose: () => void
  orgId: string
  onDone: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTitle(conversation?.title ?? '')
    setError(null)
  }, [conversation])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!conversation) return
    if (!title.trim()) {
      setError('Informe um título.')
      return
    }
    setSaving(true)
    try {
      await renameConversation(orgId, conversation.id, title)
      onDone()
      toast.show('Conversa renomeada.')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível renomear.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!conversation}
      onClose={saving ? () => {} : onClose}
      title="Renomear conversa"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="rename-conversation" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="rename-conversation" onSubmit={save}>
        <Input label="Título" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} error={error} required />
      </form>
    </Modal>
  )
}
